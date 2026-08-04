import type * as L from 'leaflet';
import { SITE_MAX, SITE_MIN, boundsOf, clampRect, cornersOf, rectSize } from '@/lib/geo/rect';
import type { Params, StatusKey } from '@/lib/i18n/keys';
import type { SiteRect } from '@/lib/types';

export type MapCallbacks = {
  /** Fires on every live drag frame as well as on commit. */
  onSite: (rect: SiteRect | null) => void;
  /**
   * Draw-mode changes. Reported separately from onSite because finishing a
   * gesture sets the rectangle before it disarms — deriving one from the other
   * would leave the Draw site button lit after a completed rectangle.
   */
  onArmed: (armed: boolean) => void;
  onStatus: (key: StatusKey, params?: Params) => void;
};

/** below this a press-release counts as a click */
const DRAG_PX = 6;

/**
 * The 2D site map — Leaflet over OSM tiles. The rectangle drawn here is the
 * only description of the site: there is no centre point to type and no radius,
 * so every fetch reads this rectangle and nothing else.
 *
 * Kept imperative and out of react-leaflet: the drawing gesture is hand-written
 * on raw mousedown/mousemove listeners with map.dragging.disable() and
 * DomUtil.disableTextSelection(), which a declarative wrapper would fight.
 */
export class MapController {
  private readonly L: typeof L;
  private readonly map: L.Map;
  private readonly cb: MapCallbacks;
  private readonly resizeObserver: ResizeObserver;

  private siteRect: SiteRect | null = null;
  private rectLayer: L.Rectangle | null = null;
  private handles: L.Marker[] = [];
  private armed = false;
  private dragIdx = -1;
  private dragAnchor: L.LatLng | null = null;

  // Two-click drawing: drawStart holds the first corner while we wait for the
  // second, preDrawRect is what Esc puts back (null when there was no site).
  private drawStart: L.LatLng | null = null;
  private preDrawRect: SiteRect | null = null;
  private drawTeardown: (() => void) | null = null;

  private constructor(leaflet: typeof L, host: HTMLElement, cb: MapCallbacks) {
    this.L = leaflet;
    this.cb = cb;

    // shift-drag is ours now
    this.map = leaflet.map(host, { boxZoom: false, zoomControl: false });
    leaflet.control.zoom({ position: 'topright' }).addTo(this.map);
    leaflet
      .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      .addTo(this.map);
    this.map.setView([48.8539, 2.3407], 5);

    this.map.on('mousedown', (ev: L.LeafletMouseEvent) => {
      if (this.drawStart) return; // corner one is down, phase two owns it
      if (this.armed || (ev.originalEvent as MouseEvent).shiftKey) this.startDraw(ev);
    });

    // The sheet is fluid and the map spends time hidden behind the 3D view, so
    // it needs a poke on resize. Skip while hidden: measuring a display:none
    // element would cache a zero size, and the view switch re-invalidates anyway.
    this.resizeObserver = new ResizeObserver(() => {
      if (host.offsetParent !== null) this.map.invalidateSize();
    });
    if (host.parentNode instanceof Element) this.resizeObserver.observe(host.parentNode);
  }

  /**
   * Leaflet touches `window` at import time, so it is loaded here rather than at
   * module scope — a static export prerenders this page at build time, where
   * there is no window and a top-level import would throw.
   */
  static async create(host: HTMLElement, cb: MapCallbacks): Promise<MapController> {
    const leaflet = (await import('leaflet')).default as unknown as typeof L;
    return new MapController(leaflet, host, cb);
  }

  get rect(): SiteRect | null {
    return this.siteRect;
  }

  /** armed || mid-gesture — Escape precedence needs this. */
  get isDrawing(): boolean {
    return this.armed || !!this.drawStart;
  }

  private siteBounds(): L.LatLngBounds {
    const b = this.siteRect!;
    return this.L.latLngBounds([b.minLat, b.minLon], [b.maxLat, b.maxLon]);
  }

  private setSite(
    r: SiteRect,
    { anchor = null, live = false }: { anchor?: L.LatLng | null; live?: boolean } = {},
  ): void {
    const { rect, clamped } = clampRect(r, anchor);
    this.siteRect = rect;
    this.syncSiteLayers();
    this.cb.onSite(rect);
    if (clamped && !live) this.cb.onStatus('status.siteClamped', { min: SITE_MIN, max: SITE_MAX });
  }

  private clearSiteLayers(): void {
    if (this.rectLayer) {
      this.map.removeLayer(this.rectLayer);
      this.rectLayer = null;
    }
    this.handles.forEach((h) => this.map.removeLayer(h));
    this.handles = [];
    this.dragIdx = -1;
    this.dragAnchor = null;
  }

  /**
   * There is no site until the user draws one, so every consumer has to cope
   * with the rectangle being null — this is the state the page boots into.
   */
  private clearSite(): void {
    this.siteRect = null;
    this.clearSiteLayers();
    this.cb.onSite(null);
  }

  private syncSiteLayers(): void {
    if (!this.siteRect) return this.clearSiteLayers();
    const corners = cornersOf(this.siteRect);
    if (!this.rectLayer) {
      this.rectLayer = this.L.rectangle(this.siteBounds(), {
        className: 'site-rect',
        color: '#F0FB29',
        weight: 2,
        dashArray: '6 4',
        fillColor: '#F0FB29',
        fillOpacity: 0.12,
        bubblingMouseEvents: false, // grabbing the rect must not also draw
      }).addTo(this.map);
      this.rectLayer.on('mousedown', (ev) => this.onRectDown(ev as L.LeafletMouseEvent));
    } else this.rectLayer.setBounds(this.siteBounds());

    // Mid-draw the rectangle is only a preview, so it gets no grab handles to
    // swallow the closing click.
    if (this.drawStart) {
      this.handles.forEach((h) => this.map.removeLayer(h));
      this.handles = [];
      return;
    }

    corners.forEach((c, i) => {
      if (!this.handles[i]) {
        const mk = this.L.marker(c, {
          draggable: true,
          keyboard: false,
          icon: this.L.divIcon({ className: 'site-handle', iconSize: [11, 11] }),
        }).addTo(this.map);
        mk.on('dragstart', () => {
          this.dragIdx = i;
          const opp = cornersOf(this.siteRect!)[(i + 2) % 4];
          this.dragAnchor = this.L.latLng(opp[0], opp[1]);
        });
        mk.on('drag', (e) =>
          this.setSite(boundsOf(this.dragAnchor!, (e.target as L.Marker).getLatLng()), {
            anchor: this.dragAnchor,
            live: true,
          }),
        );
        mk.on('dragend', () => {
          this.dragIdx = -1;
          this.dragAnchor = null;
          this.syncSiteLayers();
          this.reportSite();
        });
        this.handles[i] = mk;
      } else if (i !== this.dragIdx) {
        this.handles[i].setLatLng(c); // Leaflet owns the one being dragged
      }
    });
  }

  private reportSite(): void {
    if (!this.siteRect) return;
    const m = rectSize(this.siteRect);
    this.cb.onStatus('status.siteSet', { w: Math.round(m.w), h: Math.round(m.h) });
  }

  private setArmed(v: boolean): void {
    this.armed = v;
    if (!v) this.endDraw(); // toggling off mid-gesture starts clean
    this.map.getContainer().classList.toggle('drawing', v);
    this.cb.onArmed(v);
  }

  /**
   * Every exit — finished, cancelled, disarmed — goes through here, so no phase
   * can leave a listener attached or the map undraggable.
   */
  private endDraw(): void {
    if (this.drawTeardown) this.drawTeardown();
    this.drawTeardown = null;
    this.drawStart = null;
    this.map.dragging.enable();
    this.L.DomUtil.enableTextSelection();
  }

  private finishDraw(latlng: L.LatLng): void {
    const start = this.drawStart!;
    this.endDraw();
    this.setSite(boundsOf(start, latlng), { anchor: start });
    this.setArmed(false);
    this.reportSite();
  }

  /** Esc: an unfinished gesture puts back whatever was on the map before it. */
  cancelDraw(): void {
    const started = !!this.drawStart;
    this.endDraw();
    this.setArmed(false);
    if (!started) return this.cb.onStatus('status.drawModeOff');
    if (this.preDrawRect) this.setSite(this.preDrawRect);
    else this.clearSite();
    this.preDrawRect = null;
    this.cb.onStatus('status.drawCancelled');
  }

  /**
   * One gesture, two ways through it. Press-drag-release sweeps the rectangle
   * out in one go; press-release under DRAG_PX is read as the first of two
   * corner clicks and hands over to the phase below. Both entry points — the map
   * background and the rectangle itself — are gated on armed or shift.
   */
  private startDraw(ev: L.LeafletMouseEvent): void {
    const start = ev.latlng;
    const from = this.map.mouseEventToContainerPoint(ev.originalEvent as MouseEvent);
    this.preDrawRect = this.siteRect ? { ...this.siteRect } : null;
    this.drawStart = start;
    this.L.DomEvent.preventDefault(ev.originalEvent as MouseEvent);
    this.map.dragging.disable();
    this.L.DomUtil.disableTextSelection();

    const move = (e: MouseEvent) =>
      this.setSite(boundsOf(start, this.map.mouseEventToLatLng(e)), { anchor: start, live: true });
    const detach = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    const up = (e: MouseEvent) => {
      detach();
      const to = this.map.mouseEventToContainerPoint(e);
      if (from.distanceTo(to) > DRAG_PX) this.finishDraw(this.map.mouseEventToLatLng(e));
      else {
        this.map.dragging.enable();
        this.L.DomUtil.enableTextSelection();
        this.waitForSecondCorner();
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    this.drawTeardown = detach; // so Esc mid-drag unwinds this too
  }

  /**
   * Between the two clicks the map still has to pan, so the rubber band only
   * tracks a cursor with no button held, and a press that travels is a pan
   * rather than the closing click.
   */
  private waitForSecondCorner(): void {
    const c = this.map.getContainer();
    let downAt: L.Point | null = null;
    const move = (e: MouseEvent) => {
      if (e.buttons !== 0 || !this.drawStart) return;
      this.setSite(boundsOf(this.drawStart, this.map.mouseEventToLatLng(e)), {
        anchor: this.drawStart,
        live: true,
      });
    };
    const down = (e: MouseEvent) => {
      downAt = this.map.mouseEventToContainerPoint(e);
    };
    const up = (e: MouseEvent) => {
      if (!this.drawStart) return;
      const to = this.map.mouseEventToContainerPoint(e);
      if (downAt && downAt.distanceTo(to) > DRAG_PX) return; // that was a pan
      this.finishDraw(this.map.mouseEventToLatLng(e));
    };
    c.addEventListener('mousemove', move);
    c.addEventListener('mousedown', down);
    c.addEventListener('mouseup', up);
    this.drawTeardown = () => {
      c.removeEventListener('mousemove', move);
      c.removeEventListener('mousedown', down);
      c.removeEventListener('mouseup', up);
    };
    this.cb.onStatus('status.cornerSet');
  }

  private onRectDown(ev: L.LeafletMouseEvent): void {
    if (this.drawStart) return; // waiting for corner two — the rectangle is a preview
    if (this.armed || (ev.originalEvent as MouseEvent).shiftKey) return this.startDraw(ev);
    const start = ev.latlng;
    const base = { ...this.siteRect! };
    this.L.DomEvent.preventDefault(ev.originalEvent as MouseEvent);
    this.map.dragging.disable();
    this.L.DomUtil.disableTextSelection();
    const move = (e: MouseEvent) => {
      const p = this.map.mouseEventToLatLng(e);
      const dLat = p.lat - start.lat;
      const dLon = p.lng - start.lng;
      this.setSite(
        {
          minLat: base.minLat + dLat,
          maxLat: base.maxLat + dLat,
          minLon: base.minLon + dLon,
          maxLon: base.maxLon + dLon,
        },
        { live: true },
      );
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      this.map.dragging.enable();
      this.L.DomUtil.enableTextSelection();
      this.reportSite();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  /* ---- public API ---------------------------------------------------- */

  /** Search and the city presets move the map, then hand the drawing back. */
  arm(): void {
    this.setArmed(true);
    this.cb.onStatus('status.drawPrompt');
  }

  /**
   * The other half of the Draw|Pan toggle. Drawing is armed from the moment the
   * page opens, so there has to be an explicit way back to a map that pans:
   * cancelDraw is the same exit Escape takes, unwinding a half-finished gesture
   * and putting the previous rectangle back.
   */
  pan(): void {
    if (this.armed) this.cancelDraw();
  }

  toggleArm(): void {
    if (this.armed) this.cancelDraw();
    else this.arm();
  }

  setView(lat: number, lon: number, zoom: number): void {
    this.map.setView([lat, lon], zoom);
  }

  fitBounds(rect: SiteRect): void {
    this.map.fitBounds(
      this.L.latLngBounds([rect.minLat, rect.minLon], [rect.maxLat, rect.maxLon]),
      { padding: [26, 26] },
    );
  }

  fitBoundsRaw(minLat: number, minLon: number, maxLat: number, maxLon: number): void {
    this.map.fitBounds(this.L.latLngBounds([minLat, minLon], [maxLat, maxLon]), { maxZoom: 16 });
  }

  invalidateSize(): void {
    this.map.invalidateSize();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.endDraw();
    this.map.remove();
  }
}

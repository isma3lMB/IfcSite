import type * as L from 'leaflet';
import { SITE_MAX, SITE_MIN, boundsOf, clampRect, cornersOf, rectSize } from '@/lib/geo/rect';
import type { Params, StatusKey } from '@/lib/i18n/keys';
import type { SiteRect } from '@/lib/types';

export type MapCallbacks = {
  /** Fires on every live drag frame as well as on commit; `live` tells them apart. */
  onSite: (rect: SiteRect | null, live: boolean) => void;
  /**
   * Draw-mode changes. Reported separately from onSite because finishing a
   * gesture sets the rectangle before it disarms — deriving one from the other
   * would leave the Draw site button lit after a completed rectangle.
   */
  onArmed: (armed: boolean) => void;
  onStatus: (key: StatusKey, params?: Params) => void;
};

/**
 * Below this a press-release counts as a click rather than a drag.
 *
 * Per pointer type, because a fingertip is not a mouse: it lands on a patch
 * rather than a point and it wanders while it is down, so 6 px reads half the
 * taps on a phone as tiny rectangles. The mouse keeps the 6 it always had.
 */
const DRAG_PX = { fine: 6, coarse: 12 };
const dragPx = (e: PointerEvent): number =>
  e.pointerType === 'mouse' ? DRAG_PX.fine : DRAG_PX.coarse;

/**
 * The basemap. Both themes share this one tile source — dark mode is a CSS
 * invert filter over the tile pane (see .leaflet-tile-pane in globals.css),
 * not a different provider — so the map keeps the same labels and style in
 * either theme instead of drifting to a second cartography style.
 */
const BASEMAP = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

/**
 * The 2D site map — Leaflet over OSM tiles. The rectangle drawn here is the
 * only description of the site: there is no centre point to type and no radius,
 * so every fetch reads this rectangle and nothing else.
 *
 * Kept imperative and out of react-leaflet: the drawing gesture is hand-written
 * on raw pointer listeners with map.dragging.disable() and
 * DomUtil.disableTextSelection(), which a declarative wrapper would fight.
 */
export class MapController {
  private readonly L: typeof L;
  private readonly map: L.Map;
  private readonly cb: MapCallbacks;
  private readonly resizeObserver: ResizeObserver;

  /** The live ceiling from the options panel's Advanced group, which arrives
   *  after construction and can change again — hence a field rather than an
   *  argument. */
  private siteMax = SITE_MAX;

  private siteRect: SiteRect | null = null;
  private rectLayer: L.Rectangle | null = null;
  private handles: L.Marker[] = [];

  /** Where the last search landed. Not part of the site — see setPin. */
  private pinLayer: L.Marker | null = null;
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
      .tileLayer(BASEMAP.url, {
        maxZoom: 19,
        attribution: BASEMAP.attribution,
      })
      .addTo(this.map);
    this.map.setView([48.8539, 2.3407], 5);

    // Bound to the container's own pointer stream rather than through
    // map.on('mousedown'). Leaflet registers only mouse events on its container,
    // so on a touch screen that callback arrives once, synthesised, after the
    // finger has already lifted — by which time the drag it was meant to open is
    // over. Pointer events are the one stream a mouse, a finger and a stylus all
    // arrive on, and drawing the site rectangle is this app's first mandatory
    // step: it has to work by finger.
    //
    // What Leaflet's routing did for free and this has to do by hand is tell a
    // press on a layer from a press on the map. See onPointerDown.
    this.map.getContainer().addEventListener('pointerdown', this.onPointerDown);

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

  /**
   * The longest side a drawn rectangle may have, in metres.
   *
   * Binds the next gesture, not the current rectangle: lowering the ceiling
   * under a site you already drew would move a rectangle you did not touch, and
   * silently invalidate the scene built from it.
   */
  setSiteLimits(max: number): void {
    this.siteMax = max;
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
    this.clearPin();
    const { rect, clamped } = clampRect(r, anchor, this.siteMax);
    this.siteRect = rect;
    this.syncSiteLayers();
    this.cb.onSite(rect, live);
    // Reports the live ceiling, not the shipped one, so the toast cannot name a
    // limit the drag was not actually held to.
    if (clamped && !live)
      this.cb.onStatus('status.siteClamped', { min: SITE_MIN, max: this.siteMax });
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
    this.cb.onSite(null, false);
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
        bubblingMouseEvents: false, // the rect's own clicks are not the map's
      }).addTo(this.map);
      // No layer handler for the grab-and-move gesture: Leaflet's layer events
      // are mouse-only, so it is routed by target in onPointerDown instead, on
      // the className given above.
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
          this.cb.onSite(this.siteRect, false);
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

  /**
   * Unwind an unfinished gesture and put back whatever was on the map before it,
   * without touching the tool. Split out of cancelDraw for the paths that are
   * not the user changing their mind: a pointercancel, or a second finger
   * arriving. Nothing was decided there and the tool was never let go, so it
   * stays armed — see cancelDraw for the other half.
   */
  private abortDraw(): boolean {
    const started = !!this.drawStart;
    this.endDraw();
    if (!started) return false;
    if (this.preDrawRect) this.setSite(this.preDrawRect);
    else this.clearSite();
    this.preDrawRect = null;
    return true;
  }

  /** Esc: an unfinished gesture puts back whatever was on the map before it. */
  cancelDraw(): void {
    const started = this.abortDraw();
    this.setArmed(false);
    this.cb.onStatus(started ? 'status.drawCancelled' : 'status.drawModeOff');
  }

  /**
   * Every press on the map arrives here first, and this decides whose it is.
   *
   * Leaflet's own furniture keeps its own handlers: the zoom control, and the
   * four corner markers, whose L.Draggable already speaks touch. The rectangle
   * is ours to move, and everything else is either a new rectangle or a pan.
   */
  private readonly onPointerDown = (e: PointerEvent): void => {
    // A second finger is a pinch, not a rectangle. Hand the gesture back to
    // Leaflet's own zoom, and put the map the way it was before the first.
    if (!e.isPrimary) {
      this.abortDraw();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.drawStart) return; // corner one is down, phase two owns it
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest('.leaflet-control, .site-handle')) return;
    if (el?.closest('.site-rect')) return this.onRectDown(e);
    if (this.armed || e.shiftKey) this.startDraw(e);
  };

  /**
   * One gesture, two ways through it. Press-drag-release sweeps the rectangle
   * out in one go; press-release under DRAG_PX is read as the first of two
   * corner clicks and hands over to the phase below. Both entry points — the map
   * background and the rectangle itself — are gated on armed or shift.
   */
  private startDraw(ev: PointerEvent): void {
    const start = this.map.mouseEventToLatLng(ev);
    const from = this.map.mouseEventToContainerPoint(ev);
    const threshold = dragPx(ev);
    this.preDrawRect = this.siteRect ? { ...this.siteRect } : null;
    this.drawStart = start;
    ev.preventDefault();
    this.map.dragging.disable();
    this.L.DomUtil.disableTextSelection();

    // Captured, so a pointer that leaves the map mid-sweep — over the dock, or
    // off the edge of a phone screen — still finishes its rectangle. The mouse
    // version listened on `document` to get the same effect; capture is what
    // does it for touch, where there is no such thing as dragging off an element
    // and back on.
    const c = this.map.getContainer();
    c.setPointerCapture(ev.pointerId);

    const move = (e: PointerEvent) => {
      if (e.pointerId !== ev.pointerId) return;
      this.setSite(boundsOf(start, this.map.mouseEventToLatLng(e)), { anchor: start, live: true });
    };
    const detach = () => {
      if (c.hasPointerCapture(ev.pointerId)) c.releasePointerCapture(ev.pointerId);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', cancel);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== ev.pointerId) return;
      detach();
      const to = this.map.mouseEventToContainerPoint(e);
      if (from.distanceTo(to) > threshold) this.finishDraw(this.map.mouseEventToLatLng(e));
      else {
        this.map.dragging.enable();
        this.L.DomUtil.enableTextSelection();
        this.waitForSecondCorner();
      }
    };
    // A path the mouse gesture never had to have: the system can take a pointer
    // back mid-sweep. Unwound rather than ignored, or the map would be left
    // undraggable with a half-drawn rectangle on it.
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === ev.pointerId) this.abortDraw();
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', cancel);
    this.drawTeardown = detach; // so Esc mid-drag unwinds this too
  }

  /**
   * Between the two clicks the map still has to pan, so the rubber band only
   * tracks a cursor with no button held, and a press that travels is a pan
   * rather than the closing click.
   *
   * "A cursor with no button held" is a hover, and touch has none — so on a
   * finger there is no preview between the two taps, only the status line saying
   * a corner is set. That is the honest version rather than a missing feature:
   * previewing would mean tracking the second press, and the second press is
   * also how the map is panned to wherever the far corner is. Sweeping in one
   * motion is the touch gesture that does preview, and it is the primary one.
   */
  private waitForSecondCorner(): void {
    const c = this.map.getContainer();
    let downAt: L.Point | null = null;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons !== 0 || !this.drawStart) return;
      this.setSite(boundsOf(this.drawStart, this.map.mouseEventToLatLng(e)), {
        anchor: this.drawStart,
        live: true,
      });
    };
    const down = (e: PointerEvent) => {
      downAt = this.map.mouseEventToContainerPoint(e);
    };
    const up = (e: PointerEvent) => {
      if (!this.drawStart) return;
      const to = this.map.mouseEventToContainerPoint(e);
      if (downAt && downAt.distanceTo(to) > dragPx(e)) return; // that was a pan
      this.finishDraw(this.map.mouseEventToLatLng(e));
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointerup', up);
    this.drawTeardown = () => {
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointerup', up);
    };
    this.cb.onStatus('status.cornerSet');
  }

  private onRectDown(ev: PointerEvent): void {
    if (this.drawStart) return; // waiting for corner two — the rectangle is a preview
    if (this.armed || ev.shiftKey) return this.startDraw(ev);
    const start = this.map.mouseEventToLatLng(ev);
    const base = { ...this.siteRect! };
    ev.preventDefault();
    this.map.dragging.disable();
    this.L.DomUtil.disableTextSelection();
    const c = this.map.getContainer();
    c.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== ev.pointerId) return;
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
    const up = (e: PointerEvent) => {
      if (e.pointerId !== ev.pointerId) return;
      if (c.hasPointerCapture(ev.pointerId)) c.releasePointerCapture(ev.pointerId);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      this.map.dragging.enable();
      this.L.DomUtil.enableTextSelection();
      this.reportSite();
      this.cb.onSite(this.siteRect, false);
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    // Cancelled and released end the same way here, unlike a draw: the rectangle
    // has been moving live the whole time, so wherever it is when the system
    // takes the pointer back is where it already is on screen. Putting it back
    // would be the surprise.
    c.addEventListener('pointercancel', up);
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

  /**
   * Put a restored site rectangle back on the map.
   *
   * Deliberately not setSite, which is the *gesture* path: that one clamps, it
   * reports, and it calls back through onSite — which the page reads as "the
   * rectangle moved, so the scene no longer describes it" and would mark a
   * freshly opened draft stale the instant it loaded. Nothing has moved here.
   * React already holds this rectangle; the map is only catching up to it.
   *
   * No clamp either, for the reason setSiteLimits gives: a rectangle that has
   * already been built from must not be cropped by a ceiling that changed after
   * the fact.
   *
   * setView rather than fitBounds because an opened draft lands in the 3D tab,
   * and fitBounds measures a container that is still display:none. Framing is
   * the caller's to queue — see runOnMap in components/ifc-site.
   */
  showSite(rect: SiteRect): void {
    this.clearPin(); // a restored draft arrives with a site; no search led here
    this.siteRect = { ...rect };
    this.syncSiteLayers();
    // A restored site is not an invitation to draw another one over it.
    if (this.armed) this.setArmed(false);
    this.map.setView([(rect.minLat + rect.maxLat) / 2, (rect.minLon + rect.maxLon) / 2], 16);
  }

  /**
   * Marks where a search landed, so the pan has a point rather than just a
   * rough neighbourhood — the next thing anyone does is draw the site over that
   * spot, and the tiles alone do not say which building was meant.
   *
   * There is only ever one pin: repeated searches move this marker rather than
   * leaving a trail. It is not a site and never becomes one, so drawing a
   * rectangle takes it away (see setSite).
   *
   * Non-interactive on purpose. The drawing gesture is hand-written on raw
   * mousedown/mousemove, and a marker that accepted the pointer would sit over
   * the very spot the user is about to click and swallow a corner.
   */
  setPin(lat: number, lon: number): void {
    if (this.pinLayer) return void this.pinLayer.setLatLng([lat, lon]);
    this.pinLayer = this.L.marker([lat, lon], {
      interactive: false,
      keyboard: false,
      // The div is a 16 px square that CSS rotates 45° into a teardrop, which
      // swings its sharp corner to 8·√2 ≈ 11 px below centre — so the tip, and
      // therefore the coordinate, sits at y = 8 + 11 = 19.
      icon: this.L.divIcon({ className: 'search-pin', iconSize: [16, 16], iconAnchor: [8, 19] }),
    }).addTo(this.map);
  }

  clearPin(): void {
    if (!this.pinLayer) return;
    this.map.removeLayer(this.pinLayer);
    this.pinLayer = null;
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
    this.map.getContainer().removeEventListener('pointerdown', this.onPointerDown);
    this.endDraw();
    this.clearPin();
    this.map.remove();
  }
}

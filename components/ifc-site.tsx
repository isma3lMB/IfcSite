'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ControlsPanel } from '@/components/controls-panel';
import { type AxisKey, ElementEditor } from '@/components/element-editor';
import { FlowBar } from '@/components/flow-bar';
import { InfoOverlay } from '@/components/info-overlay';
import { Stage, StageHud } from '@/components/stage';
import type { StatusState } from '@/components/status-line';
import { TopBar } from '@/components/top-bar';
import { IfcEmitter } from '@/lib/build/emitter';
import { runBuild } from '@/lib/build/run';
import { useT } from '@/lib/i18n/context';
import type { Place } from '@/lib/sources/nominatim';
import type { BuildOptions, GizmoMode, IfcStats, SiteMeta, SiteRect, Vec3, ViewTab } from '@/lib/types';
import { MapController } from '@/lib/viewer/MapController';
import { type Selection, Viewer } from '@/lib/viewer/Viewer';

/**
 * The projected easting/northing the exported file calls (0,0,0). That is the
 * site origin plus wherever the user has dragged the origin marker, so this is
 * read again every time the marker moves rather than only at build time.
 */
const originLabelOf = (m: SiteMeta): string =>
  `${m.epsg}  E ${(m.origin[0] + m.exportOffset[0]).toFixed(1)}  N ${(
    m.origin[1] + m.exportOffset[1]
  ).toFixed(1)}`;

const DEFAULT_FORM: BuildOptions = {
  epsg: '2154',
  defaultHeight: 9,
  provider: 'ign',
  roads: true,
  terrain: false,
  terrainAccuracy: 'standard',
  trees: false,
  veg: false,
  water: false,
  parcels: false,
};

export function IfcSite() {
  const { t } = useT();

  /* ---- imperative state, deliberately outside React ------------------
     The scene is thousands of buildings with their rings; the viewer mutates
     it in place during an edit. React only ever sees derived numbers and the
     selected element's xf snapshot. */
  const viewportRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const mapRef = useRef<MapController | null>(null);
  // The emitter holds the live scene; the viewer mutates that same object in
  // place during an edit, which is how a gizmo drag reaches the download.
  const emitterRef = useRef<IfcEmitter | null>(null);
  const metaRef = useRef<SiteMeta | null>(null);
  /** Deferred until the map tab is actually laid out; see runOnMap. */
  const pendingMapAction = useRef<(() => void) | null>(null);
  /** Mirrors infoOpen for the mount-only key handler, which would otherwise
      close over the value it had on the first render. */
  const infoOpenRef = useRef(false);

  /* ---- React state --------------------------------------------------- */
  const [form, setForm] = useState<BuildOptions>(DEFAULT_FORM);
  const [rect, setRect] = useState<SiteRect | null>(null);
  const [armed, setArmed] = useState(false);
  const [view, setView] = useState<ViewTab>('map');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusState>({ kind: 'msg', key: 'status.ready' });
  const [stats, setStats] = useState<IfcStats | null>(null);
  const [buildings, setBuildings] = useState<number | null>(null);
  const [taggedPct, setTaggedPct] = useState<number | null>(null);
  const [originLabel, setOriginLabel] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [uniform, setUniform] = useState(false);
  const [hasScene, setHasScene] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  /** Matches the viewer's own default; the marker is opt-in. */
  const [showOrigin, setShowOrigin] = useState(false);
  /* The local project coordinate system the origin point is mapped to. Pure
     export metadata — the viewer never sees it and the scene never moves — so it
     lives here rather than in the viewer, and outside the undo stack, which
     records gestures. Angle is degrees, counter-clockwise from grid east. */
  const [projectBase, setProjectBase] = useState<Vec3>([0, 0, 0]);
  const [projectAngle, setProjectAngle] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  /** The rectangle moved since the last build, so the scene on screen — and the
      IFC behind Download — no longer describes it. */
  const [siteDirty, setSiteDirty] = useState(false);

  /* ---- viewer ---------------------------------------------------------- */
  useEffect(() => {
    if (!viewportRef.current) return;
    const v = new Viewer(viewportRef.current, {
      onSelect: setSelection,
      onTransform: (xf) => setSelection((s) => (s ? { ...s, xf } : s)),
      onHistory: (u, r) => {
        setCanUndo(u);
        setCanRedo(r);
      },
      onStatus: (key, params) => setStatus({ kind: 'msg', key, params }),
      onDirty: () => emitterRef.current?.markDirty(),
      // The emitter holds this same meta object, so writing the offset into it
      // is all the export needs — the onDirty the viewer already fires re-serialises.
      onOrigin: (off) => {
        const m = metaRef.current;
        if (!m) return;
        m.exportOffset = off;
        setOriginLabel(originLabelOf(m));
      },
      onMode: setGizmoMode,
    });
    viewerRef.current = v;
    v.setCompassElement(compassRef.current);
    emitterRef.current = new IfcEmitter(setStats);
    return () => {
      v.dispose();
      viewerRef.current = null;
      emitterRef.current?.reset();
    };
  }, []);

  /* ---- map ------------------------------------------------------------- */
  useEffect(() => {
    if (!mapHostRef.current) return;
    let disposed = false;
    MapController.create(mapHostRef.current, {
      onSite: (r) => {
        setRect(r);
        setSiteDirty(true);
      },
      onArmed: setArmed,
      onStatus: (key, params) => setStatus({ kind: 'msg', key, params }),
    }).then((m) => {
      if (disposed) return m.dispose();
      mapRef.current = m;
      // Drawing is the first thing anyone does here, so it is live on arrival
      // rather than waiting behind a button. Pan is one click (or Esc) away.
      m.arm();
    });
    return () => {
      disposed = true;
      mapRef.current?.dispose();
      mapRef.current = null;
    };
  }, []);

  /* ---- view tab -------------------------------------------------------- */
  useEffect(() => {
    viewerRef.current?.setActive(view === '3d');
    if (view !== 'map') return;
    mapRef.current?.invalidateSize();
    // Anything that needed a laid-out map runs now, not when it was requested.
    const queued = pendingMapAction.current;
    pendingMapAction.current = null;
    queued?.();
  }, [view]);

  /**
   * Leaflet measures its container, and switching tabs is a React state change
   * that has not been committed yet when the handler runs. Anything that moves
   * the map therefore waits until the map is actually on screen — calling
   * fitBounds against a display:none container frames it against zero size.
   */
  const runOnMap = useCallback(
    (fn: (m: MapController) => void) => {
      if (view === 'map') {
        const m = mapRef.current;
        if (!m) return;
        m.invalidateSize();
        fn(m);
      } else {
        pendingMapAction.current = () => mapRef.current && fn(mapRef.current);
        setView('map');
      }
    },
    [view],
  );

  /* ---- keyboard -------------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k !== 'z' && k !== 'y') return;
        // leave native undo to the text fields
        if (inField && (el as HTMLInputElement).type === 'text') return;
        e.preventDefault();
        if (k === 'y' || e.shiftKey) viewerRef.current?.redo();
        else viewerRef.current?.undo();
        return;
      }
      if (inField || e.altKey) return;

      // Escape unwinds whatever is open, outermost first: the info card, then a
      // drawing gesture, then the 3D selection.
      if (e.key === 'Escape') {
        if (infoOpenRef.current) closeInfo();
        else if (mapRef.current?.isDrawing) mapRef.current.cancelDraw();
        else viewerRef.current?.select(null);
      } else if (e.key === 'w' || e.key === 'W') applyMode('translate');
      else if (e.key === 'e' || e.key === 'E') applyMode('rotate');
      else if (e.key === 'r' || e.key === 'R') applyMode('scale');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The viewer can refuse — the origin marker only translates — and the buttons
  // must not claim a mode the gizmo is not actually in.
  const applyMode = useCallback((m: GizmoMode) => {
    if (viewerRef.current?.setMode(m) === false) return;
    setGizmoMode(m);
  }, []);

  const onShowOrigin = useCallback((v: boolean) => {
    setShowOrigin(v);
    viewerRef.current?.setMarkerVisible(v);
  }, []);

  /* The emitter holds the very same meta object, so writing through to it and
     marking dirty is the whole path to the download — the same trick the origin
     marker's onOrigin uses. No viewer call: nothing on screen changes. */
  const writePlacement = useCallback((base: Vec3, angle: number) => {
    setProjectBase(base);
    setProjectAngle(angle);
    const m = metaRef.current;
    if (!m) return;
    m.projectBase = base;
    m.projectAngle = angle;
    emitterRef.current?.markDirty();
  }, []);

  const onProjectBase = useCallback(
    (i: number, v: number) => {
      if (!Number.isFinite(v)) return;
      const next = [...projectBase] as Vec3;
      next[i] = v;
      writePlacement(next, projectAngle);
    },
    [projectBase, projectAngle, writePlacement],
  );

  const onProjectAngle = useCallback(
    (v: number) => {
      if (Number.isFinite(v)) writePlacement(projectBase, v);
    },
    [projectBase, writePlacement],
  );

  const onResetPlacement = useCallback(
    () => writePlacement([0, 0, 0], 0),
    [writePlacement],
  );

  /* The ref is what the mount-only key handler reads; the state is what
     renders. They are only ever written together. */
  const setInfo = useCallback((v: boolean) => {
    infoOpenRef.current = v;
    setInfoOpen(v);
  }, []);
  const closeInfo = useCallback(() => setInfo(false), [setInfo]);
  const toggleInfo = useCallback(() => setInfo(!infoOpenRef.current), [setInfo]);

  /* ---- form ------------------------------------------------------------ */
  const onFormChange = useCallback((patch: Partial<BuildOptions>) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (patch.provider && patch.provider !== f.provider) {
        if (patch.provider === 'ign') {
          next.epsg = '2154'; // Lambert-93 is the datum IGN publishes in
        } else {
          // The IGN-only layers have no OSM equivalent, so they go with it.
          next.veg = false;
          next.water = false;
          next.parcels = false;
        }
      }
      return next;
    });
  }, []);

  /* ---- actions --------------------------------------------------------- */
  // Draw and Pan are the two halves of one toggle rather than one button that
  // flips: the flow bar shows which of them is live, so each is a direct move.
  const onDraw = useCallback(() => {
    setView('map');
    mapRef.current?.arm(); // armed state comes back through onArmed
  }, []);

  const onPan = useCallback(() => {
    setView('map');
    mapRef.current?.pan();
  }, []);

  const onZoom = useCallback(() => {
    if (!rect) return setStatus({ kind: 'msg', key: 'status.noSiteYet', tone: 'err' });
    runOnMap((m) => m.fitBounds(rect));
  }, [rect, runOnMap]);

  const onPickPlace = useCallback(
    (p: Place) => {
      runOnMap((m) => {
        const bb = p.boundingbox;
        if (bb) m.fitBoundsRaw(+bb[0], +bb[2], +bb[1], +bb[3]);
        else m.setView(+p.lat, +p.lon, 16);
        // Going somewhere is not choosing a site — the rectangle stays the
        // user's two clicks, so this only arms the map for them.
        m.arm();
      });
    },
    [runOnMap],
  );

  const onBuild = useCallback(async () => {
    if (!rect) return setStatus({ kind: 'error', error: new Error(t('err.noSite')) });
    setBusy(true);
    const res = await runBuild(rect, form, (key, params) =>
      setStatus({ kind: 'msg', key, params }),
    );
    if (!res.ok) {
      setBusy(false);
      setStatus({ kind: 'error', error: res.error });
      return;
    }

    metaRef.current = res.meta;
    setBuildings(res.summary.buildings);
    setTaggedPct(Math.round((100 * res.summary.tagged) / res.summary.buildings));
    setOriginLabel(originLabelOf(res.meta));
    // A rebuild re-derives the site, so a placement measured against the old one
    // means nothing. res.meta already carries the zeroes; this just follows it.
    setProjectBase([0, 0, 0]);
    setProjectAngle(0);

    emitterRef.current?.setSource(res.scene, res.meta);
    viewerRef.current?.setScene(res.scene, res.site);
    setHasScene(true);
    setSiteDirty(false);
    setView('3d');
    setBusy(false);
    setStatus({ kind: 'summary', summary: res.summary });
  }, [rect, form, t]);

  const onDownload = useCallback(() => {
    // pick up any edit still inside the debounce window
    const text = emitterRef.current?.flush();
    const meta = metaRef.current;
    if (!text || !meta) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/x-step' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `context_${meta.lat.toFixed(4)}_${meta.lon.toFixed(4)}.ifc`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, []);

  /* ---- editor bridges --------------------------------------------------- */
  const onAxis = useCallback(
    (key: AxisKey, i: number, v: number, commit: boolean) =>
      viewerRef.current?.setAxis(key, i, v, uniform, commit),
    [uniform],
  );

  return (
    <div className="app">
      <Stage viewportRef={viewportRef} mapRef={mapHostRef} view={view} />

      {/* Everything below floats over the viewers on a grid, so the dock, the
          element editor and the flow bar can never cover one another and the
          space between them stays transparent to map and orbit gestures. */}
      <div className="overlay">
        <TopBar
          view={view}
          onView={setView}
          originLabel={originLabel}
          buildings={buildings}
          taggedPct={taggedPct}
          stats={stats}
          showOrigin={showOrigin}
          onShowOrigin={onShowOrigin}
          infoOpen={infoOpen}
          onInfo={toggleInfo}
        />

        {dockOpen ? (
          <ControlsPanel
            form={form}
            onChange={onFormChange}
            rect={rect}
            onPickPlace={onPickPlace}
            onSearchFailed={(e) =>
              setStatus({ kind: 'msg', key: 'status.searchUnavailable', tone: 'err', cause: e })
            }
            onCollapse={() => setDockOpen(false)}
          />
        ) : (
          <button
            type="button"
            className="dockTab floating"
            title={t('ui.expand')}
            aria-label={t('ui.expand')}
            onClick={() => setDockOpen(true)}
          >
            ›<span>{t('ui.options')}</span>
          </button>
        )}

        <StageHud compassRef={compassRef} view={view} />

        <ElementEditor
          visible={view === '3d' && hasScene}
          selection={selection}
          gizmoMode={gizmoMode}
          uniform={uniform}
          canUndo={canUndo}
          canRedo={canRedo}
          onMode={applyMode}
          onUniform={setUniform}
          onAxis={onAxis}
          onColor={(hex, commit) => viewerRef.current?.setColor(hex, commit)}
          onColorReset={() => viewerRef.current?.resetColor()}
          onReset={() => viewerRef.current?.resetElement()}
          onResetOrigin={() => viewerRef.current?.resetOrigin()}
          projectBase={projectBase}
          projectAngle={projectAngle}
          onProjectBase={onProjectBase}
          onProjectAngle={onProjectAngle}
          onResetPlacement={onResetPlacement}
          onDeselect={() => viewerRef.current?.select(null)}
          onUndo={() => viewerRef.current?.undo()}
          onRedo={() => viewerRef.current?.redo()}
        />

        <FlowBar
          rect={rect}
          armed={armed}
          busy={busy}
          hasScene={hasScene}
          siteDirty={siteDirty}
          status={status}
          onDraw={onDraw}
          onPan={onPan}
          onZoom={onZoom}
          onBuild={onBuild}
          onDownload={onDownload}
        />
      </div>

      <InfoOverlay open={infoOpen} onClose={closeInfo} />
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandChip } from '@/components/brand-chip';
import { ConfirmCard } from '@/components/confirm-card';
import { ControlsPanel } from '@/components/controls-panel';
import { type AxisKey, ElementEditor } from '@/components/element-editor';
import { InfoOverlay } from '@/components/info-overlay';
import { ModelTree } from '@/components/model-tree';
import { SearchFlyout } from '@/components/search-flyout';
import { SiteReadout } from '@/components/site-readout';
import { Stage } from '@/components/stage';
import { StatusBar } from '@/components/status-bar';
import type { StatusState } from '@/components/status-line';
import { StatusToast } from '@/components/status-toast';
import { ToolRail } from '@/components/tool-rail';
import { UtilChip } from '@/components/util-chip';
import { IfcEmitter } from '@/lib/build/emitter';
import { runBuild } from '@/lib/build/run';
import {
  DEFAULT_TUNABLES,
  SCENE_TUNABLES,
  type Tunables,
  loadTunables,
  saveTunables,
} from '@/lib/build/tunables';
import { EPSG_CHOICES } from '@/lib/geo/crs';
import { bestAt, loadEpsgIndex } from '@/lib/geo/epsg';
import { rectCentre } from '@/lib/geo/rect';
import { useT } from '@/lib/i18n/context';
import { MOVABLE_LAYERS } from '@/lib/scene/layers';
import { type Theme, useTheme } from '@/lib/theme/context';
import type { Place } from '@/lib/sources/nominatim';
import type {
  BuildOptions,
  FormPatch,
  GizmoMode,
  IfcStats,
  LayerId,
  SiteMeta,
  SiteRect,
  Vec3,
  ViewTab,
} from '@/lib/types';
import { MapController } from '@/lib/viewer/MapController';
import {
  type DrawTool,
  type LayerNode,
  type Selection,
  Viewer,
  layerIdOf,
  layerSelId,
} from '@/lib/viewer/Viewer';

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
  buildings: true,
  roads: true,
  railways: false,
  terrain: false,
  terrainAccuracy: 'standard',
  trees: false,
  veg: false,
  water: false,
  parcels: false,
  tune: { ...DEFAULT_TUNABLES },
};

export function IfcSite() {
  const { t } = useT();
  const { theme } = useTheme();

  /* ---- imperative state, deliberately outside React ------------------
     The scene is thousands of buildings with their rings; the viewer mutates
     it in place during an edit. React only ever sees derived numbers and the
     selected element's xf snapshot. */
  const viewportRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const mapRef = useRef<MapController | null>(null);
  /** So the map, which arrives asynchronously, can read the theme on arrival. */
  const themeRef = useRef<Theme>('light');
  /** And the site-size ceiling, for the same reason. */
  const siteMaxRef = useRef(DEFAULT_TUNABLES.siteMax);
  /** Guards the save effect below so mounting with the defaults does not write
   *  them over what is already stored, a beat before the load effect reads it. */
  const tuneHydrated = useRef(false);
  // The emitter holds the live scene; the viewer mutates that same object in
  // place during an edit, which is how a gizmo drag reaches the download.
  const emitterRef = useRef<IfcEmitter | null>(null);
  const metaRef = useRef<SiteMeta | null>(null);
  /** Deferred until the map tab is actually laid out; see runOnMap. */
  const pendingMapAction = useRef<(() => void) | null>(null);
  /** Mirrors infoOpen for the mount-only key handler, which would otherwise
      close over the value it had on the first render. */
  const infoOpenRef = useRef(false);
  /** Same trick for the footprint tool: the key handler has to know which tool
      is armed, and how far into a gesture it is, before deciding what Esc and
      Enter mean. */
  const drawToolRef = useRef<DrawTool | null>(null);
  const drawPointsRef = useRef(0);
  /** And for the confirm card, which outranks everything else Escape unwinds. */
  const confirmOpenRef = useRef(false);
  /** Same again for the options flyout, plus the button it hangs off — Escape
      and the panel's own ✕ both hand focus back there. */
  const optionsOpenRef = useRef(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  /** And once more for the search flyout — mutually exclusive with Options,
      and starts true to match its default-open state below. */
  const searchOpenRef = useRef(true);
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** And once more for the model tree, the third of the rail's flyouts. */
  const treeOpenRef = useRef(false);
  const treeBtnRef = useRef<HTMLButtonElement>(null);

  /* ---- React state --------------------------------------------------- */
  const [form, setForm] = useState<BuildOptions>(DEFAULT_FORM);
  const [rect, setRect] = useState<SiteRect | null>(null);
  const [armed, setArmed] = useState(false);
  const [view, setView] = useState<ViewTab>('map');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusState>({ kind: 'msg', key: 'status.ready' });
  const [stats, setStats] = useState<IfcStats | null>(null);
  const [buildings, setBuildings] = useState<number | null>(null);
  const [originLabel, setOriginLabel] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [uniform, setUniform] = useState(false);
  const [hasScene, setHasScene] = useState(false);
  /** Closed on arrival: these are settings you set once, and the viewer is what
      you came for. */
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** Open on arrival instead — there is no site rectangle yet, and finding a
      place is the natural first move. See the effect below that collapses it
      the moment `rect` is set. */
  const [searchOpen, setSearchOpenState] = useState(true);
  /** The model tree, and the layers it lists. The nodes are derived in the
      viewer and pulled from it whenever the counts change — see the effect
      below — rather than pushed through a callback of their own. */
  const [treeOpen, setTreeOpenState] = useState(false);
  const [layerNodes, setLayerNodes] = useState<LayerNode[]>([]);
  /** Matches the viewer's own default; the marker is opt-in. */
  const [showOrigin, setShowOrigin] = useState(false);
  /** Also the viewer's default. Held here rather than reported back, like the
      marker above: nothing in the viewer changes it on its own. */
  const [ortho, setOrtho] = useState(false);
  /* The local project coordinate system the origin point is mapped to. Pure
     export metadata — the viewer never sees it and the scene never moves — so it
     lives here rather than in the viewer, and outside the undo stack, which
     records gestures. Angle is degrees, counter-clockwise from grid east. */
  const [projectBase, setProjectBase] = useState<Vec3>([0, 0, 0]);
  const [projectAngle, setProjectAngle] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  /* Footprint authoring. The tool and the corner count are the viewer's to
     report — it cancels gestures on its own — so these follow onDraw rather
     than leading it. The height is the other way round: React owns it and
     pushes it down, seeded from the dock's default. */
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const [drawPoints, setDrawPoints] = useState(0);
  const [drawHeight, setDrawHeight] = useState(DEFAULT_FORM.defaultHeight);
  /** How many drawn buildings a pending rebuild would discard; null when the
      card is down. The count is captured when it opens, so the card cannot
      disagree with what it is about to destroy. */
  const [confirmDiscard, setConfirmDiscard] = useState<number | null>(null);
  /** The rectangle moved since the last build, so the scene on screen — and the
      IFC behind Download — no longer describes it. */
  const [siteDirty, setSiteDirty] = useState(false);
  /** Whether the CRS was chosen by hand. Until it is, each new rectangle picks
      the best system for where it landed; after it is, the choice is the user's
      and a rectangle nudged fifty metres must not overrule it. */
  const epsgPickedRef = useRef(false);

  /* ---- viewer ---------------------------------------------------------- */
  useEffect(() => {
    if (!viewportRef.current) return;
    const v = new Viewer(viewportRef.current, {
      onSelect: setSelection,
      onTransform: (xf, h) => setSelection((s) => (s ? { ...s, xf, h } : s)),
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
      onCount: setBuildings,
      onLayers: refreshLayers,
      onDraw: (tool, points) => {
        drawToolRef.current = tool;
        drawPointsRef.current = points;
        setDrawTool(tool);
        setDrawPoints(points);
      },
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
      // Leaflet is imported dynamically, so this lands some frames after the
      // theme was resolved and the effect below has already run against a null
      // ref. Read the theme off the ref rather than closing over it: this effect
      // is mount-only, and a captured value would be the boot default for ever.
      m.setTheme(themeRef.current);
      // Same handoff for the site-size ceiling, which is restored from storage
      // in an effect that has already run by the time Leaflet lands.
      m.setSiteLimits(siteMaxRef.current);
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

  /* ---- orientation widget ----------------------------------------------
     The widget is drawn into the viewer's own canvas, so it is not on the
     overlay grid and nothing lays it out — it has to be told what is docked in
     the corner it wants. The element editor is 296 px plus the grid's 12 px
     gap, and it is on screen exactly when there is a selection. Below 860 px
     the editor spans the width instead (see globals.css), so the inset would
     push the widget off the left edge; hold it at the plain margin there and
     let the editor cover it. */
  useEffect(() => {
    viewerRef.current?.setRightInset(selection && window.innerWidth > 860 ? 308 : 12);
  }, [selection]);

  /* ---- theme ------------------------------------------------------------
     Both viewers own a backdrop that CSS cannot reach — a shader dome and a tile
     URL — so the class on <html> is not enough for either. Pushed down the same
     way every other viewer command is, and idempotent at both ends: each setter
     returns early when the theme has not moved, so the run on first mount costs
     nothing. */
  useEffect(() => {
    themeRef.current = theme;
    viewerRef.current?.setTheme(theme);
    mapRef.current?.setTheme(theme);
  }, [theme]);

  /* ---- advanced settings ------------------------------------------------
     Restored in an effect rather than in the useState initialiser above, for
     the same reason ThemeProvider does it that way: this page is prerendered at
     build time with no `window`, so reading storage during render would be a
     hydration mismatch. Nothing here is visible until a build runs, so unlike
     the theme there is no pre-paint script to keep in step. */
  useEffect(() => {
    setForm((f) => ({ ...f, tune: loadTunables() }));
    tuneHydrated.current = true;
  }, []);

  /* Written from the value rather than from inside onFormChange: a slider drag
     fires the reducer once per tick, and a synchronous storage write per tick is
     waste. The ref suppresses the run on mount, which would otherwise put the
     defaults over the stored blob the effect above is on its way to reading. */
  useEffect(() => {
    if (tuneHydrated.current) saveTunables(form.tune);
  }, [form.tune]);

  /* The map is imperative and outside React, and its clamp binds at drag time
     rather than at build time — so this is the one tunable that does not travel
     inside BuildOptions. */
  useEffect(() => {
    siteMaxRef.current = form.tune.siteMax;
    mapRef.current?.setSiteLimits(form.tune.siteMax);
  }, [form.tune.siteMax]);

  /* ---- footprint authoring ---------------------------------------------
     The viewer cannot translate, so the name a drawn building gets is pushed
     down from here — and re-pushed on a language change, which is why `t` is a
     dependency rather than a value read once. */
  useEffect(() => {
    viewerRef.current?.setDrawOptions({
      height: drawHeight,
      name: t('ed.drawnName'),
      treeName: t('ed.drawnTreeName'),
    });
  }, [drawHeight, t]);

  /* ---- view tab -------------------------------------------------------- */
  useEffect(() => {
    viewerRef.current?.setActive(view === '3d');
    // A tool that stays armed behind the map would be waiting on clicks that
    // cannot reach it, and would surprise on the way back.
    if (view !== '3d') viewerRef.current?.setDrawMode(null);
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

      // The confirm card blocks. While it is up, Escape answers it and nothing
      // else here applies — including undo, and including the Enter that would
      // otherwise close a polygon while the card has focus.
      if (confirmOpenRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault();
          openConfirm(null);
        }
        return;
      }

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

      // Escape unwinds whatever is open, outermost first: the info card, the
      // options flyout, then a drawing gesture on either viewer, then the 3D
      // selection. A footprint tool gives up its corners before it gives up the
      // mode, so a stray click costs one gesture rather than sending you back to
      // the toolbar.
      //
      // The flyout has to outrank the map here rather than read as the more
      // local thing: the map arms itself on load and isDrawing is true almost
      // whenever the map tab is up, so anything below it would never be reached.
      if (e.key === 'Escape') {
        if (infoOpenRef.current) closeInfo();
        else if (optionsOpenRef.current) closeOptions();
        else if (searchOpenRef.current) closeSearch();
        else if (treeOpenRef.current) closeTree();
        else if (mapRef.current?.isDrawing) mapRef.current.cancelDraw();
        else if (drawToolRef.current) {
          if (drawPointsRef.current > 0) viewerRef.current?.cancelDraw();
          else viewerRef.current?.setDrawMode(null);
        } else viewerRef.current?.select(null);
      } else if (e.key === 'Enter' && drawToolRef.current === 'polygon') {
        viewerRef.current?.finishDraw();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        viewerRef.current?.deleteSelected();
      } else if (e.key === 'g' || e.key === 'G') applyMode('translate');
      else if (e.key === 'r' || e.key === 'R') applyMode('rotate');
      else if (e.key === 's' || e.key === 'S') applyMode('scale');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The viewer can refuse — the origin marker and every layer only translate —
  // and the buttons must not claim a mode the gizmo is not actually in.
  const applyMode = useCallback((m: GizmoMode) => {
    if (viewerRef.current?.setMode(m) === false) return;
    setGizmoMode(m);
  }, []);

  /* Re-read the tree from the viewer, on the viewer's own onLayers signal.
     Derived rather than pushed: React holds no scene, and a node list rebuilt
     from the scene it describes cannot disagree with it. */
  const refreshLayers = useCallback(() => {
    setLayerNodes(viewerRef.current?.layerTree() ?? []);
  }, []);

  const onSelectLayer = useCallback((id: LayerId) => viewerRef.current?.selectLayer(id), []);

  const onLayerVisible = useCallback(
    (id: LayerId, on: boolean) => viewerRef.current?.setLayerVisible(id, on),
    [],
  );

  /* The swatch on a tree row edits the selection, so it selects first — which
     also puts the layer in the inspector beside it, where its offset is typed.
     Re-selecting on every live preview would be wasted work and a re-render
     apiece, hence the guard. */
  const onLayerColor = useCallback(
    (id: LayerId, hex: number, commit: boolean) => {
      const v = viewerRef.current;
      if (!v) return;
      if (selection?.id !== layerSelId(id)) v.selectLayer(id);
      v.setColor(hex, commit);
    },
    [selection],
  );

  /** The layer in the inspector, or null when it holds an element. */
  const selectedLayer = selection?.kind === 'layer' ? layerIdOf(selection.id) : null;

  const onShowOrigin = useCallback((v: boolean) => {
    setShowOrigin(v);
    viewerRef.current?.setMarkerVisible(v);
  }, []);

  const onOrtho = useCallback((v: boolean) => {
    setOrtho(v);
    viewerRef.current?.setProjection(v);
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

  /* Same pairing as setInfo: the ref is what the mount-only key handler reads,
     the state is what renders. Null closes the card. */
  const openConfirm = useCallback((n: number | null) => {
    confirmOpenRef.current = n !== null;
    setConfirmDiscard(n);
  }, []);
  const closeInfo = useCallback(() => setInfo(false), [setInfo]);
  const toggleInfo = useCallback(() => setInfo(!infoOpenRef.current), [setInfo]);

  /* The rail's flyouts, as one table.
     
     All three hang off the same strip of screen beside the rail, so at most one
     may be out — and each carries the setInfo ref/state pairing, because the
     mount-only key handler reads the ref while the render reads the state.
     Written out by hand that was two panels closing each other; at three it is
     six assignments and the one that gets forgotten is always the bug, so the
     opening is expressed once here instead. */
  const flyouts = useMemo(
    () => ({
      options: { open: optionsOpenRef, set: setOptionsOpen, btn: gearRef },
      search: { open: searchOpenRef, set: setSearchOpenState, btn: searchBtnRef },
      tree: { open: treeOpenRef, set: setTreeOpenState, btn: treeBtnRef },
    }),
    [],
  );
  type FlyoutName = keyof typeof flyouts;

  const setFlyout = useCallback(
    (name: FlyoutName, v: boolean) => {
      for (const [key, f] of Object.entries(flyouts) as [FlyoutName, (typeof flyouts)[FlyoutName]][]) {
        // Opening one closes the others; closing one leaves them alone.
        const on = key === name ? v : v ? false : f.open.current;
        if (f.open.current === on) continue;
        f.open.current = on;
        f.set(on);
      }
    },
    [flyouts],
  );

  /* Escape and a panel's ✕ both land on closeFlyout, so focus comes back to the
     button that opened it either way — an icon-only button is hard enough to
     find again without losing the caret too. */
  const closeFlyout = useCallback(
    (name: FlyoutName) => {
      setFlyout(name, false);
      flyouts[name].btn.current?.focus();
    },
    [flyouts, setFlyout],
  );
  const toggleFlyout = useCallback(
    (name: FlyoutName) => setFlyout(name, !flyouts[name].open.current),
    [flyouts, setFlyout],
  );

  const setSearch = useCallback((v: boolean) => setFlyout('search', v), [setFlyout]);
  const closeOptions = useCallback(() => closeFlyout('options'), [closeFlyout]);
  const closeSearch = useCallback(() => closeFlyout('search'), [closeFlyout]);
  const closeTree = useCallback(() => closeFlyout('tree'), [closeFlyout]);
  const toggleOptions = useCallback(() => toggleFlyout('options'), [toggleFlyout]);
  const toggleSearch = useCallback(() => toggleFlyout('search'), [toggleFlyout]);
  const toggleTree = useCallback(() => toggleFlyout('tree'), [toggleFlyout]);

  /* The one auto-behaviour here: Search starts open because there is nothing
     to search *for* until a site rectangle exists, and it collapses to an
     icon — same as every other rail item — the instant one does. Guarded on
     "nothing else open" so it does not steal focus back from Options after a
     reset, and on the ref rather than the `searchOpen` state so a manual
     close during this same render isn't immediately undone. */
  useEffect(() => {
    if (rect) {
      if (searchOpenRef.current) closeSearch();
    } else if (!optionsOpenRef.current && !searchOpenRef.current) {
      setSearch(true);
    }
  }, [rect, closeSearch, setSearch]);

  // Whenever the flyout opens — on arrival or from a click on its rail
  // button — the caret should already be in the field, the same courtesy the
  // confirm card and the old in-panel search gave.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  /* ---- CRS ------------------------------------------------------------- */
  /**
   * Follow the site until someone says otherwise.
   *
   * The old default was EPSG:2154 for everyone, so a rectangle drawn in Toronto
   * projected through Lambert-93 unless its author noticed the dropdown. The
   * rectangle knows where it is; this is it saying so.
   *
   * IGN is exempt because it is France-only and publishes in Lambert-93, which
   * the provider switch below already sets.
   */
  useEffect(() => {
    if (!rect || epsgPickedRef.current || form.provider === 'ign') return;
    let live = true;
    const { lat, lon } = rectCentre(rect);
    loadEpsgIndex().then(
      (list) => {
        const best = bestAt(list, EPSG_CHOICES, lat, lon);
        // Nothing to do if the index has no system for this point — mid-ocean,
        // in practice — where the automatic UTM zone is already the answer.
        if (live && best) setForm((f) => ({ ...f, epsg: String(best.c) }));
      },
      // A missing index is the field's to report, not something to interrupt a
      // build over: whatever is selected still resolves.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [rect, form.provider]);

  /* ---- form ------------------------------------------------------------ */
  const onFormChange = useCallback((patch: FormPatch) => {
    // A CRS in a patch came from the field, which only the user touches — the
    // automatic pick above writes to setForm directly and deliberately does not
    // come through here.
    if (patch.epsg) epsgPickedRef.current = true;
    // Reprojecting moves every coordinate in the file, so a scene built in the
    // old system no longer describes what Download would write. Same warning
    // the rectangle raises when it moves.
    if (patch.epsg) setSiteDirty((d) => d || hasScene);
    // A tunable is an input to runBuild exactly as the CRS is, so touching one
    // means the scene on screen was built under rules the next build would not
    // use. siteMax is the exception the set is there to name: it bounds the
    // rectangle you may draw next and says nothing about a scene already built.
    if (patch.tune && Object.keys(patch.tune).some((k) => SCENE_TUNABLES.has(k as keyof Tunables)))
      setSiteDirty((d) => d || hasScene);
    setForm((f) => {
      // `tune` is re-spread after the shallow merge: the panel sends one field
      // at a time, so {...f, ...patch} alone would put a one-key object where
      // the whole nested one was and lose the other eight.
      const next: BuildOptions = {
        ...f,
        ...patch,
        tune: patch.tune ? { ...f.tune, ...patch.tune } : f.tune,
      };
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
  }, [hasScene]);

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

  /** The build itself, past the point of asking. Split from onBuild because the
   *  confirmation is a card rather than a blocking window.confirm, so the answer
   *  arrives in a later tick and has to be able to resume this. */
  const runBuildNow = useCallback(async () => {
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
    setOriginLabel(originLabelOf(res.meta));
    // A rebuild re-derives the site, so a placement measured against the old one
    // means nothing. res.meta already carries the zeroes; this just follows it.
    setProjectBase([0, 0, 0]);
    setProjectAngle(0);
    // Seed the footprint height from the dock rather than tracking it live: the
    // build is the moment that setting was last the user's stated intent, and
    // following it afterwards would overwrite a height typed into the draw HUD.
    setDrawHeight(form.defaultHeight);

    emitterRef.current?.setSource(res.scene, res.meta);
    viewerRef.current?.setScene(res.scene, res.site);
    setHasScene(true);
    setSiteDirty(false);
    setView('3d');
    setBusy(false);
    setStatus({ kind: 'summary', summary: res.summary });
  }, [rect, form, t]);

  /* A rebuild re-fetches into a brand-new scene, so anything drawn by hand goes
     with the old one. Everything else on this panel is on the undo stack; this
     is not, which is why it is the one action that stops to ask. */
  const onBuild = useCallback(() => {
    const drawn = viewerRef.current?.drawnCount() ?? 0;
    if (drawn > 0) return openConfirm(drawn);
    void runBuildNow();
  }, [openConfirm, runBuildNow]);

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

  /* The tab is on the root as a class as well as on the Stage: the two viewers
     put different furniture at the foot of the window — the map draws Leaflet's
     attribution along the very bottom — and the overlay has to know which one is
     up to keep off it. */
  return (
    <div className={`app app--${view}`}>
      <Stage viewportRef={viewportRef} mapRef={mapHostRef} view={view} />

      {/* Everything below floats over the viewers on a grid, so the rail, the
          element editor and the status bar can never cover one another and the
          space between them stays transparent to map and orbit gestures. Row 1
          is two shrink-wrapped clusters rather than one strip, which hands the
          whole top-centre of the window back to the viewer. */}
      <div className="overlay">
        <BrandChip view={view} onView={setView} />

        <UtilChip
          view={view}
          compassRef={compassRef}
          showOrigin={showOrigin}
          onShowOrigin={onShowOrigin}
          ortho={ortho}
          onOrtho={onOrtho}
          infoOpen={infoOpen}
          onInfo={toggleInfo}
        />

        {/* The rail and the flyout share one positioning context, so the panel
            slides out over the viewer instead of reserving a column for itself.
            The zone stretches the row — see .overlay > .railZone in globals.css,
            which has to give the pointer back or it swallows every gesture that
            starts down the left edge. */}
        <div className="railZone">
          <ToolRail
            view={view}
            hasScene={hasScene}
            rect={rect}
            armed={armed}
            drawTool={drawTool}
            gizmoMode={gizmoMode}
            selection={selection}
            canUndo={canUndo}
            canRedo={canRedo}
            optionsOpen={optionsOpen}
            gearRef={gearRef}
            onToggleOptions={toggleOptions}
            searchOpen={searchOpen}
            searchBtnRef={searchBtnRef}
            onToggleSearch={toggleSearch}
            treeOpen={treeOpen}
            treeBtnRef={treeBtnRef}
            onToggleTree={toggleTree}
            onDraw={onDraw}
            onPan={onPan}
            onZoom={onZoom}
            /* Through the viewer, never straight into React state: setDrawMode
               is what fires onDraw, and onDraw is what writes the refs the
               mount-only key handler reads. */
            onDrawTool={(tool) => viewerRef.current?.setDrawMode(tool)}
            onMode={applyMode}
            onUndo={() => viewerRef.current?.undo()}
            onRedo={() => viewerRef.current?.redo()}
          />

          {optionsOpen && (
            <ControlsPanel form={form} onChange={onFormChange} rect={rect} onClose={closeOptions} />
          )}

          {searchOpen && view !== '3d' && (
            <SearchFlyout
              inputRef={searchInputRef}
              onPickPlace={onPickPlace}
              onSearchFailed={(e) =>
                setStatus({ kind: 'msg', key: 'status.searchUnavailable', tone: 'err', cause: e })
              }
              onClose={closeSearch}
            />
          )}

          {treeOpen && view === '3d' && (
            <ModelTree
              nodes={layerNodes}
              selectedId={selection?.id ?? null}
              onSelectLayer={onSelectLayer}
              onSelectItem={(id) => viewerRef.current?.select(id)}
              onLayerColor={onLayerColor}
              onLayerVisible={onLayerVisible}
              onClose={closeTree}
            />
          )}
        </div>

        <ElementEditor
          visible={view === '3d' && hasScene}
          selection={selection}
          layerMovable={selectedLayer !== null && MOVABLE_LAYERS.has(selectedLayer)}
          uniform={uniform}
          onUniform={setUniform}
          onAxis={onAxis}
          onColor={(hex, commit) => viewerRef.current?.setColor(hex, commit)}
          onColorReset={() => viewerRef.current?.resetColor()}
          onOpacity={(a, commit) => viewerRef.current?.setOpacity(a, commit)}
          onHeight={(h, commit) => viewerRef.current?.setHeight(h, commit)}
          onDelete={() => viewerRef.current?.deleteSelected()}
          onReset={() => viewerRef.current?.resetElement()}
          onResetOrigin={() => viewerRef.current?.resetOrigin()}
          projectBase={projectBase}
          projectAngle={projectAngle}
          onProjectBase={onProjectBase}
          onProjectAngle={onProjectAngle}
          onResetPlacement={onResetPlacement}
          onDeselect={() => viewerRef.current?.select(null)}
        />

        {/* What the status bar was, split by how long each part is true for:
            the momentary sentence floats over the viewer and leaves, the
            standing facts sit in the bottom-right corner, and the bar itself is
            down to the actions. All three read the same state as before. */}
        <StatusToast
          rect={rect}
          busy={busy}
          hasScene={hasScene}
          siteDirty={siteDirty}
          status={status}
          drawTool={drawTool}
          drawPoints={drawPoints}
        />

        <StatusBar
          rect={rect}
          busy={busy}
          hasScene={hasScene}
          siteDirty={siteDirty}
          drawTool={drawTool}
          drawHeight={drawHeight}
          onDrawHeight={setDrawHeight}
          onBuild={onBuild}
          onDownload={onDownload}
        />

        <SiteReadout
          rect={rect}
          buildings={buildings}
          stats={stats}
          originLabel={originLabel}
        />
      </div>

      <InfoOverlay open={infoOpen} onClose={closeInfo} />

      <ConfirmCard
        open={confirmDiscard !== null}
        title={t(confirmDiscard === 1 ? 'confirm.discardTitleOne' : 'confirm.discardTitle')}
        body={t(confirmDiscard === 1 ? 'confirm.discardDrawnOne' : 'confirm.discardDrawn', {
          n: confirmDiscard ?? 0,
        })}
        confirmLabel={t('confirm.rebuildAnyway')}
        cancelLabel={t('confirm.keep')}
        onConfirm={() => {
          openConfirm(null);
          void runBuildNow();
        }}
        onCancel={() => openConfirm(null)}
      />
    </div>
  );
}

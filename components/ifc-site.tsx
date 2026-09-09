'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandChip } from '@/components/brand-chip';
import { ConfirmCard } from '@/components/confirm-card';
import { ControlsPanel } from '@/components/controls-panel';
import { type AxisKey, ElementEditor } from '@/components/element-editor';
import { FileFlyout } from '@/components/file-flyout';
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
import { DEFAULT_FORM } from '@/lib/build/defaults';
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
import {
  DRAFT_EXT,
  DRAFT_MIME,
  type Draft,
  type LoadedDraft,
  draftToText,
  parseDraft,
  toDraft,
} from '@/lib/io/draft';
import { downloadText, readDraftFile, safeFileStem } from '@/lib/io/file';
import {
  type SlotMeta,
  deleteSlot,
  listSlots,
  readSlot,
  renameSlot,
  slotsSupported,
  writeSlot,
} from '@/lib/io/slots';
import { MOVABLE_LAYERS } from '@/lib/scene/layers';
import { useTheme } from '@/lib/theme/context';
import { isOutsideFrance } from '@/lib/sources/ign';
import type { Place } from '@/lib/sources/nominatim';
import { defaultProjectName, newIfcMeta } from '@/lib/types';
import type {
  BuildOptions,
  FormPatch,
  GizmoMode,
  IfcMeta,
  IfcStats,
  LayerId,
  SceneData,
  Site,
  SiteMeta,
  SiteRect,
  Vec3,
  ViewTab,
} from '@/lib/types';
import { useUnloadGuard } from '@/lib/ui/unload-guard';
import { paint } from '@/lib/ui/yield';
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

/**
 * That same point as a project base — the number the editor's match-global
 * checkbox copies across.
 *
 * The very sum originLabelOf makes, and the one the editor's global position row
 * makes for the display: origin plus marker for easting and northing, and the
 * marker's own Z, which is already local. Written once here so the three cannot
 * drift into disagreeing about what "the global position" is.
 */
const globalBaseOf = (m: SiteMeta): Vec3 => [
  m.origin[0] + m.exportOffset[0],
  m.origin[1] + m.exportOffset[1],
  m.exportOffset[2],
];

/**
 * What to call the document when nobody has saved it under a name yet.
 *
 * The project name if one has been typed into the IFC panel, and otherwise the
 * same coordinates the writer would put on IfcProject — so the name Drafts
 * offers and the name inside the file are one thing, not two that drift.
 */
const docName = (m: SiteMeta | null): string | null =>
  m ? m.ifc.projectName || defaultProjectName(m.lat, m.lon) : null;

/**
 * How long the chrome stays up after the pointer stops, while presenting.
 *
 * Long enough to reach the button that ends the mode from anywhere on screen,
 * short enough that a hand resting on the desk does not leave the toolbar over
 * the model for the length of a meeting.
 */
const CHROME_IDLE_MS = 2500;

/** One array, so the tree's `selectedIds` prop is referentially stable while
 *  nothing is selected — a fresh `[]` each render would rebuild its Set. */
const EMPTY_IDS: string[] = [];

/**
 * What the confirm card is asking about.
 *
 * The card started as one question — "a rebuild will discard your drawn work" —
 * held as a bare count. Drafts brought three more, all of them destructive in the
 * same one-way manner, so the question became data: the card reads its four
 * strings off `kind` and the handler switches on it, which is one card rather
 * than four near-identical ones fighting over the same Escape key.
 */
type Pending =
  | { kind: 'rebuild'; drawn: number }
  | { kind: 'open'; drawn: number; draft: LoadedDraft }
  | { kind: 'overwrite'; name: string; draft: Draft }
  | { kind: 'deleteSlot'; name: string };

export function IfcSite() {
  const { t, lang } = useT();
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
  /** So the map, which arrives asynchronously, can read the ceiling on arrival. */
  const siteMaxRef = useRef(DEFAULT_TUNABLES.siteMax);
  /** Guards the save effect below so mounting with the defaults does not write
   *  them over what is already stored, a beat before the load effect reads it. */
  const tuneHydrated = useRef(false);
  // The emitter holds the live scene; the viewer mutates that same object in
  // place during an edit, which is how a gizmo drag reaches the download.
  const emitterRef = useRef<IfcEmitter | null>(null);
  const metaRef = useRef<SiteMeta | null>(null);
  /** The live scene, and the site it was built for.
   *
   *  Held here for the same reason metaRef is: React must not own a few thousand
   *  buildings, but Save has to read them, and both the viewer's and the
   *  emitter's copies are private. This is the very object the viewer mutates in
   *  place, so a save is a snapshot of what is on screen and of what Download
   *  would write — no flush, no copy. */
  const sceneRef = useRef<SceneData | null>(null);
  const siteRef = useRef<Site | null>(null);
  /** The proj4 definition the scene was projected through, so a saved site can
   *  rebuild its terrain lattice without going back to the CRS index. */
  const crsDefRef = useRef<string | null>(null);
  /** The name this document was last saved or opened under; seeds the Save
   *  field, and null after a rebuild because that is a new document. */
  const draftNameRef = useRef<string | null>(null);
  /** Whether what is on screen exists nowhere on disk — never saved at all, or
   *  edited since it was. Not draftNameRef, which is only a name and survives
   *  every edit made after the save that set it; and not siteDirty, which asks
   *  about the rectangle rather than about the document. A ref because nothing
   *  renders from it: the one reader is the unload guard at the end of this
   *  component, and it only asks while the page is being torn down. */
  const unsavedRef = useRef(false);
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
  /** And the fourth, Drafts — the only one with no view guard, because opening a
      saved site has to work from a cold start with nothing drawn yet. */
  const fileOpenRef = useRef(false);
  const fileBtnRef = useRef<HTMLButtonElement>(null);
  /** And the fifth, which is the odd one out: its button is in the status bar
      rather than on the rail, because it belongs to Download. It is in the same
      table all the same — at most one panel should ever be out. */
  const ifcOpenRef = useRef(false);
  const ifcBtnRef = useRef<HTMLButtonElement>(null);
  /** And for presentation, which Escape has to be able to leave — it outranks
      every flyout above, all of which are hidden while it runs. */
  const presentingRef = useRef(false);
  /** Not a mirror but a throttle: pointermove fires far too often to write
      chromeAwake on every one of them. See the reveal effect. */
  const awakeRef = useRef(false);
  /** Not a mirror either but a one-shot: armed when a site gesture commits, and
      consumed by the click that same press is about to produce. See the
      click-outside effect, which is what it exists to except. */
  const drawEndClickRef = useRef(false);

  /* ---- React state --------------------------------------------------- */
  const [form, setForm] = useState<BuildOptions>(DEFAULT_FORM);
  const [rect, setRect] = useState<SiteRect | null>(null);
  const [armed, setArmed] = useState(false);
  const [view, setView] = useState<ViewTab>('map');
  const [busy, setBusy] = useState(false);
  /* Opening a saved draft, from a slot or a file. Deliberately not `busy`: that
     drives the step ladder to 'Building…', and this is not a build. What the two
     share is that the toast has to stay up for the whole of them — a few
     megabytes of JSON out of IndexedDB, parsed, then a terrain lattice and every
     mesh rebuilt, is easily long enough to outlive a transient message. */
  const [opening, setOpening] = useState(false);
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
  /** The Drafts flyout, and the saved sites it lists. The slot list is read from
      IndexedDB in an effect below rather than held authoritatively here — the
      store is what is true, and every mutation re-reads it. */
  const [fileOpen, setFileOpenState] = useState(false);
  const [slots, setSlots] = useState<SlotMeta[]>([]);
  /** The IFC panel, and what it edits.

      Held at app level rather than read off metaRef because it has to outlive a
      build: the schema, the names and the authorship are properties of the
      document and never depended on the geometry, so a rebuild carries them
      forward — unlike projectBase/projectAngle, which are measured against a
      site the rebuild has just re-derived and are deliberately zeroed with it.
      runBuildNow stamps this bag into the meta it is handed. */
  const [ifcOpen, setIfcOpenState] = useState(false);
  const [ifc, setIfc] = useState<IfcMeta>(newIfcMeta);
  /** The stamp above happens inside a callback that must not re-create itself on
      every keystroke, so it reads the bag through a ref rather than closing over
      it. Kept in step below. */
  const ifcRef = useRef(ifc);
  /** Matches the viewer's own default; the marker is opt-in. */
  const [showOrigin, setShowOrigin] = useState(false);
  /** Also the viewer's default. Held here rather than reported back, like the
      marker above: nothing in the viewer changes it on its own. */
  const [ortho, setOrtho] = useState(false);
  /** The presentation orbit. Same arrangement again — and the viewer keeps the
      mode across a rebuild rather than dropping it, precisely so this stays the
      one copy of the answer. */
  const [presenting, setPresenting] = useState(false);
  /** Whether the chrome is showing while presenting. Presentation hides the
      overlay, and the button that ends it lives in the overlay — so the chrome
      comes back on any pointer movement and fades again once the pointer
      settles, the way a video player's controls do. See the effect below. */
  const [chromeAwake, setChromeAwake] = useState(false);
  /* The local project coordinate system the origin point is mapped to. Pure
     export metadata — the viewer never sees it and the scene never moves — so it
     lives here rather than in the viewer, and outside the undo stack, which
     records gestures. Angle is degrees, counter-clockwise from grid east. */
  const [projectBase, setProjectBase] = useState<Vec3>([0, 0, 0]);
  const [projectAngle, setProjectAngle] = useState(0);
  /** Whether that base is being held equal to the origin marker's global
      position rather than typed. The ref is what the mount-only onOrigin below
      reads — the same pairing setInfo and openConfirm make — and the state is
      what renders the checkbox. They are only ever written together, in
      writePlacement. */
  const [matchGlobal, setMatchGlobal] = useState(false);
  const matchGlobalRef = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  /* Footprint authoring. The tool and the corner count are the viewer's to
     report — it cancels gestures on its own — so these follow onDraw rather
     than leading it. The height is the other way round: React owns it and
     pushes it down, seeded from the dock's default. */
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);
  const [drawPoints, setDrawPoints] = useState(0);
  const [drawHeight, setDrawHeight] = useState(DEFAULT_FORM.defaultHeight);
  /** How many measurements the viewer is holding. Reported the same way the
      corner count is, and for the same reason: the viewer drops them on a
      rebuild without being asked. */
  const [measureCount, setMeasureCount] = useState(0);
  /** The question the confirm card is currently asking, or null when it is down.
      Everything it needs to act on is captured here when it opens, so the card
      cannot disagree with what it is about to do — the drawn count cannot drift,
      and `open` carries an already-parsed draft so a corrupt file reports an
      error rather than offering to destroy hand-drawn work for nothing. */
  const [pending, setPending] = useState<Pending | null>(null);
  /** The rectangle moved since the last build, so the scene on screen — and the
      IFC behind Download — no longer describes it. */
  const [siteDirty, setSiteDirty] = useState(false);
  /** Whether the CRS was chosen by hand. Until it is, each new rectangle picks
      the best system for where it landed; after it is, the choice is the user's
      and a rectangle nudged fifty metres must not overrule it. */
  const epsgPickedRef = useRef(false);

  /** An edit worth keeping, wherever it came from: the IFC text behind Download
   *  is stale, and so is the last save. The two have always travelled together —
   *  every call that used to be a bare markDirty() was already a statement that
   *  the document had changed — so they are one call now rather than a rule to
   *  remember at each site. */
  const touch = useCallback(() => {
    emitterRef.current?.markDirty();
    unsavedRef.current = true;
  }, []);

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
      onDirty: touch,
      // The emitter holds this same meta object, so writing the offset into it is
      // all the *content* the export needs — but it still has to be told to write
      // the file again, and it cannot rely on the viewer's own onDirty for that:
      // the origin also moves on paths that deliberately do not dirty (setScene,
      // restoreOrigin). Marking dirty here makes "the origin moved, so the file
      // must be rewritten" true however it moved. Debounced, so the repeats a
      // build produces cost nothing, and flush() closes the window on download.
      onOrigin: (off) => {
        const m = metaRef.current;
        if (!m) return;
        m.exportOffset = off;
        setOriginLabel(originLabelOf(m));
        // Every way the marker can move arrives here — the gizmo, a typed axis,
        // resetOrigin, restoreOrigin — so this is the one place the matched base
        // has to follow it. m.projectAngle rather than the state: this closure is
        // mount-only and would hold the angle the page opened with, while the
        // meta copy writePlacement keeps is always current.
        if (matchGlobalRef.current) writePlacement(globalBaseOf(m), m.projectAngle, true);
        touch();
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
      onMeasure: setMeasureCount,
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
      onSite: (r, live) => {
        setRect(r);
        setSiteDirty(true);
        // Only once the gesture finishes — not on every drag frame — so the
        // panel doesn't pop open mid-drag and the source doesn't flicker.
        if (r && !live) {
          setForm((f) =>
            f.provider === 'ign' && isOutsideFrance(r)
              ? { ...f, provider: 'osm', veg: false, water: false, parcels: false }
              : f,
          );
          setFlyout('options', true);
          // Every one of these commits fires from a mouseup, so the browser is
          // about to dispatch that press's click on the map — outside the rail
          // zone, and so a dismissal by the rule below. It is the end of the
          // gesture that just opened this panel, not a click away from it.
          drawEndClickRef.current = true;
        }
      },
      onArmed: setArmed,
      onStatus: (key, params) => setStatus({ kind: 'msg', key, params }),
    }).then((m) => {
      if (disposed) return m.dispose();
      mapRef.current = m;
      // Leaflet is imported dynamically, so this lands some frames after the
      // site-size ceiling was restored from storage and the effect owning it has
      // already run against a null ref. Read it off the ref rather than closing
      // over it: this effect is mount-only, and a captured value would be the
      // boot default for ever.
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
     the corner it wants. The element editor is 320 px plus the grid's 12 px
     gap, and it is on screen exactly when there is a selection. Below 860 px
     the editor spans the width instead (see globals.css), so the inset would
     push the widget off the left edge; hold it at the plain margin there and
     let the editor cover it.

     Bound to resize as well as to the selection. This is the one place in the
     app where a breakpoint is read in JS rather than in CSS, and on [selection]
     alone it only re-read it when something was picked — so a tablet rotated
     across 860 kept whichever inset it happened to have until the next click,
     with the widget either overlapped by the editor or floating inboard of it.
     The listener costs nothing on a desktop that never crosses the threshold. */
  useEffect(() => {
    const apply = () =>
      viewerRef.current?.setRightInset(selection && window.innerWidth > 860 ? 332 : 12);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [selection]);

  /* ---- theme ------------------------------------------------------------
     The 3D viewer owns a backdrop CSS cannot reach — a shader dome — so the
     class on <html> is not enough on its own; it's pushed down the same way
     every other viewer command is, idempotent at the setter end so the run on
     first mount costs nothing. The 2D map has no such backdrop: its dark look
     is a CSS invert filter over the tile pane (globals.css), driven directly
     by html.dark, so it needs no push here. */
  useEffect(() => {
    viewerRef.current?.setTheme(theme);
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
     rather than at build time — so this is one of the two tunables whose
     consumer is not reached by BuildOptions. */
  useEffect(() => {
    siteMaxRef.current = form.tune.siteMax;
    mapRef.current?.setSiteLimits(form.tune.siteMax);
  }, [form.tune.siteMax]);

  /* The second of the two, for the same reason: the orbit's pace binds per frame
     rather than per build, so it is pushed to the viewer like the theme above
     rather than carried into runBuild. Safe to arrive mid-orbit — the setter
     re-anchors the phase so the loop changes speed without changing pose. */
  useEffect(() => {
    viewerRef.current?.setOrbitCycle(form.tune.orbitCycleMs);
  }, [form.tune.orbitCycleMs]);

  /* ---- footprint authoring ---------------------------------------------
     The viewer cannot translate, so the name a drawn building gets is pushed
     down from here — and re-pushed on a language change, which is why `t` is a
     dependency rather than a value read once. */
  useEffect(() => {
    viewerRef.current?.setDrawOptions({
      height: drawHeight,
      name: t('ed.drawnName'),
      treeName: t('ed.drawnTreeName'),
      copyName: t('ed.copySuffix'),
    });
  }, [drawHeight, t]);

  /* ---- measuring -------------------------------------------------------
     Same rule as the drawn name above: the viewer may not compose text, so how
     a length and an area are written comes from here. Two fixed decimals rather
     than the shared `n` — a dimension that reads 12 m one moment and 12.35 m
     the next is a dimension you have to re-read to compare. */
  useEffect(() => {
    const nf = new Intl.NumberFormat(lang, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    viewerRef.current?.setMeasureOptions({
      length: (m) => `${nf.format(m)} m`,
      area: (a) => `${nf.format(a)} m²`,
    });
  }, [lang]);

  const onClearMeasures = useCallback(() => viewerRef.current?.clearMeasures(), []);

  /* ---- presentation -----------------------------------------------------
     Declared up here among the effects rather than beside onOrtho with the rest
     of the handlers, because the view-tab effect below has to be able to end
     the mode. */

  /* Waking the chrome on the way in is what makes the mode announce itself: the
     toast's pinned hint is where "Esc to exit" is written, and it would
     otherwise appear and fade in the same breath as everything around it. */
  const onPresent = useCallback((v: boolean) => {
    setPresenting(v);
    presentingRef.current = v;
    awakeRef.current = v;
    setChromeAwake(v);
    viewerRef.current?.setPresentation(v);
  }, []);

  /* The overlay is hidden while presenting, and the button that ends the mode
     is in the overlay — so the pointer brings it back, and a pause of a few
     seconds takes it away again. Escape works throughout either way; this is
     about not having to know that.

     awakeRef is not a mirror of the state, it is the throttle: pointermove
     fires tens of times a second and every one of them would be a re-render
     without it. Only the false -> true edge writes state. */
  useEffect(() => {
    if (!presenting) return;
    let idle = 0;
    const settle = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        awakeRef.current = false;
        setChromeAwake(false);
      }, CHROME_IDLE_MS);
    };
    const wake = () => {
      if (!awakeRef.current) {
        awakeRef.current = true;
        setChromeAwake(true);
      }
      settle();
    };
    window.addEventListener('pointermove', wake);
    // Armed on entry as well as on movement: the mode starts with the chrome up
    // so the hint can be read, and that showing has to expire on its own.
    settle();
    return () => {
      window.removeEventListener('pointermove', wake);
      window.clearTimeout(idle);
    };
  }, [presenting]);

  /* ---- view tab -------------------------------------------------------- */
  useEffect(() => {
    viewerRef.current?.setActive(view === '3d');
    // A tool that stays armed behind the map would be waiting on clicks that
    // cannot reach it, and would surprise on the way back.
    if (view !== '3d') viewerRef.current?.setDrawMode(null);
    // Same for the orbit: it draws nothing behind the map, and coming back to a
    // tab that has been spinning unattended is not what leaving it meant.
    if (view !== '3d') onPresent(false);
    if (view !== 'map') return;
    mapRef.current?.invalidateSize();
    // Anything that needed a laid-out map runs now, not when it was requested.
    const queued = pendingMapAction.current;
    pendingMapAction.current = null;
    queued?.();
  }, [view, onPresent]);

  /**
   * Leaflet measures its container, and switching tabs is a React state change
   * that has not been committed yet when the handler runs. Anything that moves
   * the map therefore waits until the map is actually on screen — calling
   * fitBounds against a display:none container frames it against zero size.
   */
  const laterOnMap = useCallback(
    (fn: (m: MapController) => void) => {
      if (view === 'map') {
        const m = mapRef.current;
        if (!m) return;
        m.invalidateSize();
        fn(m);
      } else {
        pendingMapAction.current = () => mapRef.current && fn(mapRef.current);
      }
    },
    [view],
  );

  /** The same deferral, plus the switch. Split because opening a draft lands in
   *  3D on purpose and only wants its rectangle framed correctly for whenever the
   *  map is next visited — it must not drag the user away from the model. */
  const runOnMap = useCallback(
    (fn: (m: MapController) => void) => {
      laterOnMap(fn);
      if (view !== 'map') setView('map');
    },
    [laterOnMap, view],
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
        // Presentation is above the info card, not below it: every flyout in
        // this ladder is hidden while it runs, so anything ranked over it would
        // unwind something the user cannot see.
        if (presentingRef.current) onPresent(false);
        else if (infoOpenRef.current) closeInfo();
        else if (fileOpenRef.current) closeFile();
        else if (ifcOpenRef.current) closeIfc();
        else if (optionsOpenRef.current) closeOptions();
        else if (searchOpenRef.current) closeSearch();
        else if (treeOpenRef.current) closeTree();
        else if (mapRef.current?.isDrawing) mapRef.current.cancelDraw();
        else if (drawToolRef.current) {
          if (drawPointsRef.current > 0) viewerRef.current?.cancelDraw();
          else viewerRef.current?.setDrawMode(null);
        } else viewerRef.current?.select(null);
      } else if (
        e.key === 'Enter' &&
        (drawToolRef.current === 'polygon' || drawToolRef.current === 'measureArea')
      ) {
        viewerRef.current?.finishDraw();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // A measure tool clears the selection when it is armed, so there is
        // nothing else for Delete to mean while one is in hand. Measurements are
        // deliberately outside the undo stack — see undoMeasure — so this is the
        // only way back from one.
        const tool = drawToolRef.current;
        if (tool === 'measure' || tool === 'measureArea') viewerRef.current?.undoMeasure();
        else viewerRef.current?.deleteSelected();
      } else if (e.key === 'd' || e.key === 'D') {
        // Straight on the ref, like deleteSelected above: the viewer knows
        // whether anything duplicable is selected, and this effect holds no
        // state that could go stale. Plain D rather than Ctrl+D — the browser
        // owns that one, and the Ctrl branch above returns before reaching here.
        viewerRef.current?.duplicateSelected();
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

  const onDuplicate = useCallback(() => viewerRef.current?.duplicateSelected(), []);

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
  const writePlacement = useCallback((base: Vec3, angle: number, fromGlobal: boolean) => {
    setProjectBase(base);
    setProjectAngle(angle);
    setMatchGlobal(fromGlobal);
    matchGlobalRef.current = fromGlobal;
    const m = metaRef.current;
    if (!m) return;
    m.projectBase = base;
    m.projectAngle = angle;
    m.projectBaseFromGlobal = fromGlobal;
    touch();
  }, [touch]);

  /* Fill the project coordinates from the global position above and keep them
     there, or let them go back to zero. Nothing else in the panel is a shortcut
     to a worse file, which is why the editor puts a warning under it — see
     ed.matchGlobalWarn, and the eastings this cancels in lib/ifc/writer. The
     angle is a separate decision and is carried through untouched. */
  const onMatchGlobal = useCallback((v: boolean) => {
    const m = metaRef.current;
    if (!m) return;
    writePlacement(v ? globalBaseOf(m) : [0, 0, 0], m.projectAngle, v);
  }, [writePlacement]);

  /* The same write-through as writePlacement above, and for the same reason: the
     emitter holds this very meta object, so putting the patch into it and marking
     dirty is the whole path to the download. Nothing on screen changes — the
     schema decides how the scene is written, not what is in it — so there is no
     viewer call here either. The ref keeps runBuildNow's stamp in step. */
  const onIfc = useCallback((patch: Partial<IfcMeta>) => {
    // Off the ref rather than inside a setIfc updater: the write-through and the
    // touch are side effects, and an updater is called more than once.
    const next = { ...ifcRef.current, ...patch };
    ifcRef.current = next;
    setIfc(next);
    const m = metaRef.current;
    if (!m) return;
    m.ifc = next;
    touch();
  }, [touch]);

  const onResetIfc = useCallback(() => onIfc(newIfcMeta()), [onIfc]);

  const onProjectBase = useCallback(
    (i: number, v: number) => {
      if (!Number.isFinite(v)) return;
      const next = [...projectBase] as Vec3;
      next[i] = v;
      // False, not the current latch: typing into these fields is what a matched
      // base is not. Unreachable while it is on — the editor shows them dead —
      // but a typed coordinate must never be reported as one that was copied.
      writePlacement(next, projectAngle, false);
    },
    [projectBase, projectAngle, writePlacement],
  );

  const onProjectAngle = useCallback(
    (v: number) => {
      // The latch carried through, not cleared: the angle is turned independently
      // of where the base came from, and stays live while the base is matched.
      if (Number.isFinite(v)) writePlacement(projectBase, v, matchGlobal);
    },
    [matchGlobal, projectBase, writePlacement],
  );

  const onResetPlacement = useCallback(
    () => writePlacement([0, 0, 0], 0, false),
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
  const openConfirm = useCallback((p: Pending | null) => {
    confirmOpenRef.current = p !== null;
    setPending(p);
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
      file: { open: fileOpenRef, set: setFileOpenState, btn: fileBtnRef },
      ifc: { open: ifcOpenRef, set: setIfcOpenState, btn: ifcBtnRef },
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
  const closeFile = useCallback(() => closeFlyout('file'), [closeFlyout]);
  const closeIfc = useCallback(() => closeFlyout('ifc'), [closeFlyout]);
  const toggleOptions = useCallback(() => toggleFlyout('options'), [toggleFlyout]);
  const toggleSearch = useCallback(() => toggleFlyout('search'), [toggleFlyout]);
  const toggleTree = useCallback(() => toggleFlyout('tree'), [toggleFlyout]);
  const toggleFile = useCallback(() => toggleFlyout('file'), [toggleFlyout]);
  const toggleIfc = useCallback(() => toggleFlyout('ifc'), [toggleFlyout]);

  /* The fifth way a flyout closes, after its own ✕, Escape, its rail button and
     another flyout opening: a click that lands anywhere else.

     "Anywhere else" is outside the whole rail zone rather than outside the panel
     alone, because the button that opened it sits in the rail — a handler that
     fired on that button would close the panel just in time for the click to
     toggle it straight back open.

     On click rather than pointerdown, which is the usual choice for a dismiss:
     the rename field in Drafts commits on blur, and blur is a default action of
     the press, so closing any earlier would unmount the field before it could
     write. In the capture phase, so a viewer that stops the event on its own
     container cannot swallow it.

     Portalled popups — the select and combobox lists — mount outside .app
     entirely, so requiring the target to be inside it is what stops a click on
     an option from closing the panel its field belongs to. The modals are
     exempt for the reason Escape ranks them first: their backdrop is not the
     viewer, and one click should not unwind two layers.

     The one exception is the click that ends a site gesture, which arrives on
     the map a moment after that same press opened Options — see onSite. It is
     the tail of the gesture rather than a click away from the panel, so it is
     consumed here instead of acting. A press clears the flag too: if it is
     still set by then the closing click never came — Leaflet suppresses it
     after a handle drag — and a stale one-shot would eat a real dismissal. */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (presentingRef.current || infoOpenRef.current || confirmOpenRef.current) return;
      if (drawEndClickRef.current) {
        drawEndClickRef.current = false;
        return;
      }
      const el = e.target instanceof Element ? e.target : null;
      // The rail zone is exempt because the buttons that open four of these
      // panels are in it — a handler that fired on one of them would close the
      // panel just in time for the click to toggle it straight back open. The
      // status bar is exempt for the same reason and only that one: it holds the
      // fifth panel's wrench.
      if (!el || !el.closest('.app') || el.closest('.railZone') || el.closest('.statusbar'))
        return;
      for (const name of Object.keys(flyouts) as FlyoutName[]) {
        if (flyouts[name].open.current) setFlyout(name, false);
      }
    };
    const onDown = () => {
      drawEndClickRef.current = false;
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [flyouts, setFlyout]);

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

  /* ---- leaving ----------------------------------------------------------
     Armed on hasScene rather than on the flag itself: the flag is a ref, so it
     changes nothing on screen and could not re-run an effect anyway, and there
     is nothing to lose before the first build — a rectangle is seconds of work
     and redrawing one is not what the browser's dialog is for. See the hook for
     why the wording is not ours to write. */
  const isUnsaved = useCallback(() => unsavedRef.current, []);
  useUnloadGuard(hasScene, isUnsaved);

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
    // Draping decides where a layer's geometry sits, so flipping one is as much
    // a build input as a tunable — and unlike the Include checkboxes beside it,
    // there is no way to tell from the viewer that the scene on screen was built
    // the other way.
    if (patch.drape) setSiteDirty((d) => d || hasScene);
    // The IFC schema used to need a third clause here, because it travelled on
    // this form and was not a build input. It is on IfcMeta now and reaches the
    // open model through onIfc — so everything left in this callback dirties the
    // site, which is what a build input means.
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
        // A bounding box can be a whole town, so the pin is what actually says
        // where the result was. It goes once a rectangle exists.
        m.setPin(+p.lat, +p.lon);
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
    // The file's own settings are the user's and outlive the scene: runBuild
    // hands back a blank bag (see run.ts) and this is where the one the panel
    // has been editing goes back on. Before setSource below, so the first
    // serialisation of the new scene already carries them.
    res.meta.ifc = ifcRef.current;
    sceneRef.current = res.scene;
    siteRef.current = res.site;
    crsDefRef.current = res.crsDef;
    // A rebuild fetches into a brand-new scene, so it is a new document rather
    // than a new version of the one that was open — and therefore a document no
    // draft on disk describes, however recently the last one was saved.
    draftNameRef.current = null;
    unsavedRef.current = true;
    setBuildings(res.summary.buildings);
    setOriginLabel(originLabelOf(res.meta));
    // A rebuild re-derives the site, so a placement measured against the old one
    // means nothing. res.meta already carries the zeroes; this just follows it.
    setProjectBase([0, 0, 0]);
    setProjectAngle(0);
    // The latch goes with the placement it belonged to, and the ref with it: the
    // setScene below moves the marker, and a latch left standing would take that
    // as its cue to copy the new site's coordinates into a base nobody asked for.
    setMatchGlobal(false);
    matchGlobalRef.current = false;
    // Seed the footprint height from the dock rather than tracking it live: the
    // build is the moment that setting was last the user's stated intent, and
    // following it afterwards would overwrite a height typed into the draw HUD.
    setDrawHeight(form.defaultHeight);

    // The last stretch of a build and the longest one that is not network:
    // setSource serialises the whole IFC and setScene constructs every mesh in
    // the scene, both on this thread. It runs under `busy`, so the toast holds
    // this line rather than fading out over a viewer that cannot repaint.
    setStatus({ kind: 'msg', key: 'status.assembling' });
    await paint();

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
    if (drawn > 0) return openConfirm({ kind: 'rebuild', drawn });
    void runBuildNow();
  }, [openConfirm, runBuildNow]);

  const onDownload = useCallback(() => {
    // pick up any edit still inside the debounce window
    const text = emitterRef.current?.flush();
    const meta = metaRef.current;
    if (!text || !meta) return;
    // IFCSITE_<lon>_<lat>.ifc — east-then-north, the order the georeferencing
    // itself is written in.
    downloadText(
      `IFCSITE_${meta.lon.toFixed(4)}_${meta.lat.toFixed(4)}.ifc`,
      text,
      'application/x-step',
    );
  }, []);

  /* ---- drafts -----------------------------------------------------------
     The document half, as against the deliverable onDownload writes. Save keeps
     a site in this browser under a name; Export writes a file that reopens here
     with every edit intact; Open restores either. */

  /** Everything a draft is made of, or null when there is no scene to save. */
  const collectDraft = useCallback((name: string): Draft | null => {
    const scene = sceneRef.current;
    const site = siteRef.current;
    const meta = metaRef.current;
    const crsDef = crsDefRef.current;
    if (!scene || !site || !meta || !crsDef || !rect) return null;
    // No emitter flush: that debounce guards the *IFC text*, and the model the
    // gizmo mutates is always current. This reads the very object on screen.
    return toDraft({
      name,
      rect,
      site,
      form,
      epsgPicked: epsgPickedRef.current,
      crsDef,
      meta,
      scene,
    });
  }, [form, rect]);

  /**
   * Restore a parsed draft.
   *
   * The tail of runBuildNow, in the same order, with the restores interleaved —
   * the two paths end at the same place because a draft *is* a build result that
   * came off a disk instead of the network. It does not set `busy`: that drives
   * the step ladder to 'Building…', which this is not. It sets `opening`
   * instead, which says the same thing to the toast and nothing to the ladder.
   *
   * The flag is raised here rather than only in the callers because the confirm
   * card is also a caller — answering "replace it" re-enters at this point, with
   * whatever the reader set long since cleared.
   */
  const openDraftNow = useCallback(
    async (d: LoadedDraft) => {
      setOpening(true);
      setStatus({ kind: 'msg', key: 'status.draftOpening', params: { name: d.name } });
      // Rebuilding a lattice and a few hundred meshes is real synchronous work;
      // yield once so the line above paints before the page locks up for it.
      await paint();

      /* The restore is guarded as a whole, and the flag is what makes that
         necessary. A draft that gets as far as here has already parsed, so this
         throwing means a mesh it describes could not be built — rare, but it
         used to cost only a stuck sentence that faded on its own. Now the toast
         holds until told otherwise, so an escape here would pin a half-open
         scene under a message that never leaves. */
      try {
        // Inputs first, so a Rebuild after an Open re-fetches what the draft was
        // built from rather than whatever the panel happened to be holding.
        setForm(d.form);
        epsgPickedRef.current = d.epsgPicked;
        // Note this does not dirty the site: only MapController's onSite does that,
        // and nothing has moved — the scene still describes this rectangle.
        setRect(d.rect);
        crsDefRef.current = d.crsDef;

        // Read before metaRef points at it. setScene puts the origin back at the
        // site centre, which fires onOrigin, which writes [0,0,0] straight into
        // metaRef.current.exportOffset — i.e. into this very object. Taken
        // afterwards, the marker would always come back to the middle and the
        // saved offset would be silently lost.
        const exportOffset = d.meta.exportOffset;

        metaRef.current = d.meta;
        sceneRef.current = d.scene;
        siteRef.current = d.site;
        setBuildings(d.scene.buildings.length);
        setOriginLabel(originLabelOf(d.meta));
        // From the draft, not zeroed. A build zeroes these because it re-derives the
        // site underneath them; an open is restoring the site they were measured
        // against, so they still mean what they meant.
        setProjectBase(d.meta.projectBase);
        setProjectAngle(d.meta.projectAngle);
        // And the latch with them, or a reopened draft would show its copied
        // coordinates as typed ones and stop following the marker.
        setMatchGlobal(d.meta.projectBaseFromGlobal);
        matchGlobalRef.current = d.meta.projectBaseFromGlobal;
        // Likewise from the draft: the file's own settings were saved with it,
        // and the panel has to show what the reopened document actually says.
        setIfc(d.meta.ifc);
        ifcRef.current = d.meta.ifc;
        setDrawHeight(d.form.defaultHeight);

        // The same scene object reaches both, exactly as a build's does — that
        // shared reference is how a later gizmo drag reaches the download.
        emitterRef.current?.setSource(d.scene, d.meta);
        viewerRef.current?.setScene(d.scene, d.site);

        // setScene resets the origin to the site centre and clears layer
        // visibility, both of which are right for a rebuild and wrong here.
        viewerRef.current?.restoreOrigin(exportOffset);
        viewerRef.current?.setMarkerVisible(showOrigin);
        viewerRef.current?.setProjection(ortho);

        setHasScene(true);
        setSiteDirty(false);
        setView('3d');

        // The map is behind the 3D tab and cannot be measured yet, so the rectangle
        // goes back now and the framing waits until the tab is actually visited.
        mapRef.current?.showSite(d.rect);
        laterOnMap((m) => m.fitBounds(d.rect));

        draftNameRef.current = d.name;
        // Last, and after every restore above: this scene came off a disk and
        // has not been touched since. Some of those restores route through
        // onOrigin, which touches — so an earlier clear would not survive.
        unsavedRef.current = false;
      } catch (e) {
        setOpening(false);
        setStatus({ kind: 'error', error: e instanceof Error ? e : new Error(String(e)) });
        return;
      }

      // Cleared alongside the closing line, not before it: dropping the flag in
      // its own update would let the toast start fading the message it is about
      // to be handed. Batched together, the closing line gets its five seconds
      // from here — the same handover a build makes into its summary.
      setOpening(false);
      setStatus({
        kind: 'msg',
        key: 'status.draftOpened',
        params: { name: d.name, buildings: d.scene.buildings.length },
      });
    },
    [laterOnMap, ortho, showOrigin],
  );

  /** Validate first, ask second: a bad file must report itself rather than
   *  offering to destroy hand-drawn work for nothing. */
  const openDraftText = useCallback(
    async (text: string) => {
      let d: LoadedDraft;
      // A saved site is megabytes of JSON, and JSON.parse over that does not
      // yield — same treatment as the other synchronous steps, or the line the
      // reader left up is the last thing painted before the page goes still.
      setStatus({ kind: 'msg', key: 'status.draftChecking' });
      await paint();
      try {
        d = parseDraft(text);
      } catch (e) {
        setOpening(false);
        setStatus({ kind: 'error', error: e instanceof Error ? e : new Error(String(e)) });
        return;
      }
      const drawn = viewerRef.current?.drawnCount() ?? 0;
      if (drawn > 0) {
        // The card waits on a person, and waiting on a person is not progress.
        // openDraftNow raises the flag again if they say yes.
        setOpening(false);
        return openConfirm({ kind: 'open', drawn, draft: d });
      }
      await openDraftNow(d);
    },
    [openConfirm, openDraftNow],
  );

  const onExportDraft = useCallback(() => {
    const name = draftNameRef.current ?? docName(metaRef.current) ?? 'site';
    const d = collectDraft(name);
    if (!d) return;
    const file = `${safeFileStem(name, 'site')}${DRAFT_EXT}`;
    downloadText(file, draftToText(d), DRAFT_MIME);
    draftNameRef.current = name;
    // A written draft is a durable copy, the same as a slot. Note Download does
    // not do this: an .ifc is the deliverable and does not reopen here, so it
    // saves nothing this page could restore.
    unsavedRef.current = false;
    setStatus({ kind: 'msg', key: 'status.draftExported', params: { file } });
  }, [collectDraft]);

  const onOpenFile = useCallback(
    (f: File) => {
      setOpening(true);
      setStatus({ kind: 'msg', key: 'status.draftReading', params: { name: f.name } });
      readDraftFile(f).then(openDraftText, (e) => {
        setOpening(false);
        setStatus({ kind: 'error', error: e instanceof Error ? e : new Error(String(e)) });
      });
    },
    [openDraftText],
  );

  /* ---- browser slots -----------------------------------------------------
     The same draft, kept here instead of written out. Every one of these reports
     its own failure and leaves the scene alone: storage being unavailable is a
     reason to export a file, not a reason to lose what is on screen. */

  const failStatus = useCallback(
    (e: unknown) =>
      setStatus({ kind: 'error', error: e instanceof Error ? e : new Error(String(e)) }),
    [],
  );

  const refreshSlots = useCallback(() => {
    if (!slotsSupported()) return setSlots([]);
    listSlots().then(setSlots, () => setSlots([]));
  }, []);

  /* Re-read whenever the panel opens. In an effect rather than in a useState
     initialiser for the reason the tunables above give: this page is prerendered
     with no `window`, so there is no indexedDB to read during a render that
     happens at build time. Reading on open rather than caching once also means a
     draft saved in another tab of the same app shows up here. */
  useEffect(() => {
    if (fileOpen) refreshSlots();
  }, [fileOpen, refreshSlots]);

  const saveSlot = useCallback(
    async (name: string, d: Draft) => {
      const json = draftToText(d);
      try {
        await writeSlot(name, json, {
          name,
          savedAt: Date.now(),
          bytes: json.length,
          lat: d.meta.lat,
          lon: d.meta.lon,
          buildings: d.scene.buildings.length,
          provider: d.form.provider,
        });
      } catch (e) {
        return failStatus(e);
      }
      // Past the failStatus above, so a store that refused still counts as
      // unsaved — the whole point of the flag is that it not lie about that.
      draftNameRef.current = name;
      unsavedRef.current = false;
      refreshSlots();
      setStatus({ kind: 'msg', key: 'status.draftSaved', params: { name } });
    },
    [failStatus, refreshSlots],
  );

  /** Save asks before replacing a name already taken — the only way to lose a
   *  saved draft other than deleting it outright. */
  const onSaveSlot = useCallback(
    (rawName: string) => {
      const name = rawName.trim();
      if (!name) return;
      const d = collectDraft(name);
      if (!d) return;
      if (slots.some((s) => s.name === name)) return openConfirm({ kind: 'overwrite', name, draft: d });
      void saveSlot(name, d);
    },
    [collectDraft, openConfirm, saveSlot, slots],
  );

  const onOpenSlot = useCallback(
    (name: string) => {
      // The read itself is the first silent stretch: a large site comes back out
      // of IndexedDB as one multi-megabyte string, and until now nothing said so.
      setOpening(true);
      setStatus({ kind: 'msg', key: 'status.draftReading', params: { name } });
      readSlot(name).then(openDraftText, (e) => {
        setOpening(false);
        failStatus(e);
      });
    },
    [failStatus, openDraftText],
  );

  const deleteSlotNow = useCallback(
    async (name: string) => {
      try {
        await deleteSlot(name);
      } catch (e) {
        return failStatus(e);
      }
      // Deleting the slot this document was saved as puts it back to being
      // nowhere on disk, unedited or not.
      if (draftNameRef.current === name) {
        draftNameRef.current = null;
        unsavedRef.current = true;
      }
      refreshSlots();
      setStatus({ kind: 'msg', key: 'status.draftDeleted', params: { name } });
    },
    [failStatus, refreshSlots],
  );

  const onRenameSlot = useCallback(
    (from: string, to: string) => {
      const name = to.trim();
      if (!name || name === from) return;
      renameSlot(from, name).then(() => {
        if (draftNameRef.current === from) draftNameRef.current = name;
        refreshSlots();
      }, failStatus);
    },
    [failStatus, refreshSlots],
  );

  /* The card's four strings, chosen by what it is asking. Singular and plural are
     separate entries rather than an "(s)" — this card exists to be read carefully,
     and one drawn element is the common case. */
  const confirmText = useMemo(() => {
    const p = pending;
    const cancel = t('confirm.cancel');
    if (!p) return { title: '', body: '', confirm: '', cancel };
    switch (p.kind) {
      case 'rebuild':
        return {
          title: t(p.drawn === 1 ? 'confirm.discardTitleOne' : 'confirm.discardTitle'),
          body: t(p.drawn === 1 ? 'confirm.discardDrawnOne' : 'confirm.discardDrawn', { n: p.drawn }),
          confirm: t('confirm.rebuildAnyway'),
          cancel: t('confirm.keep'),
        };
      case 'open':
        return {
          title: t(p.drawn === 1 ? 'confirm.openTitleOne' : 'confirm.openTitle'),
          body: t(p.drawn === 1 ? 'confirm.openOverDrawnOne' : 'confirm.openOverDrawn', { n: p.drawn }),
          confirm: t('confirm.openAnyway'),
          cancel: t('confirm.keep'),
        };
      case 'overwrite':
        return {
          title: t('confirm.overwriteTitle', { name: p.name }),
          body: t('confirm.overwriteSlot'),
          confirm: t('confirm.overwriteAnyway'),
          cancel,
        };
      case 'deleteSlot':
        return {
          title: t('confirm.deleteSlotTitle', { name: p.name }),
          body: t('confirm.deleteSlot'),
          confirm: t('confirm.deleteAnyway'),
          cancel,
        };
    }
  }, [pending, t]);

  const onConfirmPending = useCallback(() => {
    const p = pending;
    openConfirm(null);
    if (!p) return;
    switch (p.kind) {
      case 'rebuild':
        return void runBuildNow();
      case 'open':
        return void openDraftNow(p.draft);
      case 'overwrite':
        return void saveSlot(p.name, p.draft);
      case 'deleteSlot':
        return void deleteSlotNow(p.name);
    }
  }, [deleteSlotNow, openConfirm, openDraftNow, pending, runBuildNow, saveSlot]);

  /* ---- editor bridges --------------------------------------------------- */
  const onAxis = useCallback(
    (key: AxisKey, i: number, v: number, commit: boolean) =>
      viewerRef.current?.setAxis(key, i, v, uniform, commit),
    [uniform],
  );

  /* Read once for the render: metaRef is a ref, so nothing below reacts to it
     changing on its own, but the origin drag and the placement edit both flow
     through a real setState (setOriginLabel, setProjectBase/Angle) first — so
     by the time this runs again, the mutation it's reading has already landed. */
  const m = metaRef.current;

  /* The tab is on the root as a class as well as on the Stage: the two viewers
     put different furniture at the foot of the window — the map draws Leaflet's
     attribution along the very bottom — and the overlay has to know which one is
     up to keep off it. */
  return (
    <div className={`app app--${view}${presenting && !chromeAwake ? ' app--present' : ''}`}>
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
          hasScene={hasScene}
          showOrigin={showOrigin}
          onShowOrigin={onShowOrigin}
          ortho={ortho}
          onOrtho={onOrtho}
          presenting={presenting}
          onPresent={onPresent}
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
            fileOpen={fileOpen}
            fileBtnRef={fileBtnRef}
            onToggleFile={toggleFile}
            onDraw={onDraw}
            onPan={onPan}
            onZoom={onZoom}
            /* Through the viewer, never straight into React state: setDrawMode
               is what fires onDraw, and onDraw is what writes the refs the
               mount-only key handler reads. */
            onDrawTool={(tool) => viewerRef.current?.setDrawMode(tool)}
            onMode={applyMode}
            onDuplicate={onDuplicate}
            onUndo={() => viewerRef.current?.undo()}
            onRedo={() => viewerRef.current?.redo()}
          />

          {/* No view guard, unlike the three below it: opening a saved site is
              the one thing that has to work before anything else exists. */}
          {fileOpen && (
            <FileFlyout
              hasScene={hasScene}
              slots={slots}
              currentName={draftNameRef.current}
              suggestedName={docName(m) ?? ''}
              onSave={onSaveSlot}
              onOpenSlot={onOpenSlot}
              onRenameSlot={onRenameSlot}
              onDeleteSlot={(name) => openConfirm({ kind: 'deleteSlot', name })}
              onOpenFile={onOpenFile}
              onExportDraft={onExportDraft}
              onClose={closeFile}
            />
          )}

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
              selectedIds={selection?.ids ?? EMPTY_IDS}
              onSelectLayer={onSelectLayer}
              onSelectItem={(id, mode) => viewerRef.current?.select(id, mode)}
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
          siteMeta={m}
          projectBase={projectBase}
          projectAngle={projectAngle}
          matchGlobal={matchGlobal}
          onMatchGlobal={onMatchGlobal}
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
          working={busy || opening}
          hasScene={hasScene}
          siteDirty={siteDirty}
          status={status}
          drawTool={drawTool}
          drawPoints={drawPoints}
          presenting={presenting}
        />

        <StatusBar
          rect={rect}
          busy={busy}
          hasScene={hasScene}
          siteDirty={siteDirty}
          drawTool={drawTool}
          drawHeight={drawHeight}
          onDrawHeight={setDrawHeight}
          measureCount={measureCount}
          onClearMeasures={onClearMeasures}
          onBuild={onBuild}
          onDownload={onDownload}
          ifc={ifc}
          ifcOpen={ifcOpen}
          ifcBtnRef={ifcBtnRef}
          /* The placeholder the name field shows, which is what the file will
             actually say with it left blank. */
          defaultProjectName={m ? defaultProjectName(m.lat, m.lon) : ''}
          onToggleIfc={toggleIfc}
          onIfc={onIfc}
          onResetIfc={onResetIfc}
          onCloseIfc={closeIfc}
        />

        <SiteReadout
          rect={rect}
          buildings={buildings}
          stats={stats}
          originLabel={originLabel}
          datum={
            m
              ? {
                  verticalDatum: m.verticalDatum,
                  refElevation:
                    m.verticalDatum === null ? null : m.exportOffset[2] - m.projectBase[2],
                }
              : null
          }
        />
      </div>

      <InfoOverlay open={infoOpen} onClose={closeInfo} />

      <ConfirmCard
        open={pending !== null}
        title={confirmText.title}
        body={confirmText.body}
        confirmLabel={confirmText.confirm}
        cancelLabel={confirmText.cancel}
        onConfirm={onConfirmPending}
        onCancel={() => openConfirm(null)}
      />
    </div>
  );
}

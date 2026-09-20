'use client';

import { Fragment, type ReactNode, type RefObject, useRef } from 'react';
import {
  IconBox,
  IconChevronLeft,
  IconChevronRight,
  IconDrafts,
  IconDrawSite,
  IconDuplicate,
  IconLayers,
  IconMeasure,
  IconMeasureArea,
  IconMove,
  IconOptions,
  IconPan,
  IconPolygon,
  IconRedo,
  IconRotate,
  IconScale,
  IconSearch,
  IconSelect,
  IconTree,
  IconUndo,
  IconZoomSite,
} from '@/components/icons';
import { useT } from '@/lib/i18n/context';
import type { GizmoMode, SiteRect, ViewTab } from '@/lib/types';
import { useScrollEdges } from '@/lib/ui/useScrollEdges';
import type { DrawTool, Selection } from '@/lib/viewer/Viewer';

export type ToolRailProps = {
  view: ViewTab;
  /** Lying down in the phone dock. Drives aria-orientation, nothing visual —
   *  the shape itself is the 560 tier's, in app/globals.css. */
  horizontal?: boolean;
  /** The top-right utility cluster, when it has nowhere else to be. See below. */
  utils?: ReactNode;
  hasScene: boolean;
  rect: SiteRect | null;
  armed: boolean;
  drawTool: DrawTool | null;
  gizmoMode: GizmoMode;
  selection: Selection | null;
  canUndo: boolean;
  canRedo: boolean;
  optionsOpen: boolean;
  gearRef: RefObject<HTMLButtonElement | null>;
  onToggleOptions: () => void;
  searchOpen: boolean;
  searchBtnRef: RefObject<HTMLButtonElement | null>;
  onToggleSearch: () => void;
  treeOpen: boolean;
  treeBtnRef: RefObject<HTMLButtonElement | null>;
  onToggleTree: () => void;
  fileOpen: boolean;
  fileBtnRef: RefObject<HTMLButtonElement | null>;
  onToggleFile: () => void;
  onDraw: () => void;
  onPan: () => void;
  onZoom: () => void;
  onDrawTool: (tool: DrawTool | null) => void;
  onMode: (m: GizmoMode) => void;
  onDuplicate: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

type RailBtn = {
  key: string;
  icon: ReactNode;
  tip: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

/**
 * The tools, as a rail.
 *
 * Everything here was prose in a bar across the bottom of the window — three
 * segmented controls that appeared and disappeared under each other as the
 * state changed. As icons they take a 40 px column and stay in one place, which
 * is what makes the position of a tool learnable.
 *
 * The rail stores nothing: every pressed state is derived from the state that
 * already drives the viewer, so a tool cancelled with Escape un-presses itself.
 *
 * On a phone it lies down into a dock along the foot of the window and takes in
 * lodgers: the theme, info and language controls have no corner to live in at
 * that width, so they are handed down as `utils` and rendered as one more group.
 * They are built by the page rather than here because they are not tools and
 * this component knows nothing about themes or languages — see components/
 * ifc-site, which owns both them and the breakpoint that decides where they go.
 */
export function ToolRail(p: ToolRailProps) {
  const { t } = useT();
  const is3d = p.view === '3d' && p.hasScene;

  /* Lying down, the rail scrolls and has no scrollbar to say so — see .railEdge
     in the phone tier. These two say it instead: a chevron at either end, but
     only at an end that actually has more strip behind it. Measured at every
     width and only drawn when horizontal, because the vertical rail is not a
     horizontal scroller and its overhanging hover tips would inflate the
     reading. */
  const railRef = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(railRef);
  // The gizmo refuses every mode but translate while the origin, or a layer, is
  // selected. Disabling the three buttons states that; letting them look live
  // and do nothing would not.
  const translateOnly = p.selection?.kind === 'origin' || p.selection?.kind === 'layer';
  // A drawn shape moves and turns but does not stretch — it is fitted to the
  // ground again wherever it lands, and a scaled draped skin would come off it —
  // and it is not duplicated, since a copy would only land on top of itself.
  const shape = p.selection?.kind === 'shape';

  const groups: RailBtn[][] = is3d
    ? [
        [
          {
            key: 'sel',
            icon: <IconSelect />,
            tip: t('rail.select'),
            on: !p.drawTool,
            onClick: () => p.onDrawTool(null),
          },
          {
            key: 'box',
            icon: <IconBox />,
            tip: t('rail.drawBox'),
            on: p.drawTool === 'rect',
            onClick: () => p.onDrawTool('rect'),
          },
          {
            key: 'poly',
            icon: <IconPolygon />,
            tip: t('rail.drawPoly'),
            on: p.drawTool === 'polygon',
            onClick: () => p.onDrawTool('polygon'),
          },
          {
            key: 'tree',
            icon: <IconTree />,
            tip: t('rail.drawTree'),
            on: p.drawTool === 'tree',
            onClick: () => p.onDrawTool('tree'),
          },
          // In the draw group rather than in one of their own, even though these
          // two read the scene instead of adding to it. A separator is nine
          // pixels the rail cannot afford — see the height arithmetic on .rail —
          // and they are tools armed and disarmed exactly like the four above,
          // Select included, so the group still means one thing: what the next
          // click on the ground does.
          {
            key: 'measure',
            icon: <IconMeasure />,
            tip: t('rail.measure'),
            on: p.drawTool === 'measure',
            onClick: () => p.onDrawTool('measure'),
          },
          {
            key: 'measureArea',
            icon: <IconMeasureArea />,
            tip: t('rail.measureArea'),
            on: p.drawTool === 'measureArea',
            onClick: () => p.onDrawTool('measureArea'),
          },
        ],
        [
          {
            key: 'move',
            icon: <IconMove />,
            tip: t('ed.move'),
            on: p.gizmoMode === 'translate',
            disabled: translateOnly,
            onClick: () => p.onMode('translate'),
          },
          {
            key: 'rot',
            icon: <IconRotate />,
            tip: t('ed.rotate'),
            on: p.gizmoMode === 'rotate',
            disabled: translateOnly,
            onClick: () => p.onMode('rotate'),
          },
          {
            key: 'scl',
            icon: <IconScale />,
            tip: t('ed.scale'),
            on: p.gizmoMode === 'scale',
            disabled: translateOnly || shape,
            onClick: () => p.onMode('scale'),
          },
          // In this group rather than one of its own — it acts on the selection,
          // which is what the three above have in common — but it is a command,
          // not a mode, so it never takes a pressed state. Disabled with nothing
          // selected, for the origin and the layers, which are not records there
          // is anything to copy, and for a drawn shape, which is fitted to the
          // ground where it lies and would only land on top of itself.
          {
            key: 'dup',
            icon: <IconDuplicate />,
            tip: t('ed.duplicate'),
            disabled: !p.selection || translateOnly || shape,
            onClick: p.onDuplicate,
          },
        ],
        [
          {
            key: 'undo',
            icon: <IconUndo />,
            tip: t('ed.undo'),
            disabled: !p.canUndo,
            onClick: p.onUndo,
          },
          {
            key: 'redo',
            icon: <IconRedo />,
            tip: t('ed.redo'),
            disabled: !p.canRedo,
            onClick: p.onRedo,
          },
        ],
      ]
    : p.view === 'map'
      ? [
          [
            // Re-arming *is* redrawing, so there is no separate Redraw button.
            {
              key: 'draw',
              icon: <IconDrawSite />,
              tip: t('ctl.drawSite'),
              on: p.armed,
              onClick: p.onDraw,
            },
            {
              key: 'pan',
              icon: <IconPan />,
              tip: t('rail.pan'),
              on: !p.armed,
              onClick: p.onPan,
            },
            {
              key: 'zoom',
              icon: <IconZoomSite />,
              tip: t('ctl.zoomSite'),
              disabled: !p.rect,
              onClick: p.onZoom,
            },
          ],
        ]
      : // 3D without a scene: nothing to select, nothing to draw into.
        [];

  return (
    <>
      <div
        ref={railRef}
        className="rail floating"
        role="toolbar"
        aria-orientation={p.horizontal ? 'horizontal' : 'vertical'}
        aria-label={t('rail.label')}
      >
        {/* Pinned beside the gear rather than folded into Options: finding a
            place is the first thing you do, before there is anything to
            configure. It starts expanded — see the flyout it opens — and
            collapses to this icon once a site rectangle exists. Hidden in 3D:
            there is no map left to search once the scene takes over. */}
        {p.view !== '3d' && (
          <button
            ref={p.searchBtnRef}
            type="button"
            className={`railBtn${p.searchOpen ? ' on' : ''}`}
            data-tip={t('ctl.findPlace')}
            aria-label={t('ctl.findPlace')}
            aria-expanded={p.searchOpen}
            aria-controls="searchFlyout"
            onClick={p.onToggleSearch}
          >
            <IconSearch />
          </button>
        )}


        {/* Beside the search for the same reason, and only in 3D: there is no
            model to walk until there is a scene. */}
        {is3d && (
          <button
            ref={p.treeBtnRef}
            type="button"
            className={`railBtn${p.treeOpen ? ' on' : ''}`}
            data-tip={t('rail.model')}
            aria-label={t('rail.model')}
            aria-expanded={p.treeOpen}
            aria-controls="treeFlyout"
            onClick={p.onToggleTree}
          >
            <IconLayers />
          </button>
        )}

        {/* Pinned above the first separator rather than at the foot of the rail:
            the body below changes with the view, and a bottom-anchored gear would
            move under the cursor on every switch. */}
        <button
          ref={p.gearRef}
          type="button"
          className={`railBtn${p.optionsOpen ? ' on' : ''}`}
          data-tip={t('ui.options')}
          aria-label={t('ui.options')}
          aria-expanded={p.optionsOpen}
          aria-controls="optionsFlyout"
          onClick={p.onToggleOptions}
        >
          <IconOptions />
        </button>

      

        {groups.map((g, i) => (
          // eslint-disable-next-line react/no-array-index-key -- the groups are a
          // fixed literal per view, not a list that reorders.
          <Fragment key={i}>
            <div className="railSep" />
            {g.map((b) => (
              <button
                key={b.key}
                type="button"
                className={`railBtn${b.on ? ' on' : ''}`}
                data-tip={b.tip}
                aria-label={b.tip}
                aria-pressed={b.on === undefined ? undefined : b.on}
                disabled={b.disabled}
                onClick={b.onClick}
              >
                {b.icon}
              </button>
            ))}
          </Fragment>
        ))}

        {/* Last on the rail, under its own separator, and the only button here with
            no view guard: opening a saved site has to work from a cold start, where
            there is no rectangle, no scene, and nothing else on this rail to do.

            The gear's comment above explains why it is *not* down here — the body
            between them changes with the view, so a foot-anchored button lands at a
            different height in map and in 3D. That cost is real and is accepted for
            this one: the gear is reached mid-task with the cursor already on the
            rail, whereas saving and reopening bookend a session, and the foot is
            where a document action is looked for. The rail shrink-wraps, so this is
            the bottom of the chip rather than the bottom of the window. */}
        <div className="railSep" />
        <button
          ref={p.fileBtnRef}
          type="button"
          className={`railBtn${p.fileOpen ? ' on' : ''}`}
          data-tip={t('rail.file')}
          aria-label={t('rail.file')}
          aria-expanded={p.fileOpen}
          aria-controls="fileFlyout"
          onClick={p.onToggleFile}
        >
          <IconDrafts />
        </button>

        {/* After Drafts rather than before it, and behind its own rule: these are
            not tools, and the two groups above them are ordered by how often they
            are reached. The theme and the language are set once a session. */}
        {p.utils && (
          <>
            <div className="railSep" />
            {p.utils}
          </>
        )}
      </div>

      {/* Siblings of the rail, not children: they are positioned against
          .railZone, and being outside .rail is also what keeps them out of its
          own end-fade mask — a chevron that faded with the strip it is
          describing would be at its faintest exactly where it matters.

          Deaf to the pointer, and aria-hidden with it. They sit over the first
          and last visible button, and on a 375px strip there is no room to put
          them anywhere else — so they let the tap through rather than eating the
          tool underneath. Nothing is lost by that: the gesture they describe is
          a swipe, which needs no target, and a screen reader is told the rail is
          a toolbar and walks it without scrolling at all. */}
      {p.horizontal && edges.start && (
        <span className="railEdge railEdge--start" aria-hidden="true">
          <IconChevronLeft />
        </span>
      )}
      {p.horizontal && edges.end && (
        <span className="railEdge railEdge--end" aria-hidden="true">
          <IconChevronRight />
        </span>
      )}
    </>
  );
}

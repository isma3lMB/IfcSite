'use client';

import { Fragment, type ReactNode, type RefObject } from 'react';
import {
  IconBox,
  IconDrawSite,
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
import type { DrawTool, Selection } from '@/lib/viewer/Viewer';

export type ToolRailProps = {
  view: ViewTab;
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
  onDraw: () => void;
  onPan: () => void;
  onZoom: () => void;
  onDrawTool: (tool: DrawTool | null) => void;
  onMode: (m: GizmoMode) => void;
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
 */
export function ToolRail(p: ToolRailProps) {
  const { t } = useT();
  const is3d = p.view === '3d' && p.hasScene;
  // The gizmo refuses every mode but translate while the origin is selected.
  // Disabling the three buttons states that; letting them look live and do
  // nothing would not.
  const originSelected = p.selection?.kind === 'origin';

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
        ],
        [
          {
            key: 'move',
            icon: <IconMove />,
            tip: t('ed.move'),
            on: p.gizmoMode === 'translate',
            disabled: originSelected,
            onClick: () => p.onMode('translate'),
          },
          {
            key: 'rot',
            icon: <IconRotate />,
            tip: t('ed.rotate'),
            on: p.gizmoMode === 'rotate',
            disabled: originSelected,
            onClick: () => p.onMode('rotate'),
          },
          {
            key: 'scl',
            icon: <IconScale />,
            tip: t('ed.scale'),
            on: p.gizmoMode === 'scale',
            disabled: originSelected,
            onClick: () => p.onMode('scale'),
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
    <div className="rail floating" role="toolbar" aria-orientation="vertical" aria-label={t('rail.label')}>
      
      {/* Pinned beside the gear rather than folded into Options: finding a
          place is the first thing you do, before there is anything to
          configure. It starts expanded — see the flyout it opens — and
          collapses to this icon once a site rectangle exists. */}
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
    </div>
  );
}

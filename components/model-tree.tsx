'use client';

import { useMemo, useState } from 'react';
import { ColourField } from '@/components/colour-field';
import { useT } from '@/lib/i18n/context';
import type { StringKey } from '@/lib/i18n/context';
import type { LayerId } from '@/lib/types';
import { type LayerNode, layerSelId } from '@/lib/viewer/Viewer';

/**
 * How tall one leaf row is, in pixels, and how many the scroller shows.
 *
 * Both are here rather than in the stylesheet because the windowing arithmetic
 * below needs the number: a scene is capped at four thousand buildings, and
 * four thousand DOM rows is a panel that stutters on every expand. Keep this in
 * step with .treeItem in globals.css — the row is a fixed height there for
 * exactly this reason.
 */
const ROW_H = 24;
const VIEW_ROWS = 10;
/** Rows rendered past each edge of the viewport, so a fast scroll does not
 *  reach the end of the rendered slice before the next render lands. */
const OVERSCAN = 6;

/**
 * A windowed leaf list.
 *
 * Deliberately not a dependency: every row is the same height, which is the one
 * case windowing is four lines of arithmetic rather than a library. A spacer
 * div holds the full scroll height and the slice is offset into it.
 */
function ItemList({
  items,
  selectedId,
  onSelect,
}: {
  items: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [top, setTop] = useState(0);

  const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const last = Math.min(items.length, first + VIEW_ROWS + OVERSCAN * 2);
  const slice = items.slice(first, last);

  return (
    <div
      className="treeItems"
      style={{ maxHeight: VIEW_ROWS * ROW_H }}
      onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)}
      role="group"
    >
      <div style={{ height: items.length * ROW_H, position: 'relative' }}>
        <div style={{ transform: `translateY(${first * ROW_H}px)` }}>
          {slice.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`treeItem${it.id === selectedId ? ' on' : ''}`}
              style={{ height: ROW_H }}
              title={it.id}
              aria-current={it.id === selectedId}
              onClick={() => onSelect(it.id)}
            >
              {it.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export type ModelTreeProps = {
  nodes: LayerNode[];
  /** The Selection.id currently in the inspector, so the tree can mark its own
   *  row — layers and elements share one id namespace (see layerSelId). */
  selectedId: string | null;
  onSelectLayer: (id: LayerId) => void;
  onSelectItem: (id: string) => void;
  onLayerColor: (id: LayerId, hex: number, commit: boolean) => void;
  onClose: () => void;
};

/**
 * The model tree.
 *
 * Two levels: a category, and the elements under it that have an identity of
 * their own. Terrain, roads and railways are one merged element apiece on
 * screen and in the file, so they have no leaves to list and say so instead of
 * offering an expander that opens onto a single row repeating their own name.
 *
 * The panel edits one thing directly — the layer's colour, which is the whole
 * reason the tree exists. Everything else routes through the selection: a row
 * click selects, and the inspector on the right is where the offset is typed.
 * That keeps one editor rather than two that have to agree.
 */
export function ModelTree(p: ModelTreeProps) {
  const { t, n: num } = useT();
  const [open, setOpen] = useState<ReadonlySet<LayerId>>(new Set());
  const [filter, setFilter] = useState('');
  /**
   * The colour being dragged right now.
   *
   * The nodes are re-read from the viewer on a committed edit, not on every
   * live preview — so through the picker drag the swatch has to show what it is
   * previewing rather than the value the last refresh brought back, or a
   * re-render mid-drag would snap the input back under the cursor. Cleared on
   * commit, when the refresh that follows is the authority again.
   */
  const [live, setLive] = useState<{ id: LayerId; hex: number } | null>(null);

  const q = filter.trim().toLowerCase();
  // Filtering expands nothing on its own — it narrows what an already-open
  // layer shows. A filter that force-opened all nine would bury the categories
  // it is meant to help you find your way around.
  const filtered = useMemo(
    () =>
      new Map(
        p.nodes.map((n) => [
          n.id,
          q ? n.items.filter((i) => i.name.toLowerCase().includes(q)) : n.items,
        ]),
      ),
    [p.nodes, q],
  );

  if (!p.nodes.length)
    return (
      <div className="flyout floating" id="treeFlyout" aria-label={t('tree.title')}>
        <div className="dockHead">
          <span className="eyebrow">{t('tree.title')}</span>
          <button
            type="button"
            className="iconBtn"
            title={t('ui.close')}
            aria-label={t('ui.close')}
            onClick={p.onClose}
          >
            ✕
          </button>
        </div>
        <p className="fieldHint">{t('tree.empty')}</p>
      </div>
    );

  return (
    <div className="flyout floating" id="treeFlyout" aria-label={t('tree.title')}>
      <div className="dockHead">
        <span className="eyebrow">{t('tree.title')}</span>
        <button
          type="button"
          className="iconBtn"
          title={t('ui.close')}
          aria-label={t('ui.close')}
          onClick={p.onClose}
        >
          ✕
        </button>
      </div>

      <div className="field">
        <input
          type="search"
          className="ctl-input"
          placeholder={t('tree.filter')}
          aria-label={t('tree.filter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="tree" role="tree">
        {p.nodes.map((n) => {
          // The label is a dictionary key rather than a name — the viewer has no
          // language. See LAYER_LABEL in lib/scene/layers.
          const label = t(n.label as StringKey);
          const items = filtered.get(n.id) ?? [];
          const expandable = n.items.length > 0;
          const isOpen = expandable && open.has(n.id);
          const selected = p.selectedId === layerSelId(n.id);

          return (
            <div className="treeNode" key={n.id} role="treeitem" aria-expanded={isOpen}>
              <div
                className={`treeRow${selected ? ' on' : ''}`}
                title={expandable ? undefined : t('tree.merged')}
              >
                <button
                  type="button"
                  className="treeTwisty"
                  disabled={!expandable}
                  title={isOpen ? t('tree.collapse', { layer: label }) : t('tree.expand', { layer: label })}
                  aria-label={
                    isOpen ? t('tree.collapse', { layer: label }) : t('tree.expand', { layer: label })
                  }
                  onClick={() =>
                    setOpen((s) => {
                      const next = new Set(s);
                      if (!next.delete(n.id)) next.add(n.id);
                      return next;
                    })
                  }
                >
                  {expandable ? (isOpen ? '▾' : '▸') : '·'}
                </button>

                <button
                  type="button"
                  className="treeName"
                  aria-current={selected}
                  onClick={() => p.onSelectLayer(n.id)}
                >
                  {label}
                </button>

                <span className="treeCount">{num(n.count)}</span>

                {/* The one edit the tree makes on its own. Live while the picker
                    is open, one undo step when it closes — the split lives in
                    ColourField, which the inspector shares. */}
                <ColourField
                  className="colorInput treeSwatch"
                  value={live?.id === n.id ? live.hex : n.color}
                  ariaLabel={t('tree.colourOf', { layer: label })}
                  onColor={(hex, commit) => {
                    setLive(commit ? null : { id: n.id, hex });
                    p.onLayerColor(n.id, hex, commit);
                  }}
                />
              </div>

              {isOpen &&
                (items.length ? (
                  <ItemList items={items} selectedId={p.selectedId} onSelect={p.onSelectItem} />
                ) : (
                  <p className="treeNote">{t('tree.noMatch')}</p>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

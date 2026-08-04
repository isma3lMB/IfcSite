import { emitIFC } from '@/lib/ifc/emit';
import type { IfcStats, SceneData, SiteMeta } from '@/lib/types';

/**
 * Edits are cheap but re-serialising a few hundred buildings is not free, so
 * the readout catches up shortly after the gesture ends rather than on every
 * frame of a gizmo drag.
 *
 * Held outside React because the gizmo produces changes far faster than a
 * render pass should run, and because the download handler needs a synchronous
 * way to flush whatever is still inside the debounce window.
 */
const DEBOUNCE_MS = 250;

export class IfcEmitter {
  private text: string | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scene: SceneData | null = null;
  private meta: SiteMeta | null = null;

  constructor(private readonly onStats: (stats: IfcStats) => void) {}

  /** Point the emitter at a freshly built scene and serialise it once. */
  setSource(scene: SceneData, meta: SiteMeta): void {
    this.scene = scene;
    this.meta = meta;
    this.emit();
  }

  private emit(): void {
    if (!this.scene || !this.meta) return;
    const { text, stats } = emitIFC(this.scene, this.meta);
    this.text = text;
    this.dirty = false;
    this.onStats(stats);
  }

  /** An edit landed; re-serialise shortly after the gesture stops. */
  markDirty(): void {
    if (!this.scene) return;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.emit();
    }, DEBOUNCE_MS);
  }

  /** Pick up any edit still inside the debounce window. Call before download. */
  flush(): string | null {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) this.emit();
    return this.text;
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.text = null;
    this.dirty = false;
    this.scene = null;
    this.meta = null;
  }
}

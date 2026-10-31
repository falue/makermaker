import * as THREE from 'three';
import type { Frame } from '../doc/frames';
import { pullBy, type Tool, type ToolHost, type ToolView } from './sketch';

const HINT = 'Move to push or pull the face · [Ctrl] snaps · type a distance · click or [Enter]: done · [Esc] puts it back';

/**
 * Pulls an extrusion's end face along its outward normal (`frame.n`): reports the distance (mm, outwards positive)
 * live, then once more when done or cancelled (0).
 */
export class FacePullTool implements Tool {
  readonly kind = null;
  private pull = { raw: 0 };
  private dist = 0;
  private typed: string | undefined;
  private labels = Object.assign(document.createElement('div'), { className: 'size-labels' });

  constructor(
    private view: ToolView,
    private host: ToolHost,
    private frame: Frame,
    private at: THREE.Vector3,
    private onPull: (mm: number, phase: 'live' | 'done' | 'cancel') => void,
  ) {
    view.el.append(this.labels);
    view.unflatten(new THREE.Vector3(...frame.n));
    view.lockPointer();
    host.hint(HINT);
    this.update();
  }

  dispose() {
    this.view.unlockPointer();
    this.labels.remove();
  }

  down(e: PointerEvent) {
    if (e.button !== 0) return false;
    this.finish('done');
    return true;
  }

  move(e: PointerEvent) {
    pullBy(this.view, e, this.frame, this.at, this.pull);
    const step = e.ctrlKey ? this.view.snapStep : 0.1;
    this.dist = Math.round(this.pull.raw / step) * step;
    this.onPull(this.value(), 'live');
    this.update();
  }

  up() {}

  refresh() {
    this.update();
  }

  dblclick() {}

  key(e: KeyboardEvent) {
    if (e.key === 'Escape') this.finish('cancel');
    else if (e.key === 'Enter') this.finish('done');
    else if (e.key === 'Backspace') this.typed = this.typed?.slice(0, -1) || undefined;
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) this.typed = (this.typed ?? '') + e.key;
    else return false;
    if (e.key !== 'Escape' && e.key !== 'Enter') {
      this.onPull(this.value(), 'live');
      this.update();
    }
    return true;
  }

  private value() {
    return (this.typed === undefined ? null : this.host.length(this.typed)) ?? this.dist;
  }

  private finish(phase: 'done' | 'cancel') {
    this.view.unlockPointer();
    this.onPull(phase === 'cancel' ? 0 : this.value(), phase);
  }

  private update() {
    const [x, y] = this.view.toScreen(this.at.clone().addScaledVector(new THREE.Vector3(...this.frame.n), this.value()));
    const el = Object.assign(document.createElement('div'), {
      className: 'size-label active',
      textContent: `Face ${this.typed === undefined ? `${this.value() >= 0 ? '+' : ''}${this.value().toFixed(2)}` : `${this.typed}▏`}`,
    });
    el.style.cssText = `left:${x}px;top:${y}px`;
    this.labels.replaceChildren(el);
    this.view.render();
  }
}

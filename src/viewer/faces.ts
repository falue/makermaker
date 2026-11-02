import * as THREE from 'three';
import type { V3 } from '../doc/frames';
import { pullBy, type Tool, type ToolHost, type ToolView } from './sketch';
import { pressed } from '../ui/keys';

const HINT = 'Move to push or pull the face · [Ctrl] snaps · type a distance · click or [Enter]: done · [Esc] puts it back';

/** What a pull shows and how it ends: its hint, its label at the pointer, and whether releasing the button finishes it. */
export type PullLook = { hint: string; label: (mm: number, typed?: string) => string; endOnUp?: boolean };

const FACE: PullLook = { hint: HINT, label: (mm, typed) => `Face ${typed === undefined ? `${mm >= 0 ? '+' : ''}${mm.toFixed(2)}` : `${typed}▏`}` };

/**
 * Pulls a face along its outward normal `n` (or anything along a direction): reports the distance (mm, along `n`
 * positive) live, then once more when done or cancelled (0).
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
    private n: V3,
    private at: THREE.Vector3,
    private onPull: (mm: number, phase: 'live' | 'done' | 'cancel') => void,
    private look: PullLook = FACE,
  ) {
    view.el.append(this.labels);
    view.unflatten(new THREE.Vector3(...n));
    view.lockPointer();
    host.hint(look.hint);
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
    pullBy(this.view, e, this.n, this.at, this.pull);
    const step = e.ctrlKey ? this.view.snapStep : 0.1;
    this.dist = Math.round(this.pull.raw / step) * step;
    this.onPull(this.value(), 'live');
    this.update();
  }

  up() {
    if (this.look.endOnUp) this.finish('done');
  }

  refresh() {
    this.update();
  }

  dblclick() {}

  key(e: KeyboardEvent) {
    const [cancel, confirm] = [pressed(e, 'cancel'), pressed(e, 'confirm')];
    if (cancel) this.finish('cancel');
    else if (confirm) this.finish('done');
    else if (pressed(e, 'erase')) this.typed = this.typed?.slice(0, -1) || undefined;
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) this.typed = (this.typed ?? '') + e.key;
    else return false;
    if (!cancel && !confirm) {
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
    const [x, y] = this.view.toScreen(this.at.clone().addScaledVector(new THREE.Vector3(...this.n), this.value()));
    const el = Object.assign(document.createElement('div'), {
      className: 'size-label active',
      textContent: this.look.label(this.value(), this.typed),
    });
    el.style.cssText = `left:${x}px;top:${y}px`;
    this.labels.replaceChildren(el);
    this.view.render();
  }
}

import * as THREE from 'three';
import type { V3 } from '../doc/frames';
import { pullBy, type Tool, type ToolHost, type ToolView } from './sketch';
import { pressed } from '../ui/keys';
import { keepInside } from '../ui/inside';

const HINT = 'Move to push or pull the face · [Shift] coarse · [Ctrl] precise · type a distance · [T] to object · click or [Enter]: done · [Esc] puts it back';

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
  /** Waiting for the click that sets how far ("to object"). */
  private reaching = false;
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
    this.view.aimAt(null);
    this.host.cursorTip(null);
    this.labels.remove();
  }

  down(e: PointerEvent) {
    if (e.button !== 0) return false;
    if (this.reaching) {
      // "to object": the distance to the clicked point, along `n`
      const p = this.view.pointAt(e);
      if (!p) return true;
      this.reaching = false;
      this.view.aimAt(null);
      [this.dist, this.typed] = [p.sub(this.at).dot(new THREE.Vector3(...this.n)), undefined];
    }
    this.finish('done');
    return true;
  }

  move(e: PointerEvent) {
    if (this.reaching) return this.host.cursorTip(this.view.aimAt(e)); // aiming at what to reach
    pullBy(this.view, e, this.n, this.at, this.pull);
    const step = this.view.step(this.at, e);
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
    if (this.look === FACE && this.typed === undefined && pressed(e, 'toObject')) {
      // the next click picks how far: the pointer shows again for it
      this.reaching = true;
      this.view.unlockPointer();
      this.host.hint('Click a corner, edge or face: the pull reaches it · [Esc] cancels');
      return true;
    }
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
    this.labels.replaceChildren(el);
    keepInside(el, x, y);
    this.view.render();
  }
}

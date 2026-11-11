import * as THREE from 'three';
import type { V3 } from '../doc/frames';
import { pullBy, type Tool, type ToolHost, type ToolView } from './sketch';
import { pressed } from '../ui/keys';
import { caretHtml, restOf, selectTyped } from '../ui/complete';
import { keepInside } from '../ui/inside';

/** What a pull shows and how it ends: its hint, its label at the pointer, and whether releasing the button finishes it. */
export type PullLook = { hint: string; label: (mm: number, typed?: string) => string; endOnUp?: boolean };

/**
 * Pulls anything along a direction `n` (a finish's size, dragged): reports the distance (mm, along `n` positive) live,
 * then once more when done or cancelled (0).
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
    private look: PullLook,
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
    if (selectTyped(e, this.typed, () => (this.typed = undefined))) return this.update(), true;
    const [cancel, confirm] = [pressed(e, 'cancel'), pressed(e, 'confirm')];
    if (cancel) this.finish('cancel');
    else if (confirm) this.finish('done');
    else if (pressed(e, 'erase')) this.typed = this.typed?.slice(0, -1) || undefined;
    else if (e.key === 'Tab' && restOf(this.typed ?? '')) this.typed += restOf(this.typed!); // a name showing: written out
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
      innerHTML: caretHtml(this.look.label(this.value(), this.typed)),
    });
    this.labels.replaceChildren(el);
    keepInside(el, x, y);
    this.view.render();
  }
}

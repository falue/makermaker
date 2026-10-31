import * as THREE from 'three';
import { toWorld, type V3 } from '../doc/frames';
import type { AreaMesh } from '../kernel/build';
import { planeHit, pullBy, uvOf, type PullStart, type Target, type Tool, type ToolHost, type ToolView } from './sketch';

const v3 = (a: V3) => new THREE.Vector3(...a);
const PICK_HINT = 'Click areas to pick them (again to drop) · [Enter] or [E] pulls the picked areas · [Esc] cancels';
const PULL_HINT = 'Move to pull · [Ctrl] snaps · type a depth · click or [Enter]: done · [Esc] back to picking';

/** In a sketch: pick areas (where shapes overlap, each piece is an area), then pull them into one extrusion. */
export class AreaTool implements Tool {
  readonly kind = null;
  private picked = new Set<number>();
  private hover: number | null = null;
  private pull: (PullStart & { depth: number; typed: string | undefined }) | null = null;
  private labels = Object.assign(document.createElement('div'), { className: 'size-labels' });

  constructor(
    private view: ToolView,
    private host: ToolHost,
    private target: Target,
    private areas: AreaMesh[],
  ) {
    view.el.append(this.labels);
    host.hint(PICK_HINT);
    this.update();
  }

  dispose() {
    this.view.unlockPointer();
    this.clear();
    this.labels.remove();
    this.view.render();
  }

  down(e: PointerEvent) {
    if (e.button !== 0) return false;
    if (this.pull) this.commit();
    else {
      const i = this.areaAt(e);
      if (i !== null && !this.picked.delete(i)) this.picked.add(i);
      this.update();
    }
    return true;
  }

  move(e: PointerEvent) {
    if (this.pull) {
      const step = e.ctrlKey ? this.view.snapStep : 0.1;
      pullBy(this.view, e, this.target.frame, this.middle(), this.pull);
      this.pull.depth = Math.round(this.pull.raw / step) * step;
    } else this.hover = this.areaAt(e);
    this.update();
  }

  up() {}

  dblclick() {}

  key(e: KeyboardEvent) {
    const p = this.pull;
    if (p) {
      if (e.key === 'Escape') {
        this.pull = null;
        this.view.unlockPointer();
      }
      else if (e.key === 'Enter') return this.commit(), true;
      else if (e.key === 'Backspace') p.typed = p.typed?.slice(0, -1) || undefined;
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) p.typed = (p.typed ?? '') + e.key;
      else return false;
      this.host.hint(this.pull ? PULL_HINT : PICK_HINT);
    } else if (e.key === 'Escape') return this.host.done(null), true;
    else if ((e.key === 'Enter' || e.key.toLowerCase() === 'e') && this.picked.size) {
      this.pull = { raw: 0, depth: 0, typed: undefined };
      this.view.lockPointer();
      this.host.hint(PULL_HINT);
    } else return false;
    this.update();
    return true;
  }

  private depth() {
    const p = this.pull!;
    return (p.typed === undefined ? null : this.host.length(p.typed)) ?? p.depth;
  }

  private commit() {
    const depth = this.depth();
    if (!depth) return this.host.hint('Pull up or down, or type a depth · ' + PULL_HINT);
    this.view.unlockPointer();
    const picked = [...this.picked].map((i) => this.areas[i]);
    this.host.done({
      target: this.target,
      shapes: [...new Set(picked.flatMap((a) => [...a.in, ...a.out]))], // outside shapes cut the areas, so they are needed too
      areas: picked.map((a) => ({ in: a.in, out: a.out })),
      depth,
      depthTyped: this.pull!.typed !== undefined && this.host.length(this.pull!.typed) !== null ? this.pull!.typed : undefined,
      mode: 'add',
    });
  }

  /** The area under the pointer (by its triangles), or null. */
  private areaAt(e: MouseEvent) {
    const p = planeHit(this.view.ray(e), this.target.frame);
    if (!p) return null;
    const [u, v] = uvOf(this.target.frame, p);
    const i = this.areas.findIndex((a) => {
      const t = a.tris;
      for (let k = 0; k < t.length; k += 6) {
        const d1 = (u - t[k + 2]) * (t[k + 1] - t[k + 3]) - (t[k] - t[k + 2]) * (v - t[k + 3]);
        const d2 = (u - t[k + 4]) * (t[k + 3] - t[k + 5]) - (t[k + 2] - t[k + 4]) * (v - t[k + 5]);
        const d3 = (u - t[k]) * (t[k + 5] - t[k + 1]) - (t[k + 4] - t[k]) * (v - t[k + 1]);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
      }
      return false;
    });
    return i < 0 ? null : i;
  }

  /** Centre of the picked areas' corners, on the plane (world). */
  private middle() {
    const sum = new THREE.Vector3();
    let n = 0;
    for (const i of this.picked) {
      const t = this.areas[i].tris;
      for (let k = 0; k < t.length; k += 2, n++) sum.add(v3(toWorld(this.target.frame, t[k], t[k + 1])));
    }
    return n ? sum.divideScalar(n) : v3(this.target.frame.o);
  }

  private clear() {
    for (const o of this.view.overlay.children) {
      (o as THREE.Mesh).geometry.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.view.overlay.clear();
  }

  /** A fill of an area, `at` mm along the normal. */
  private fill(a: AreaMesh, color: number, opacity: number, at = 0) {
    const f = this.target.frame;
    const lift = v3(f.n).multiplyScalar(at + 0.08);
    const pts: number[] = [];
    for (let k = 0; k < a.tris.length; k += 2) pts.push(...v3(toWorld(f, a.tris[k], a.tris[k + 1])).add(lift).toArray());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.view.overlay.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })));
  }

  /** All areas faint, the hovered one lit, the picked ones orange; while pulling, the picked ones also at the depth. */
  private update() {
    this.clear();
    const depth = this.pull ? this.depth() : 0;
    this.areas.forEach((a, i) => {
      if (this.picked.has(i)) {
        this.fill(a, 0xff8c1a, 0.45);
        if (depth) this.fill(a, 0xff8c1a, 0.3, depth);
      } else this.fill(a, 0x3b6fd8, i === this.hover && !this.pull ? 0.35 : 0.08);
    });
    this.labels.replaceChildren();
    if (this.pull) {
      const at = this.middle().addScaledVector(v3(this.target.frame.n), depth);
      const [x, y] = this.view.toScreen(at);
      const p = this.pull;
      const el = Object.assign(document.createElement('div'), { className: 'size-label active', textContent: `Depth ${p.typed === undefined ? depth.toFixed(2) : `${p.typed}▏`}` });
      el.style.cssText = `left:${x}px;top:${y}px`;
      this.labels.append(el);
    }
    this.view.render();
  }
}

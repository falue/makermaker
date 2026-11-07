import { describe, expect, it } from 'vitest';
import { area, bounds, edgeDistance, inside, nearBox, nearestOnOutline, outlineLength, segCrossings, segments, segPoints, type DrawnProfile } from '../doc/profiles';
import type { Curve } from '../doc/types';

/**
 * Hover and snapping on a sketch crowded with curves, checked against the outlines flattened to 1e-6 mm: what the
 * view runs per pointer move (nearest outline, inside, area, per shape; see `shapeAt`, `onSketchCurve`), and where
 * lines and arcs cross. Seeded: the same hostile sketch every run.
 */
type UV = [number, number];
type Shape = DrawnProfile & { id: string };

/** A seeded random number in 0..1 (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Circles (some touching, some nested), rounded and chamfered rects, turned polygons with arcs, beziers and corner radii, open curved lines. */
function crowd(n: number, rnd: () => number): Shape[] {
  const out: Shape[] = [];
  const r = (lo: number, hi: number) => lo + (hi - lo) * rnd();
  for (let i = 0; i < n; i++) {
    const [x, y] = [r(-200, 200), r(-200, 200)];
    const id = `s${i}`;
    switch (i % 6) {
      case 0: {
        const d = r(1, 80);
        out.push({ id, kind: 'circle', x, y, d });
        // one touching it from outside, exactly
        const a = r(0, 2 * Math.PI);
        const e = r(1, 40);
        out.push({ id: `${id}t`, kind: 'circle', x: x + Math.cos(a) * (d + e) / 2, y: y + Math.sin(a) * (d + e) / 2, d: e });
        break;
      }
      case 1:
        out.push({ id, kind: 'rect', x, y, w: r(5, 90), h: r(5, 90), r: 0, rs: [r(-4, 8), r(0, 30), r(-30, 0), 0], rot: r(-180, 180) } as Shape);
        break;
      case 2: {
        const pts: UV[] = [[x, y], [x + r(10, 60), y + r(-5, 5)], [x + r(20, 70), y + r(20, 60)], [x + r(-10, 10), y + r(10, 50)]];
        const curves: (Curve | null)[] = [{ mid: [(pts[0][0] + pts[1][0]) / 2, Math.min(pts[0][1], pts[1][1]) - r(1, 15)] }, null, { c1: [pts[2][0] + r(-20, 20), pts[2][1] + r(0, 30)], c2: [pts[3][0] + r(-20, 20), pts[3][1] + r(0, 30)] }, null];
        out.push({ id, kind: 'polygon', pts, curves, r: r(0, 3), rot: r(-180, 180) });
        break;
      }
      case 3:
        out.push({ id, kind: 'ngon', x, y, d: r(5, 70), sides: 3 + Math.floor(r(0, 6)), r: r(0, 6), rot: r(0, 90) } as Shape);
        break;
      case 4: {
        const pts: UV[] = [[x, y], [x + r(20, 80), y + r(-30, 30)], [x + r(30, 120), y + r(-30, 30)]];
        out.push({ id, kind: 'line', pts, curves: [{ c1: [x + r(-20, 40), y + r(-40, 40)], c2: [pts[1][0] + r(-20, 20), pts[1][1] + r(-40, 40)] }, { mid: [(pts[1][0] + pts[2][0]) / 2 + r(-3, 3), (pts[1][1] + pts[2][1]) / 2 + r(4, 20)] }] });
        break;
      }
      default: {
        // a half disc and a full one around the same middle
        const d = r(10, 60);
        out.push({ id, kind: 'polygon', pts: [[x - d / 2, y], [x + d / 2, y]], curves: [null, { mid: [x, y + d / 2] }], r: 0, rot: r(-90, 90) });
        out.push({ id: `${id}c`, kind: 'circle', x, y, d: d * r(0.3, 1.5) });
      }
    }
  }
  return out;
}

/** The outline flattened to `tol`: closed shapes back at their start. */
const dense = (p: Shape, tol = 1e-6) => segments(p).flatMap((g, i) => segPoints(g, tol).slice(i ? 1 : 0));

function polylineDistance(pts: UV[], [u, v]: UV) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [[x0, y0], [x1, y1]] = [pts[i], pts[i + 1]];
    const [dx, dy] = [x1 - x0, y1 - y0];
    const t = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(u - x0 - t * dx, v - y0 - t * dy));
  }
  return best;
}

function evenOdd(pts: UV[], [u, v]: UV) {
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if (pts[i][1] > v !== pts[j][1] > v && u < ((pts[j][0] - pts[i][0]) * (v - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) odd = !odd;
  return odd;
}

describe('hover and snapping on a sketch crowded with curves', () => {
  const rnd = seeded(20261107);
  const shapes = crowd(240, rnd);
  const flat = new Map(shapes.map((p) => [p.id, dense(p)]));
  // pointer points: anywhere, on outlines exactly, a hair off them, on corner roundings, at shared middles
  const probes: UV[] = [];
  for (let i = 0; i < 400; i++) probes.push([-260 + 520 * rnd(), -260 + 520 * rnd()]);
  for (const p of shapes.slice(0, 120)) {
    const pts = flat.get(p.id)!;
    const q = pts[Math.floor(rnd() * (pts.length - 1))];
    probes.push(q, [q[0] + 1e-7, q[1] - 1e-7], [q[0] + 0.03 * (rnd() - 0.5), q[1] + 0.03 * (rnd() - 0.5)]);
  }

  it('the nearest point lies on the outline and none of the flattened one is nearer', () => {
    let worst = 0;
    for (const q of probes)
      for (const p of shapes) {
        const { at, d } = nearestOnOutline(p, q);
        // far from its box: at least as far as the box (the flattened outline is checked near it)
        if (!nearBox(p, ...q, 3)) {
          const [x0, y0, x1, y1] = bounds(p);
          expect(d).toBeGreaterThanOrEqual(Math.hypot(Math.max(x0 - q[0], 0, q[0] - x1), Math.max(y0 - q[1], 0, q[1] - y1)) - 1e-9);
          continue;
        }
        const truth = polylineDistance(flat.get(p.id)!, q);
        worst = Math.max(worst, Math.abs(d - truth));
        expect(d).toBeLessThanOrEqual(truth + 1e-6);
        expect(d).toBeGreaterThanOrEqual(truth - 1e-6);
        expect(edgeDistance(p, ...at)).toBeLessThan(1e-9);
      }
    expect(worst).toBeLessThan(1e-6);
  }, 120_000);

  it('inside agrees with the flattened outline wherever the pointer is clear of it', () => {
    let tested = 0;
    for (const q of probes)
      for (const p of shapes) {
        if (p.kind === 'line') {
          expect(inside(p, ...q)).toBe(false);
          continue;
        }
        if (!nearBox(p, ...q, 0)) {
          expect(inside(p, ...q)).toBe(false);
          continue;
        }
        const pts = flat.get(p.id)!;
        if (polylineDistance(pts, q) < 1e-5) continue;
        expect(inside(p, ...q), `${p.id} at ${q}`).toBe(evenOdd(pts.slice(0, -1), q));
        tested++;
      }
    expect(tested).toBeGreaterThan(1000);
  }, 120_000);

  it('areas match the flattened outlines', () => {
    for (const p of shapes) {
      if (p.kind === 'line') continue;
      const pts = flat.get(p.id)!.slice(0, -1);
      const shoelace = Math.abs(pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0)) / 2;
      // flattened 1e-6 inside the curves: short by at most that along the whole outline
      expect(Math.abs(area(p) - shoelace), p.id).toBeLessThan(1e-6 * outlineLength(p));
    }
  });

  it('crossings of lines and arcs lie on both outlines; touching circles meet once', () => {
    let found = 0;
    const plain = shapes.filter((p) => segments(p).every((g) => !g.c || 'mid' in g.c));
    for (let i = 0; i < plain.length; i++)
      for (let j = i + 1; j < plain.length; j++)
        for (const g of segments(plain[i]))
          for (const h of segments(plain[j]))
            for (const q of segCrossings(g, h)!) {
              found++;
              expect(edgeDistance(plain[i], ...q)).toBeLessThan(1e-7);
              expect(edgeDistance(plain[j], ...q)).toBeLessThan(1e-7);
            }
    expect(found).toBeGreaterThan(50);
    for (const p of shapes.filter((x) => x.id.endsWith('t'))) {
      const other = shapes.find((x) => x.id === p.id.slice(0, -1))!;
      const meet = segments(p).flatMap((g) => segments(other).flatMap((h) => segCrossings(g, h)!));
      const once = meet.filter((q, k) => !meet.slice(0, k).some((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) < 1e-6));
      expect(once.length, p.id).toBe(1);
    }
  });

  it('one hover over the whole crowd stays well inside a frame', () => {
    // what `shapeAt` does per pointer move (0.5 mm reach), on a document not hovered before
    const fresh = crowd(240, seeded(7));
    const t0 = performance.now();
    for (const q of probes)
      for (const p of fresh) {
        if (!nearBox(p, ...q, 0.5)) continue;
        const d = edgeDistance(p, ...q);
        if (d > 0.5 && !inside(p, ...q)) continue;
        area(p);
      }
    const each = (performance.now() - t0) / probes.length;
    expect(each).toBeLessThan(1); // ms for about 280 shapes, most of them curved (0.07 measured)
  });
});

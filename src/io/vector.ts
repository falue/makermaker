import type { Curve } from '../doc/types';

/**
 * SVG and DXF drawings as sketch shapes, 1:1 in mm, y up: circles stay circles, arcs stay arcs, beziers stay beziers
 * (quadratics raised to cubics, ellipses and B-splines as cubics); lines open, polygons closed. Loose pieces that meet
 * end to end are chained.
 */
export type Shape2 = { kind: 'line' | 'polygon'; pts: [number, number][]; curves?: (Curve | null)[] } | { kind: 'circle'; x: number; y: number; d: number };

type P = [number, number];
/** Points with their sides' curves (side i from point i to i + 1). */
type Piece = { pts: P[]; curves: (Curve | null)[] };
/** An affine transform [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f (as SVG has it). */
type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const times = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M, [x, y]: P): P => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Whether the transform keeps circles round (turns, mirrors, even scales). */
const similar = (m: M) => Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-9 * Math.max(1, Math.hypot(m[0], m[1])) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9 * Math.max(1, m[0] * m[0] + m[1] * m[1]);
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Points along a curve `at(t)` (t 0 to 1): about one per `step` mm, at least `min` (rational splines only). */
function sample(at: (t: number) => P, length: number, step = 0.5, min = 8): P[] {
  const n = Math.max(min, Math.ceil(length / step));
  return Array.from({ length: n + 1 }, (_, i) => at(i / n));
}

/**
 * An elliptic arc (centre `c`, radii, turned `phi`, from angle `t0` by `dt`) as sides to append, through `m`: true arcs
 * (each at most half round) where it stays a circle, else cubics of at most an eighth each (off by 4e-6 of the radius).
 */
function arcSides(c: P, rx: number, ry: number, phi: number, t0: number, dt: number, m: M): { to: P; curve: Curve }[] {
  const [cs, sn] = [Math.cos(phi), Math.sin(phi)];
  const at = (t: number): P => [c[0] + cs * rx * Math.cos(t) - sn * ry * Math.sin(t), c[1] + sn * rx * Math.cos(t) + cs * ry * Math.sin(t)];
  const round = Math.abs(rx - ry) < 1e-9 * Math.max(rx, ry) && similar(m);
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (round ? Math.PI : Math.PI / 4) - 1e-9));
  return Array.from({ length: n }, (_, i) => {
    const [a, b] = [t0 + (dt * i) / n, t0 + (dt * (i + 1)) / n];
    if (round) return { to: apply(m, at(b)), curve: { mid: apply(m, at((a + b) / 2)) } };
    const d = (t: number): P => [-cs * rx * Math.sin(t) - sn * ry * Math.cos(t), -sn * rx * Math.sin(t) + cs * ry * Math.cos(t)];
    const k = (4 / 3) * Math.tan((b - a) / 4);
    const [pa, pb] = [at(a), at(b)];
    return { to: apply(m, pb), curve: { c1: apply(m, [pa[0] + k * d(a)[0], pa[1] + k * d(a)[1]]), c2: apply(m, [pb[0] - k * d(b)[0], pb[1] - k * d(b)[1]]) } };
  });
}

/** Pieces chained where their ends meet (within `tol` mm, joined at one point); a chain back at its start becomes a polygon. */
function chain(pieces: Piece[], tol = 1e-3): Shape2[] {
  const flip = (p: Piece): Piece => ({ pts: [...p.pts].reverse(), curves: p.curves.map((c) => (c && 'c1' in c ? { c1: c.c2, c2: c.c1 } : c)).reverse() });
  const left = pieces.filter((p) => p.pts.length > 1);
  const out: Shape2[] = [];
  while (left.length) {
    let line = left.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        const [s, e] = [line.pts[0], line.pts.at(-1)!];
        const after = (a: Piece, b: Piece): Piece => ({ pts: [...a.pts, ...b.pts.slice(1)], curves: [...a.curves, ...b.curves] });
        const join = dist(e, p.pts[0]) < tol ? after(line, p) : dist(e, p.pts.at(-1)!) < tol ? after(line, flip(p)) : dist(s, p.pts.at(-1)!) < tol ? after(p, line) : dist(s, p.pts[0]) < tol ? after(flip(p), line) : null;
        if (!join) continue;
        line = join;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    const curves = line.curves.some(Boolean) ? { curves: line.curves } : {};
    const closed = dist(line.pts[0], line.pts.at(-1)!) < tol && (line.pts.length > 3 || (line.pts.length > 2 && line.curves.some(Boolean)));
    out.push(closed ? { kind: 'polygon', pts: line.pts.slice(0, -1), ...curves } : { kind: 'line', pts: line.pts, ...curves });
  }
  return out;
}

/** An elliptic arc as SVG writes it (endpoints, radii, rotation, flags), as sides through `m` (see `arcSides`). */
function svgArc(p0: P, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, p1: P, m: M): { to: P; curve: Curve | null }[] {
  if (!rx || !ry) return [{ to: apply(m, p1), curve: null }];
  [rx, ry] = [Math.abs(rx), Math.abs(ry)];
  const [c, s] = [Math.cos(phi), Math.sin(phi)];
  const [dx, dy] = [(p0[0] - p1[0]) / 2, (p0[1] - p1[1]) / 2];
  const [x1, y1] = [c * dx + s * dy, -s * dx + c * dy];
  const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (grow > 1) [rx, ry] = [rx * Math.sqrt(grow), ry * Math.sqrt(grow)];
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const [cx1, cy1] = [(k * rx * y1) / ry, (-k * ry * x1) / rx];
  const [cx, cy] = [c * cx1 - s * cy1 + (p0[0] + p1[0]) / 2, s * cx1 + c * cy1 + (p0[1] + p1[1]) / 2];
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t0 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const sides = arcSides([cx, cy], rx, ry, phi, t0, dt, m);
  sides[sides.length - 1].to = apply(m, p1); // ends exactly where it was written to
  return sides;
}

/** An SVG path's `d` as pieces through `m`. */
function pathPieces(d: string, m: M): Piece[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const pieces: Piece[] = [];
  let piece: Piece = { pts: [], curves: [] };
  let [cur, start, ctrl]: [P, P, P | null] = [[0, 0], [0, 0], null];
  let cmd = '';
  let i = 0;
  const num = () => +tokens[i++];
  const end = () => piece.pts.length > 1 && pieces.push(piece);
  const to = (p: P, curve: Curve | null = null) => (piece.pts.push(apply(m, p)), piece.curves.push(curve));
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const pt = (): P => {
      const [x, y] = [num(), num()];
      return rel ? [cur[0] + x, cur[1] + y] : [x, y];
    };
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (dist(cur, start) > 0) to(start);
      end();
      piece = { pts: [apply(m, start)], curves: [] };
      cur = start;
      ctrl = null;
      continue;
    }
    if (C === 'M') {
      end();
      cur = start = pt();
      piece = { pts: [apply(m, cur)], curves: [] };
      cmd = rel ? 'l' : 'L'; // more pairs after M are lines
    } else if (C === 'L') to((cur = pt()));
    else if (C === 'H') to((cur = [rel ? cur[0] + num() : num(), cur[1]]));
    else if (C === 'V') to((cur = [cur[0], rel ? cur[1] + num() : num()]));
    else if (C === 'C' || C === 'S' || C === 'Q' || C === 'T') {
      const q = C === 'Q' || C === 'T';
      const mirrored: P = ctrl ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur;
      const c1 = C === 'S' || C === 'T' ? mirrored : pt();
      const c2 = q ? c1 : pt();
      const p1 = pt();
      const p0 = cur;
      // a quadratic raised to a cubic: exactly the same curve
      const [k1, k2]: P[] = q ? [[p0[0] + (2 / 3) * (c1[0] - p0[0]), p0[1] + (2 / 3) * (c1[1] - p0[1])], [p1[0] + (2 / 3) * (c1[0] - p1[0]), p1[1] + (2 / 3) * (c1[1] - p1[1])]] : [c1, c2];
      to(p1, { c1: apply(m, k1), c2: apply(m, k2) });
      [cur, ctrl] = [p1, c2];
      continue;
    } else if (C === 'A') {
      const [rx, ry, rot, large, sweep] = [num(), num(), num(), num(), num()];
      const p1 = pt();
      for (const side of svgArc(cur, rx, ry, (rot * Math.PI) / 180, !!large, !!sweep, p1, m)) piece.pts.push(side.to), piece.curves.push(side.curve);
      cur = p1;
    } else i++; // unknown: skip it
    ctrl = null;
  }
  end();
  return pieces;
}

/** An SVG `transform` attribute as one transform. */
function transformOf(t: string | undefined): M {
  let m = ID;
  for (const [, name, args] of (t ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const r = ((a[0] ?? 0) * Math.PI) / 180;
    const step: M =
      name === 'matrix' ? (a.slice(0, 6) as M)
      : name === 'translate' ? [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
      : name === 'scale' ? [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
      : name === 'rotate' ? times(times([1, 0, 0, 1, a[1] ?? 0, a[2] ?? 0], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -(a[1] ?? 0), -(a[2] ?? 0)])
      : name === 'skewX' ? [1, 0, Math.tan(r), 1, 0, 0]
      : name === 'skewY' ? [1, Math.tan(r), 0, 1, 0, 0]
      : ID;
    m = times(m, step);
  }
  return m;
}

/** mm per unit of an SVG length's unit (none: px, 96 to the inch). */
const SVG_UNITS: Record<string, number> = { '': 25.4 / 96, px: 25.4 / 96, mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };

/** An SVG drawing as shapes (see the file's note): its size from width / height and viewBox. */
export function svgShapes(text: string): Shape2[] {
  const stack: M[] = [];
  const pieces: Piece[] = [];
  const circles: Shape2[] = [];
  let m = ID;
  // skip comments, CDATA and what is not drawn
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<(defs|clipPath|mask|style|text|title|desc|metadata)\b[\s\S]*?<\/\1>/g, '');
  for (const [, close, name, attrText, selfClosing] of clean.matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>/g)) {
    if (close) {
      m = stack.pop() ?? ID;
      continue;
    }
    const at: Record<string, string> = Object.fromEntries([...attrText.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((a) => [a[1], a[3] ?? a[4]]));
    const n = (k: string) => parseFloat(at[k] ?? '0') || 0;
    let own = transformOf(at.transform);
    if (name === 'svg' && !stack.length) {
      // the root: its size in mm over its viewBox
      const len = (v: string | undefined) => {
        const g = /^\s*([\d.]+)\s*([a-z%]*)/i.exec(v ?? '');
        return g && g[2] !== '%' ? +g[1] * (SVG_UNITS[g[2]] ?? SVG_UNITS.px) : null;
      };
      const box = (at.viewBox ?? '').split(/[\s,]+/).map(Number);
      const [w, h] = [len(at.width), len(at.height)];
      const s = box.length === 4 && box[2] > 0 ? (w ?? box[2] * SVG_UNITS.px) / box[2] : SVG_UNITS.px;
      const sy = box.length === 4 && box[3] > 0 && h ? h / box[3] : s;
      // y up: the drawing's top left becomes y 0, going down negative
      own = times([s, 0, 0, -sy, 0, 0], [1, 0, 0, 1, -(box[0] || 0), -(box[1] || 0)]);
    }
    const here = times(m, own);
    const put = (pts: P[]) => pieces.push({ pts: pts.map((p) => apply(here, p)), curves: pts.slice(1).map(() => null) });
    if (name === 'path' && at.d) pieces.push(...pathPieces(at.d, here));
    else if (name === 'line') put([[n('x1'), n('y1')], [n('x2'), n('y2')]]);
    else if (name === 'polyline' || name === 'polygon') {
      const v = (at.points?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      const pts = Array.from({ length: Math.floor(v.length / 2) }, (_, k): P => [v[2 * k], v[2 * k + 1]]);
      put(name === 'polygon' && pts.length ? [...pts, pts[0]] : pts);
    } else if (name === 'rect') {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      // rounded corners: rx / ry, either standing in for the other, at most half the side
      const rx = Math.min(w / 2, Math.max(0, at.rx !== undefined ? n('rx') : n('ry')));
      const ry = Math.min(h / 2, Math.max(0, at.ry !== undefined ? n('ry') : n('rx')));
      if (w > 0 && h > 0 && rx > 0 && ry > 0) {
        const piece: Piece = { pts: [apply(here, [x + rx, y])], curves: [] };
        const corner = (c: P, t0: number) => arcSides(c, rx, ry, 0, t0, Math.PI / 2, here).forEach((q) => (piece.pts.push(q.to), piece.curves.push(q.curve)));
        const line = (p: P) => (piece.pts.push(apply(here, p)), piece.curves.push(null));
        line([x + w - rx, y]);
        corner([x + w - rx, y + ry], -Math.PI / 2);
        line([x + w, y + h - ry]);
        corner([x + w - rx, y + h - ry], 0);
        line([x + rx, y + h]);
        corner([x + rx, y + h - ry], Math.PI / 2);
        line([x, y + ry]);
        corner([x + rx, y + ry], Math.PI);
        piece.pts[piece.pts.length - 1] = piece.pts[0];
        pieces.push(piece);
      } else if (w > 0 && h > 0) put([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
    } else if (name === 'circle' || name === 'ellipse') {
      const [cx, cy] = [n('cx'), n('cy')];
      const [rx, ry] = name === 'circle' ? [n('r'), n('r')] : [n('rx'), n('ry')];
      // a circle kept as one where the transform keeps it round
      const [sx, sy] = [Math.hypot(here[0], here[1]), Math.hypot(here[2], here[3])];
      const round = rx === ry && Math.abs(sx - sy) < 1e-9 * Math.max(sx, 1) && Math.abs(here[0] * here[2] + here[1] * here[3]) < 1e-9;
      if (round && rx > 0) {
        const [x, y] = apply(here, [cx, cy]);
        circles.push({ kind: 'circle', x, y, d: 2 * rx * sx });
      } else if (rx > 0 && ry > 0) {
        const sides = arcSides([cx, cy], rx, ry, 0, 0, 2 * Math.PI, here);
        sides[sides.length - 1].to = apply(here, [cx + rx, cy]);
        pieces.push({ pts: [apply(here, [cx + rx, cy]), ...sides.map((q) => q.to)], curves: sides.map((q) => q.curve) });
      }
    }
    if (!selfClosing && !['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'].includes(name)) {
      stack.push(m);
      m = here;
    } else if (!selfClosing) stack.push(m); // a drawn element written with an end tag
  }
  return [...circles, ...chain(pieces)];
}

/** mm per DXF unit ($INSUNITS; none or unitless: mm). */
const DXF_UNITS: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };

/** A DXF drawing as shapes (see the file's note): lines, circles, arcs, polylines (with bulges), ellipses and splines. */
export function dxfShapes(text: string): Shape2[] {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([+lines[i].trim(), lines[i + 1].trim()]);
  const unitAt = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  const scale = unitAt >= 0 ? (DXF_UNITS[+pairs[unitAt + 1][1]] ?? 1) : 1;
  const start = pairs.findIndex(([c, v]) => c === 2 && v === 'ENTITIES');
  // entities: each from its 0 code to the next
  const entities: { type: string; codes: [number, string][] }[] = [];
  for (let i = start + 1; i < pairs.length && start >= 0; i++) {
    const [c, v] = pairs[i];
    if (c !== 0) entities.at(-1)?.codes.push([c, v]);
    else if (v === 'ENDSEC') break;
    else entities.push({ type: v, codes: [] });
  }
  const pieces: Piece[] = [];
  const circles: Shape2[] = [];
  const s = (p: P): P => [p[0] * scale, p[1] * scale];
  const straight = (pts: P[]): Piece => ({ pts, curves: pts.slice(1).map(() => null) });
  /** A polyline's vertices with their bulges (an arc to the next one: tan of a quarter of its angle) as sides; closed: back to its start. */
  const bulged = (vs: { p: P; bulge: number }[], closed: boolean): Piece => {
    const out: Piece = { pts: [vs[0].p], curves: [] };
    const n = closed ? vs.length : vs.length - 1;
    for (let k = 0; k < n; k++) {
      const [a, b] = [vs[k], vs[(k + 1) % vs.length]];
      out.pts.push(b.p);
      if (!a.bulge) {
        out.curves.push(null);
        continue;
      }
      // the arc's middle: square off the chord's middle, by the arc's height (bulge × half the chord)
      const h = (a.bulge * dist(a.p, b.p)) / 2;
      const [dx, dy] = [(b.p[0] - a.p[0]) / dist(a.p, b.p), (b.p[1] - a.p[1]) / dist(a.p, b.p)];
      out.curves.push({ mid: [(a.p[0] + b.p[0]) / 2 + dy * h, (a.p[1] + b.p[1]) / 2 - dx * h] });
    }
    return out;
  };
  for (let k = 0; k < entities.length; k++) {
    const { type, codes } = entities[k];
    const v = (code: number) => +(codes.find(([c]) => c === code)?.[1] ?? 0);
    const all = (code: number) => codes.filter(([c]) => c === code).map(([, x]) => +x);
    if (type === 'LINE') pieces.push(straight([s([v(10), v(20)]), s([v(11), v(21)])]));
    else if (type === 'CIRCLE') circles.push({ kind: 'circle', x: v(10) * scale, y: v(20) * scale, d: 2 * v(40) * scale });
    else if (type === 'ARC') {
      const [c, r] = [s([v(10), v(20)]), v(40) * scale];
      let [a0, a1] = [(v(50) * Math.PI) / 180, (v(51) * Math.PI) / 180];
      if (a1 <= a0) a1 += 2 * Math.PI;
      const sides = arcSides(c, r, r, 0, a0, a1 - a0, ID);
      pieces.push({ pts: [[c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)], ...sides.map((q) => q.to)], curves: sides.map((q) => q.curve) });
    } else if (type === 'LWPOLYLINE') {
      // its vertices in order: each 10 starts one, a 42 after it is its bulge
      const vs: { p: P; bulge: number }[] = [];
      for (let i = 0; i < codes.length; i++) {
        if (codes[i][0] === 10) vs.push({ p: s([+codes[i][1], +(codes[i + 1]?.[0] === 20 ? codes[i + 1][1] : 0)]), bulge: 0 });
        if (codes[i][0] === 42 && vs.length) vs.at(-1)!.bulge = +codes[i][1];
      }
      if (vs.length > 1) pieces.push(bulged(vs, (v(70) & 1) === 1));
    } else if (type === 'POLYLINE') {
      const closed = (v(70) & 1) === 1;
      const vs: { p: P; bulge: number }[] = [];
      while (entities[k + 1]?.type === 'VERTEX') {
        const c = entities[++k].codes;
        const g = (code: number) => +(c.find(([x]) => x === code)?.[1] ?? 0);
        vs.push({ p: s([g(10), g(20)]), bulge: g(42) });
      }
      if (vs.length > 1) pieces.push(bulged(vs, closed));
    } else if (type === 'ELLIPSE') {
      const [c, major, ratio] = [s([v(10), v(20)]), s([v(11), v(21)]), v(40)];
      let [t0, t1] = [v(41), codes.some(([x]) => x === 42) ? v(42) : 2 * Math.PI];
      if (t1 <= t0) t1 += 2 * Math.PI;
      const [rx, phi] = [Math.hypot(...major), Math.atan2(major[1], major[0])];
      const sides = arcSides(c, rx, rx * ratio, phi, t0, t1 - t0, ID);
      const start: P = [c[0] + major[0] * Math.cos(t0) - major[1] * ratio * Math.sin(t0), c[1] + major[1] * Math.cos(t0) + major[0] * ratio * Math.sin(t0)];
      pieces.push({ pts: [start, ...sides.map((q) => q.to)], curves: sides.map((q) => q.curve) });
    } else if (type === 'SPLINE') {
      const fit = all(11).map((x, i): P => s([x, all(21)[i]]));
      const ctrl = all(10).map((x, i): P => s([x, all(20)[i]]));
      const [degree, knots, weights] = [v(71) || 3, all(40), all(41)];
      const rational = weights.length === ctrl.length && weights.some((w) => Math.abs(w - 1) > 1e-12);
      if (ctrl.length > degree && knots.length === ctrl.length + degree + 1) pieces.push(rational || degree > 3 ? straight(nurbsPoints(ctrl, weights, degree, knots)) : bezierPieces(ctrl, degree, knots));
      else if (fit.length > 1) pieces.push(throughPoints(fit));
    }
  }
  return [...circles, ...chain(pieces)];
}

/** A B-spline (degree 1 to 3, not rational) as its exact cubic pieces: its knots inserted until each has multiplicity `degree` (Boehm). */
function bezierPieces(ctrl: P[], degree: number, knots: number[]): Piece {
  let [P_, U] = [ctrl.map((p) => [...p] as P), [...knots]];
  const [lo, hi] = [knots[degree], knots[ctrl.length]];
  const insert = (u: number) => {
    let k = degree;
    while (k < U.length - degree - 2 && U[k + 1] <= u) k++;
    const Q: P[] = [];
    for (let j = k - degree + 1; j <= k; j++) {
      const a = U[j + degree] - U[j] ? (u - U[j]) / (U[j + degree] - U[j]) : 0;
      Q.push([(1 - a) * P_[j - 1][0] + a * P_[j][0], (1 - a) * P_[j - 1][1] + a * P_[j][1]]);
    }
    P_ = [...P_.slice(0, k - degree + 1), ...Q, ...P_.slice(k)];
    U = [...U.slice(0, k + 1), u, ...U.slice(k + 1)];
  };
  for (const u of [...new Set(U.filter((u) => u >= lo && u <= hi))]) while (U.filter((x) => x === u).length < degree) insert(u);
  const out: Piece = { pts: [], curves: [] };
  for (let i = degree; i < U.length - degree - 1; i++) {
    if (!(U[i] < U[i + 1]) || U[i] < lo || U[i + 1] > hi) continue;
    const b = P_.slice(i - degree, i + 1);
    if (!out.pts.length) out.pts.push(b[0]);
    out.pts.push(b[degree]);
    // a quadratic raised to a cubic; a straight piece stays straight
    out.curves.push(degree === 1 ? null : degree === 2 ? { c1: [b[0][0] + (2 / 3) * (b[1][0] - b[0][0]), b[0][1] + (2 / 3) * (b[1][1] - b[0][1])], c2: [b[2][0] + (2 / 3) * (b[1][0] - b[2][0]), b[2][1] + (2 / 3) * (b[1][1] - b[2][1])] } : { c1: b[1], c2: b[2] });
  }
  return out;
}

/** A rational or higher-degree B-spline as points (de Boor on homogeneous points, weights 1 where none). */
function nurbsPoints(ctrl: P[], weights: number[], degree: number, knots: number[]): P[] {
  const [lo, hi] = [knots[degree], knots[ctrl.length]];
  const w = ctrl.map((_, i) => weights[i] ?? 1);
  const at = (t: number): P => {
    const u = lo + (hi - lo) * Math.min(t, 1 - 1e-12);
    let span = degree;
    while (span < ctrl.length - 1 && knots[span + 1] <= u) span++;
    const d = ctrl.slice(span - degree, span + 1).map((p, j) => [p[0] * w[span - degree + j], p[1] * w[span - degree + j], w[span - degree + j]]);
    for (let r = 1; r <= degree; r++)
      for (let j = degree; j >= r; j--) {
        const i = span - degree + j;
        const a = (u - knots[i]) / (knots[i + degree - r + 1] - knots[i] || 1);
        d[j] = d[j].map((x, k) => (1 - a) * d[j - 1][k] + a * x);
      }
    return [d[degree][0] / d[degree][2], d[degree][1] / d[degree][2]];
  };
  const rough = ctrl.slice(1).reduce((n, p, i) => n + dist(p, ctrl[i]), 0);
  return [...sample(at, rough).slice(0, -1), at(1)];
}

/** A smooth curve through points (a spline given by fit points only): cubics with Catmull–Rom tangents. */
function throughPoints(pts: P[]): Piece {
  const n = pts.length;
  const tangent = (i: number): P => {
    const [a, b] = [pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]];
    const k = i === 0 || i === n - 1 ? 1 / 3 : 1 / 6;
    return [(b[0] - a[0]) * k, (b[1] - a[1]) * k];
  };
  return {
    pts,
    curves: pts.slice(1).map((b, i) => (n === 2 ? null : { c1: [pts[i][0] + tangent(i)[0], pts[i][1] + tangent(i)[1]], c2: [b[0] - tangent(i + 1)[0], b[1] - tangent(i + 1)[1]] })),
  };
}

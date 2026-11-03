/**
 * SVG and DXF drawings as sketch shapes, 1:1 in mm, y up: circles stay circles, everything else becomes lines (open)
 * or polygons (closed), curves sampled finely. Loose pieces that meet end to end are chained.
 */
export type Shape2 = { kind: 'line' | 'polygon'; pts: [number, number][] } | { kind: 'circle'; x: number; y: number; d: number };

type P = [number, number];
/** An affine transform [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f (as SVG has it). */
type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const times = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M, [x, y]: P): P => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Points along a curve `at(t)` (t 0 to 1): about one per `step` mm, at least `min`. */
function sample(at: (t: number) => P, length: number, step = 0.5, min = 8): P[] {
  const n = Math.max(min, Math.ceil(length / step));
  return Array.from({ length: n + 1 }, (_, i) => at(i / n));
}
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Pieces chained where their ends meet (within `tol`); a chain back at its start becomes a polygon. */
function chain(pieces: P[][], tol = 1e-4): Shape2[] {
  const left = pieces.filter((p) => p.length > 1);
  const out: Shape2[] = [];
  while (left.length) {
    const line = left.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        const [s, e] = [line[0], line.at(-1)!];
        const join = dist(e, p[0]) < tol ? [...line, ...p.slice(1)] : dist(e, p.at(-1)!) < tol ? [...line, ...p.slice(0, -1).reverse()] : dist(s, p.at(-1)!) < tol ? [...p, ...line.slice(1)] : dist(s, p[0]) < tol ? [...p.slice(1).reverse(), ...line] : null;
        if (!join) continue;
        line.splice(0, line.length, ...join);
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    const closed = line.length > 3 && dist(line[0], line.at(-1)!) < tol;
    out.push(closed ? { kind: 'polygon', pts: line.slice(0, -1) } : { kind: 'line', pts: line });
  }
  return out;
}

/** An elliptic arc as SVG writes it (endpoints, radii, rotation, flags), as points. */
function svgArc(p0: P, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, p1: P): P[] {
  if (!rx || !ry) return [p0, p1];
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
  return sample((t) => {
    const a = t0 + dt * t;
    return [cx + c * rx * Math.cos(a) - s * ry * Math.sin(a), cy + s * rx * Math.cos(a) + c * ry * Math.sin(a)];
  }, Math.abs(dt) * Math.max(rx, ry));
}

/** An SVG path's `d` as pieces of points (in its own units). */
function pathPieces(d: string): P[][] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const pieces: P[][] = [];
  let piece: P[] = [];
  let [cur, start, ctrl]: [P, P, P | null] = [[0, 0], [0, 0], null];
  let cmd = '';
  let i = 0;
  const num = () => +tokens[i++];
  const end = () => piece.length > 1 && pieces.push(piece);
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const pt = (): P => {
      const [x, y] = [num(), num()];
      return rel ? [cur[0] + x, cur[1] + y] : [x, y];
    };
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      piece.push(start);
      end();
      piece = [start];
      cur = start;
      ctrl = null;
      continue;
    }
    if (C === 'M') {
      end();
      cur = start = pt();
      piece = [cur];
      cmd = rel ? 'l' : 'L'; // more pairs after M are lines
    } else if (C === 'L') piece.push((cur = pt()));
    else if (C === 'H') piece.push((cur = [rel ? cur[0] + num() : num(), cur[1]]));
    else if (C === 'V') piece.push((cur = [cur[0], rel ? cur[1] + num() : num()]));
    else if (C === 'C' || C === 'S' || C === 'Q' || C === 'T') {
      const q = C === 'Q' || C === 'T';
      const mirrored: P = ctrl ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur;
      const c1 = C === 'S' || C === 'T' ? mirrored : pt();
      const c2 = q ? c1 : pt();
      const p1 = pt();
      const p0 = cur;
      const at = (t: number): P => {
        const u = 1 - t;
        return q ? [u * u * p0[0] + 2 * u * t * c1[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c1[1] + t * t * p1[1]] : [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]];
      };
      piece.push(...sample(at, dist(p0, c1) + dist(c1, c2) + dist(c2, p1)).slice(1));
      [cur, ctrl] = [p1, c2];
      continue;
    } else if (C === 'A') {
      const [rx, ry, rot, large, sweep] = [num(), num(), num(), num(), num()];
      const p1 = pt();
      piece.push(...svgArc(cur, rx, ry, (rot * Math.PI) / 180, !!large, !!sweep, p1).slice(1));
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
  const pieces: P[][] = [];
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
    const put = (pts: P[]) => pieces.push(pts.map((p) => apply(here, p)));
    if (name === 'path' && at.d) pathPieces(at.d).forEach(put);
    else if (name === 'line') put([[n('x1'), n('y1')], [n('x2'), n('y2')]]);
    else if (name === 'polyline' || name === 'polygon') {
      const v = (at.points?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      const pts = Array.from({ length: Math.floor(v.length / 2) }, (_, k): P => [v[2 * k], v[2 * k + 1]]);
      put(name === 'polygon' && pts.length ? [...pts, pts[0]] : pts);
    } else if (name === 'rect') {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      if (w > 0 && h > 0) put([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
    } else if (name === 'circle' || name === 'ellipse') {
      const [cx, cy] = [n('cx'), n('cy')];
      const [rx, ry] = name === 'circle' ? [n('r'), n('r')] : [n('rx'), n('ry')];
      // a circle kept as one where the transform keeps it round
      const [sx, sy] = [Math.hypot(here[0], here[1]), Math.hypot(here[2], here[3])];
      const round = rx === ry && Math.abs(sx - sy) < 1e-9 * Math.max(sx, 1) && Math.abs(here[0] * here[2] + here[1] * here[3]) < 1e-9;
      if (round && rx > 0) {
        const [x, y] = apply(here, [cx, cy]);
        circles.push({ kind: 'circle', x, y, d: 2 * rx * sx });
      } else if (rx > 0 && ry > 0) put(sample((t) => [cx + rx * Math.cos(2 * Math.PI * t), cy + ry * Math.sin(2 * Math.PI * t)], 2 * Math.PI * Math.max(rx, ry) * Math.max(sx, sy), 0.5, 32));
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
  const pieces: P[][] = [];
  const circles: Shape2[] = [];
  const s = (p: P): P => [p[0] * scale, p[1] * scale];
  /** A polyline's vertices with their bulges (an arc to the next one: tan of a quarter of its angle) as points; closed: back to its start. */
  const bulged = (vs: { p: P; bulge: number }[], closed: boolean): P[] => {
    const out: P[] = [vs[0].p];
    const n = closed ? vs.length : vs.length - 1;
    for (let k = 0; k < n; k++) {
      const [a, b] = [vs[k], vs[(k + 1) % vs.length]];
      if (!a.bulge) {
        out.push(b.p);
        continue;
      }
      const theta = 4 * Math.atan(a.bulge);
      const chord = dist(a.p, b.p);
      const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
      const mid: P = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
      const h = r * Math.cos(theta / 2);
      const nrm: P = [-(b.p[1] - a.p[1]) / chord, (b.p[0] - a.p[0]) / chord];
      const c: P = [mid[0] + nrm[0] * h * Math.sign(a.bulge), mid[1] + nrm[1] * h * Math.sign(a.bulge)];
      const t0 = Math.atan2(a.p[1] - c[1], a.p[0] - c[0]);
      out.push(...sample((t) => [c[0] + r * Math.cos(t0 + theta * t), c[1] + r * Math.sin(t0 + theta * t)], Math.abs(theta) * r).slice(1));
    }
    return out;
  };
  for (let k = 0; k < entities.length; k++) {
    const { type, codes } = entities[k];
    const v = (code: number) => +(codes.find(([c]) => c === code)?.[1] ?? 0);
    const all = (code: number) => codes.filter(([c]) => c === code).map(([, x]) => +x);
    if (type === 'LINE') pieces.push([s([v(10), v(20)]), s([v(11), v(21)])]);
    else if (type === 'CIRCLE') circles.push({ kind: 'circle', x: v(10) * scale, y: v(20) * scale, d: 2 * v(40) * scale });
    else if (type === 'ARC') {
      const [c, r] = [s([v(10), v(20)]), v(40) * scale];
      let [a0, a1] = [(v(50) * Math.PI) / 180, (v(51) * Math.PI) / 180];
      if (a1 <= a0) a1 += 2 * Math.PI;
      pieces.push(sample((t) => [c[0] + r * Math.cos(a0 + (a1 - a0) * t), c[1] + r * Math.sin(a0 + (a1 - a0) * t)], (a1 - a0) * r));
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
      const minor: P = [-major[1] * ratio, major[0] * ratio];
      pieces.push(sample((t) => {
        const a = t0 + (t1 - t0) * t;
        return [c[0] + major[0] * Math.cos(a) + minor[0] * Math.sin(a), c[1] + major[1] * Math.cos(a) + minor[1] * Math.sin(a)];
      }, (t1 - t0) * Math.hypot(...major), 0.5, 32));
    } else if (type === 'SPLINE') {
      const fit = all(11).map((x, i): P => s([x, all(21)[i]]));
      const ctrl = all(10).map((x, i): P => s([x, all(20)[i]]));
      const [degree, knots] = [v(71) || 3, all(40)];
      if (ctrl.length > degree && knots.length === ctrl.length + degree + 1) {
        // de Boor's algorithm over the knots' span
        const [lo, hi] = [knots[degree], knots[ctrl.length]];
        const at = (t: number): P => {
          const u = lo + (hi - lo) * Math.min(t, 1 - 1e-12);
          let span = degree;
          while (span < ctrl.length - 1 && knots[span + 1] <= u) span++;
          const d = ctrl.slice(span - degree, span + 1).map((p) => [...p] as P);
          for (let r = 1; r <= degree; r++)
            for (let j = degree; j >= r; j--) {
              const i = span - degree + j;
              const a = (u - knots[i]) / (knots[i + degree - r + 1] - knots[i] || 1);
              d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
            }
          return d[degree];
        };
        const rough = ctrl.slice(1).reduce((n, p, i) => n + dist(p, ctrl[i]), 0);
        pieces.push([...sample(at, rough).slice(0, -1), at(1)]);
      } else if (fit.length > 1) pieces.push(fit);
    }
  }
  return [...circles, ...chain(pieces)];
}

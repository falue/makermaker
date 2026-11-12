import { arcOf, biarcs, bounds, segments, type DrawnProfile } from '../doc/profiles';
import type { Curve } from '../doc/types';

type P2 = [number, number];

/**
 * One cut: a loop of corners with its sides' curves (side i from corner i to i + 1; arcs exact), or a circle (kept as
 * one); `hole`: inside the outline; `open`: a path from its first point to its last (a sketch's line), not closed.
 */
export type Cut = { hole: boolean; pts: P2[]; curves: (Curve | null)[]; circle?: { c: P2; r: number }; open?: boolean };

/** A sketch's shapes (mm, in its plane) as cuts, y down as the writers take them: circles as one, lines open; construction lines left out. */
export function sketchCuts(shapes: DrawnProfile[]): Cut[] {
  const down = ([u, v]: P2): P2 => [u, -v];
  return shapes.flatMap((q): Cut[] => {
    if (q.construction) return [];
    if (q.kind === 'circle') return [{ hole: false, pts: [], curves: [], circle: { c: down([q.x, q.y]), r: q.d / 2 } }];
    const sides = segments(q);
    if (!sides.length) return [];
    const open = q.kind === 'line';
    const curves = sides.map(({ c }) => (!c ? null : 'mid' in c ? { mid: down(c.mid) } : { c1: down(c.c1), c2: down(c.c2) }));
    return [{ hole: false, pts: [...sides.map((g) => down(g.a)), ...(open ? [down(sides.at(-1)!.b)] : [])], curves, ...(open ? { open } : {}) }];
  });
}

const f = (x: number) => +x.toFixed(4);

/** A piece's name on the sheet: its baseline's left end (y down), its height (mm). */
export type Label = { at: P2; text: string; size: number };

/** A label's box: its letters taken as 0.6 of its height wide. */
const labelBox = (l: Label) => [l.at[0], l.at[1] - l.size, l.at[0] + l.text.length * l.size * 0.6, l.at[1] + l.size * 0.25];

/** The cuts' and labels' box (min x, min y, max x, max y). */
function boxOf(cuts: Cut[], labels: Label[] = []) {
  const all = [...cuts.map((c) => (c.circle ? [c.circle.c[0] - c.circle.r, c.circle.c[1] - c.circle.r, c.circle.c[0] + c.circle.r, c.circle.c[1] + c.circle.r] : bounds({ kind: 'polygon', pts: c.pts, curves: c.curves, r: 0, rot: 0 }))), ...labels.map(labelBox)];
  return [0, 1, 2, 3].map((k) => (k < 2 ? Math.min : Math.max)(...all.map((b) => b[k])));
}

/** `c` moved by (dx, dy). */
function moved(c: Cut, dx: number, dy: number): Cut {
  const m = ([x, y]: P2): P2 => [x + dx, y + dy];
  const curves = c.curves.map((k) => (!k ? null : 'mid' in k ? { mid: m(k.mid) } : { c1: m(k.c1), c2: m(k.c2) }));
  return { ...c, pts: c.pts.map(m), curves, ...(c.circle ? { circle: { c: m(c.circle.c), r: c.circle.r } } : {}) };
}

/**
 * Pieces side by side on one sheet: in rows, tallest first, the rows about as wide as the sheet is tall; `gap` mm
 * between them, each one's name `text` mm high over its top left.
 */
export function sheetOf(pieces: { name: string; cuts: Cut[] }[], gap = 5, text = 4): { cuts: Cut[]; labels: Label[] } {
  const sized = pieces.filter((p) => p.cuts.length).map((p) => {
    const [x0, y0, x1, y1] = boxOf(p.cuts);
    return { ...p, x0, y0, w: x1 - x0, h: y1 - y0 + text + 1 };
  });
  const area = sized.reduce((n, p) => n + (p.w + gap) * (p.h + gap), 0);
  const width = Math.max(...sized.map((p) => p.w), Math.sqrt(area));
  const out: { cuts: Cut[]; labels: Label[] } = { cuts: [], labels: [] };
  let [x, y, row] = [0, 0, 0];
  for (const p of sized.sort((a, b) => b.h - a.h)) {
    if (x > 0 && x + p.w > width) [x, y, row] = [0, y + row + gap, 0];
    out.labels.push({ at: [x, y + text], text: p.name, size: text });
    out.cuts.push(...p.cuts.map((c) => moved(c, x - p.x0, y + text + 1 - p.y0)));
    [x, row] = [x + p.w + gap, Math.max(row, p.h)];
  }
  return out;
}

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A side's arc: radius, more than half round, running with rising angle (as SVG's flags have it); null: straight or a bezier. */
function arcFlags(a: P2, c: Curve | null, b: P2) {
  const arc = c && 'mid' in c ? arcOf(a, c.mid, b) : null;
  return arc && { r: arc.r, large: Math.abs(arc.a1 - arc.a0) > Math.PI, rising: arc.a1 > arc.a0, turn: arc.a1 - arc.a0 };
}

/** An SVG of the cuts at 1:1 in mm (`margin` around them), red 1 pt lines (`stroke` mm), the labels in black; arcs as arcs, beziers as cubics. */
export function svgOf(cuts: Cut[], margin = 2, labels: Label[] = [], stroke = 25.4 / 72): string {
  const [x0, y0, x1, y1] = boxOf(cuts, labels);
  const [x, y, w, h] = [x0 - margin, y0 - margin, x1 - x0 + 2 * margin, y1 - y0 + 2 * margin];
  const shapes = cuts.map((c) => {
    if (c.circle) return `<circle cx="${f(c.circle.c[0])}" cy="${f(c.circle.c[1])}" r="${f(c.circle.r)}"/>`;
    const sides = (c.open ? c.pts.slice(0, -1) : c.pts).map((a, i) => {
      const [b, k] = [c.pts[(i + 1) % c.pts.length], c.curves[i]];
      const arc = arcFlags(a, k, b);
      if (arc) return `A${f(arc.r)} ${f(arc.r)} 0 ${+arc.large} ${+arc.rising} ${f(b[0])} ${f(b[1])}`;
      return k && 'c1' in k ? `C${f(k.c1[0])} ${f(k.c1[1])} ${f(k.c2[0])} ${f(k.c2[1])} ${f(b[0])} ${f(b[1])}` : `L${f(b[0])} ${f(b[1])}`;
    });
    if (c.open) return `<path d="M${f(c.pts[0][0])} ${f(c.pts[0][1])}${sides.join('')}"/>`;
    return `<path d="M${f(c.pts[0][0])} ${f(c.pts[0][1])}${sides.slice(0, -1).join('')}${sides.at(-1)!.startsWith('L') ? '' : sides.at(-1)}Z"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}">
  <g fill="none" stroke="#ff0000" stroke-width="${f(stroke)}">
    ${shapes.join('\n    ')}
  </g>${labels.length ? `\n  <g fill="#000000" font-family="sans-serif">\n    ${labels.map((l) => `<text x="${f(l.at[0])}" y="${f(l.at[1])}" font-size="${f(l.size)}">${xml(l.text)}</text>`).join('\n    ')}\n  </g>` : ''}
</svg>
`;
}

/**
 * A DXF (R12, mm) of the cuts on layer CUT in red: closed (or open) polylines (arcs as bulges, beziers as arcs within
 * 1 µm) and circles, y up as DXF has it; the labels as text on layer LABEL in black (colour 7: black on white).
 */
export function dxfOf(cuts: Cut[], labels: Label[] = []): string {
  const out: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
  for (const c of cuts) {
    if (c.circle) {
      out.push(0, 'CIRCLE', 8, 'CUT', 62, 1, 10, f(c.circle.c[0]), 20, f(-c.circle.c[1]), 30, 0, 40, f(c.circle.r));
      continue;
    }
    out.push(0, 'POLYLINE', 8, 'CUT', 62, 1, 66, 1, 10, 0, 20, 0, 30, 0, 70, c.open ? 0 : 1);
    const vertex = ([x, y]: P2, bulge = 0) => out.push(0, 'VERTEX', 8, 'CUT', 10, f(x), 20, f(-y), 30, 0, ...(bulge ? [42, +bulge.toFixed(9)] : []));
    // a bulge: tan of a quarter of the arc's angle, counter-clockwise positive (y flipped: turned round)
    const bulge = (a: P2, k: Curve | null, b: P2) => {
      const arc = arcFlags(a, k, b);
      return arc ? -Math.tan(arc.turn / 4) : 0;
    };
    c.pts.forEach((a, i) => {
      // an open path's last point ends it
      if (c.open && i === c.pts.length - 1) return vertex(a);
      const [b, k] = [c.pts[(i + 1) % c.pts.length], c.curves[i]];
      if (!k || !('c1' in k)) return vertex(a, bulge(a, k, b));
      // a bezier as arcs within 1 µm
      const bez = (t: number, d = 0): P2 => [0, 1].map((m) => (d ? 3 * (1 - t) ** 2 * (k.c1[m] - a[m]) + 6 * (1 - t) * t * (k.c2[m] - k.c1[m]) + 3 * t ** 2 * (b[m] - k.c2[m]) : (1 - t) ** 3 * a[m] + 3 * (1 - t) ** 2 * t * k.c1[m] + 3 * (1 - t) * t ** 2 * k.c2[m] + t ** 3 * b[m])) as P2;
      const fit = biarcs((t) => bez(t), (t) => bez(t, 1));
      fit.curves.forEach((c, j) => vertex(fit.pts[j], bulge(fit.pts[j], c, fit.pts[j + 1])));
    });
    out.push(0, 'SEQEND', 8, 'CUT');
  }
  for (const l of labels) out.push(0, 'TEXT', 8, 'LABEL', 62, 7, 10, f(l.at[0]), 20, f(-l.at[1]), 30, 0, 40, f(l.size), 1, l.text);
  out.push(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}


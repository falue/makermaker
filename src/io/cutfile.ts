import { arcOf, biarcs, bounds, segments, type DrawnProfile } from '../doc/profiles';
import type { Curve } from '../doc/types';

type P2 = [number, number];

/**
 * One cut: a loop of corners with its sides' curves (side i from corner i to i + 1; arcs exact), or a circle (kept as
 * one); `hole`: inside the outline; `open`: a path from its first point to its last (a sketch's line), not closed;
 * `mark`: a line drawn, not cut (where a slanted part meets the face: for sanding, for orientation); `key`: a line of
 * the key drawing (which piece is where), black like the names, neither cut nor marked.
 */
export type Cut = { hole: boolean; pts: P2[]; curves: (Curve | null)[]; circle?: { c: P2; r: number }; open?: boolean; mark?: boolean; key?: boolean };

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
 * A piece placed on a sheet: its cuts and its name over them, `notes`: more text on it (a key drawing's numbers);
 * `shift`: how far it was moved there; `from`: its place among the pieces given.
 */
export type Placed = { label: Label; cuts: Cut[]; notes: Label[]; shift: P2; from: number };

/**
 * Pieces side by side on one sheet: in rows, tallest first, the rows about as wide as the sheet is tall; `gap` mm
 * between them, each one's name `text` mm high over its top left.
 */
export function sheetOf(pieces: { name: string; cuts: Cut[]; notes?: Label[] }[], gap = 20, text = 4): Placed[] {
  const sized = pieces.flatMap((p, from) => {
    if (!p.cuts.length) return [];
    const [x0, y0, x1, y1] = boxOf(p.cuts, p.notes);
    return [{ ...p, from, x0, y0, w: x1 - x0, h: y1 - y0 + text + 1 }];
  });
  const area = sized.reduce((n, p) => n + (p.w + gap) * (p.h + gap), 0);
  const width = Math.max(...sized.map((p) => p.w), Math.sqrt(area));
  const out: Placed[] = [];
  let [x, y, row] = [0, 0, 0];
  for (const p of sized.sort((a, b) => b.h - a.h)) {
    if (x > 0 && x + p.w > width) [x, y, row] = [0, y + row + gap, 0];
    const shift: P2 = [x - p.x0, y + text + 1 - p.y0];
    const notes = (p.notes ?? []).map((l) => ({ ...l, at: [l.at[0] + shift[0], l.at[1] + shift[1]] as P2 }));
    out.push({ label: { at: [x, y + text], text: p.name, size: text }, cuts: p.cuts.map((c) => moved(c, ...shift)), notes, shift, from: p.from });
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

/** One cut as an SVG element: arcs as arcs, beziers as cubics. */
function svgShape(c: Cut) {
  if (c.circle) return `<circle cx="${f(c.circle.c[0])}" cy="${f(c.circle.c[1])}" r="${f(c.circle.r)}"/>`;
  const sides = (c.open ? c.pts.slice(0, -1) : c.pts).map((a, i) => {
    const [b, k] = [c.pts[(i + 1) % c.pts.length], c.curves[i]];
    const arc = arcFlags(a, k, b);
    if (arc) return `A${f(arc.r)} ${f(arc.r)} 0 ${+arc.large} ${+arc.rising} ${f(b[0])} ${f(b[1])}`;
    return k && 'c1' in k ? `C${f(k.c1[0])} ${f(k.c1[1])} ${f(k.c2[0])} ${f(k.c2[1])} ${f(b[0])} ${f(b[1])}` : `L${f(b[0])} ${f(b[1])}`;
  });
  if (c.open) return `<path d="M${f(c.pts[0][0])} ${f(c.pts[0][1])}${sides.join('')}"/>`;
  return `<path d="M${f(c.pts[0][0])} ${f(c.pts[0][1])}${sides.slice(0, -1).join('')}${sides.at(-1)!.startsWith('L') ? '' : sides.at(-1)}Z"/>`;
}

/** Cuts red, marks green and key lines black, each kind in a group of its own (`stroke` mm wide), indented by `pad`. */
function svgCuts(cuts: Cut[], stroke: number, pad: string) {
  const group = (colour: string, of: Cut[]) => (of.length ? `\n${pad}<g fill="none" stroke="${colour}" stroke-width="${f(stroke)}">\n${pad}  ${of.map(svgShape).join(`\n${pad}  `)}\n${pad}</g>` : '');
  return group('#ff0000', cuts.filter((c) => !c.mark && !c.key)) + group('#00ff00', cuts.filter((c) => c.mark)) + group('#000000', cuts.filter((c) => c.key));
}

/** A text in black, `pad` before it. */
const svgText = (l: Label, pad: string) => `\n${pad}<text x="${f(l.at[0])}" y="${f(l.at[1])}" font-size="${f(l.size)}" font-family="sans-serif" fill="#000000">${xml(l.text)}</text>`;

/** An SVG document `margin` around `box` (min x, min y, max x, max y; mm) holding `body`. */
const svgFile = ([x0, y0, x1, y1]: number[], margin: number, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f(x1 - x0 + 2 * margin)}mm" height="${f(y1 - y0 + 2 * margin)}mm" viewBox="${f(x0 - margin)} ${f(y0 - margin)} ${f(x1 - x0 + 2 * margin)} ${f(y1 - y0 + 2 * margin)}">${body}
</svg>
`;

/** An SVG of the cuts at 1:1 in mm (`margin` around them): red 1 pt lines (`stroke` mm), marks green. */
export const svgOf = (cuts: Cut[], margin = 2, stroke = 25.4 / 72) => svgFile(boxOf(cuts), margin, svgCuts(cuts, stroke, '  '));

/** An SVG of a sheet (see `sheetOf`): each piece a group (named by its id) of its cuts and its name in black. */
export function sheetSvg(pieces: Placed[], margin = 2, stroke = 25.4 / 72): string {
  const taken = new Set<string>();
  const id = (name: string) => {
    const base = name.replace(/[^\w-]+/g, '_').replace(/^(?=\d|-|$)/, 'p');
    let out = base;
    for (let k = 2; taken.has(out); k++) out = `${base}_${k}`;
    return taken.add(out), out;
  };
  const groups = pieces.map(({ label, cuts, notes }) => `\n  <g id="${id(label.text)}">${svgCuts(cuts, stroke, '    ')}${[label, ...notes].map((l) => svgText(l, '    ')).join('')}\n  </g>`);
  return svgFile(boxOf(pieces.flatMap((p) => p.cuts), pieces.flatMap((p) => [p.label, ...p.notes])), margin, groups.join(''));
}

/**
 * A DXF (R12, mm) of the cuts on layer CUT in red: closed (or open) polylines (arcs as bulges, beziers as arcs within
 * 1 µm) and circles, y up as DXF has it; marks on layer MARK in green, key lines on layer KEY in black; the labels as
 * text on layer LABEL in black (colour 7: black on white).
 */
export function dxfOf(cuts: Cut[], labels: Label[] = []): string {
  const out: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
  for (const c of cuts) {
    const [layer, colour] = c.key ? ['KEY', 7] : c.mark ? ['MARK', 3] : ['CUT', 1];
    if (c.circle) {
      out.push(0, 'CIRCLE', 8, layer, 62, colour, 10, f(c.circle.c[0]), 20, f(-c.circle.c[1]), 30, 0, 40, f(c.circle.r));
      continue;
    }
    out.push(0, 'POLYLINE', 8, layer, 62, colour, 66, 1, 10, 0, 20, 0, 30, 0, 70, c.open ? 0 : 1);
    const vertex = ([x, y]: P2, bulge = 0) => out.push(0, 'VERTEX', 8, layer, 10, f(x), 20, f(-y), 30, 0, ...(bulge ? [42, +bulge.toFixed(9)] : []));
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
    out.push(0, 'SEQEND', 8, layer);
  }
  for (const l of labels) out.push(0, 'TEXT', 8, 'LABEL', 62, 7, 10, f(l.at[0]), 20, f(-l.at[1]), 30, 0, 40, f(l.size), 1, l.text);
  out.push(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}


/**
 * A sheet drawn to look at (not to cut): each piece's faces filled (`faces`, by the pieces given to `sheetOf`: white, more
 * orange the more they stretch, full at `full`: 0.1 is 10 %), its cuts dark red, its folds dashed green, key lines dark grey, its texts;
 * lines one pixel wide at any size.
 */
export function previewSvg(pieces: Placed[], faces: { loops: P2[][]; stretch: number }[][], full = 0.1): string {
  const shade = (s: number) => `hsl(24 95% ${Math.round(100 - Math.min(1, s / full) * 38)}%)`;
  const path = (loops: P2[][], [dx, dy]: P2) => loops.map((l) => `M${l.map(([x, y]) => `${f(x + dx)} ${f(y + dy)}`).join('L')}Z`).join('');
  const fills = pieces.flatMap((p) => (faces[p.from] ?? []).map((g) => `<path d="${path(g.loops, p.shift)}" fill="${shade(g.stretch)}" fill-rule="evenodd"/>`));
  const lines = (kind: 'cut' | 'mark' | 'key') => pieces.flatMap((p) => p.cuts.filter((c) => (c.key ? 'key' : c.mark ? 'mark' : 'cut') === kind).map(svgShape)).join('');
  const labels = pieces.flatMap((p) => [p.label, ...p.notes]).map((l) => `<text x="${f(l.at[0])}" y="${f(l.at[1])}" font-size="${f(l.size)}" font-family="sans-serif" fill="#333">${xml(l.text)}</text>`);
  const [x0, y0, x1, y1] = boxOf(pieces.flatMap((p) => p.cuts), pieces.flatMap((p) => [p.label, ...p.notes]));
  const m = Math.max(x1 - x0, y1 - y0) * 0.02;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0 - m)} ${f(y0 - m)} ${f(x1 - x0 + 2 * m)} ${f(y1 - y0 + 2 * m)}">${fills.join('')}<g fill="none" stroke="#b42318" stroke-width="1">${lines('cut')}</g><g fill="none" stroke="#16a34a" stroke-width="1" stroke-dasharray="4 3">${lines('mark')}</g><g fill="none" stroke="#333" stroke-width="1">${lines('key')}</g>${labels.join('')}</svg>`;
}

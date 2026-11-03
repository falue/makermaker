/**
 * Where the main view and the extra views lie, as parts of the area: two columns, the main view first on the left.
 * `x`: the border between the columns; `rows`: per number of panes in a column the borders between them, so that two
 * columns of the same height stay one grid.
 */
export interface ViewLayout {
  x: number;
  rows: Record<number, number[]>;
}
export type Pane = { x: number; y: number; w: number; h: number };
/** A border to drag: between the columns, or number `i` of the `k` - 1 in a column of `k` panes (there, at `from`..`to` across). */
export type ViewBorder = { kind: 'column'; at: number } | { kind: 'row'; k: number; i: number; at: number; from: number; to: number };

export const newViewLayout = (): ViewLayout => ({ x: 0.5, rows: {} });

/** How many panes each column holds: from four panes on the left column has two (four panes: a 2 × 2 grid). */
const counts = (n: number): [number, number] => (n < 2 ? [n, 0] : n < 4 ? [1, n - 1] : [2, n - 2]);

/** A column's borders from the layout, evenly spaced if it has none that fit. */
function rowsOf(l: ViewLayout, k: number) {
  const saved = l.rows[k];
  return saved?.length === k - 1 ? saved : Array.from({ length: k - 1 }, (_, i) => (i + 1) / k);
}

/** The `n` panes (the main view first). */
export function panes(n: number, l: ViewLayout): Pane[] {
  const [left, right] = counts(n);
  const column = (k: number, x: number, w: number) => {
    const edges = [0, ...rowsOf(l, k), 1];
    return Array.from({ length: k }, (_, i) => ({ x, y: edges[i], w, h: edges[i + 1] - edges[i] }));
  };
  return right ? [...column(left, 0, l.x), ...column(right, l.x, 1 - l.x)] : column(left, 0, 1);
}

export function borders(n: number, l: ViewLayout): ViewBorder[] {
  const [left, right] = counts(n);
  if (!right) return [];
  const column = (k: number, from: number, to: number): ViewBorder[] => rowsOf(l, k).map((at, i) => ({ kind: 'row', k, i, at, from, to }));
  return [{ kind: 'column', at: l.x }, ...column(left, 0, l.x), ...column(right, l.x, 1)];
}

/** The layout with `b` dragged to `at` (0..1), kept at least `gap` from what lies beside it. */
export function dragged(l: ViewLayout, b: ViewBorder, at: number, gap = 0.1): ViewLayout {
  if (b.kind === 'column') return { ...l, x: Math.min(1 - gap, Math.max(gap, at)) };
  const rows = [...rowsOf(l, b.k)];
  rows[b.i] = Math.min((rows[b.i + 1] ?? 1) - gap, Math.max((rows[b.i - 1] ?? 0) + gap, at));
  return { ...l, rows: { ...l.rows, [b.k]: rows } };
}

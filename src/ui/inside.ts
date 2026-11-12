/**
 * Puts a floating label or field at `x`, `y` and keeps it wholly inside `bounds` (left, top, right, bottom; default:
 * its positioned parent): `centred` on the point (size labels), else hanging from it. Out of the way of `avoid` (the
 * view's own controls, say): moved the shortest way off each one it covers, if it still fits. Call it once `el` is in
 * the page.
 */
export function keepInside(el: HTMLElement, x: number, y: number, centred = true, bounds?: [number, number, number, number], margin = 4, avoid: Element[] = []) {
  const parent = el.offsetParent as HTMLElement | null;
  const [l, t, r, b] = bounds ?? [0, 0, parent?.clientWidth ?? innerWidth, parent?.clientHeight ?? innerHeight];
  const [w, h] = [el.offsetWidth, el.offsetHeight];
  const [dx, dy] = centred ? [w / 2, h / 2] : [0, 0];
  // its box's top left corner
  let [L, T] = [Math.max(l + margin, Math.min(x - dx, r - w - margin)), Math.max(t + margin, Math.min(y - dy, b - h - margin))];
  const at = (parent ?? document.body).getBoundingClientRect();
  for (const o of avoid) {
    const q = o.getBoundingClientRect();
    const [ql, qt, qr, qb] = [q.left - at.left - margin, q.top - at.top - margin, q.right - at.left + margin, q.bottom - at.top + margin];
    if (!(L < qr && L + w > ql && T < qb && T + h > qt)) continue;
    const moves = ([[ql - w - L, 0], [qr - L, 0], [0, qt - h - T], [0, qb - T]] as const).filter(([mx, my]) => L + mx >= l && L + mx + w <= r && T + my >= t && T + my + h <= b);
    const best = moves.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]))[0];
    if (best) [L, T] = [L + best[0], T + best[1]];
  }
  el.style.left = `${L + dx}px`;
  el.style.top = `${T + dy}px`;
}

/**
 * Puts a floating label or field at `x`, `y` and keeps it wholly inside `bounds` (left, top, right, bottom; default:
 * its positioned parent): `centred` on the point (size labels), else hanging from it. Call it once `el` is in the page.
 */
export function keepInside(el: HTMLElement, x: number, y: number, centred = true, bounds?: [number, number, number, number], margin = 4) {
  const parent = el.offsetParent as HTMLElement | null;
  const [l, t, r, b] = bounds ?? [0, 0, parent?.clientWidth ?? innerWidth, parent?.clientHeight ?? innerHeight];
  const [w, h] = [el.offsetWidth, el.offsetHeight];
  const [dx, dy] = centred ? [w / 2, h / 2] : [0, 0];
  el.style.left = `${Math.max(l + dx + margin, Math.min(x, r - w + dx - margin))}px`;
  el.style.top = `${Math.max(t + dy + margin, Math.min(y, b - h + dy - margin))}px`;
}

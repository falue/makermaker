/**
 * Text as HTML with every standalone X, Y and Z (also in XY, XZ, ...; not in shortcuts such as ⌘Z, nor parameters) in its axis
 * colour, as on the origin and the move gizmo. The text must not contain HTML.
 */
export const axisHtml = (text: string) =>
  text.replace(/(?<![⌘⇧$\w])([XYZ]{1,3})(?![\w])/g, (letters) => [...letters].map((l) => `<span class="axis-${l.toLowerCase()}">${l}</span>`).join(''));

/** A size name L, W or H (along X, Y, Z) as HTML in that axis' colour; other text as `axisHtml`. */
export const sizeHtml = (text: string) => {
  const k = 'LWH'.indexOf(text);
  return text.length === 1 && k >= 0 ? `<span class="axis-${'xyz'[k]}">${text}</span>` : axisHtml(text);
};

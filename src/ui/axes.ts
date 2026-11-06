/**
 * Text as HTML with every standalone X, Y and Z (also in XY, XZ, ...; not in shortcuts such as ⌘Z, nor parameters) in its axis
 * colour, as on the origin and the move gizmo. The text must not contain HTML.
 */
export const axisHtml = (text: string) =>
  text.replace(/(?<![⌘⇧$\w])([XYZ]{1,3})(?![\w])/g, (letters) => [...letters].map((l) => `<span class="axis-${l.toLowerCase()}">${l}</span>`).join(''));

/**
 * Text as `axisHtml`, a size name L, W or H (the length, width and height, as X, Y, Z) in that axis' colour: the whole
 * text, or (`within`) each one standing alone before a space or ▸ ("L 20   W▸10"). The text must not contain HTML.
 */
export const sizeHtml = (text: string, within = false) =>
  axisHtml(text).replace(within ? /(?<=^|\s)([LWH])(?=[\s▸])/g : /^([LWH])$/, (l) => `<span class="axis-${'xyz'['LWH'.indexOf(l)]}">${l}</span>`);

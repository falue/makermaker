# MAKERMAKER

Browser CAD for workshop fabrication. Goals and decisions: [GOAL.md](GOAL.md).

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests incl. geometry kernel in Node
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ (service worker active, works offline after first load)
```

Chromium-based browsers only.

## Layout

- `src/doc` – document model (plain immutable data), expressions with units, undo history
- `src/kernel` – Replicad/OpenCascade build of parts, runs in a Web Worker
- `src/viewer` – three.js viewport
- `src/ui` – panels
- `src/io` – `.mmk` design file (ZIP: `document.json` + `history/`), file access
- `public/sw.js` – offline cache

## Status

- Parts are recipes of extrude steps: each has a sketch plane (ground / front / right plane with offset, or the top face of an earlier step), one or more profiles (rectangle with corner radius, circle, polygon), a depth and add / cut (cut: blind or through). Fillets/chamfers are the final layer.
- Sketch (S): pick a face or empty space (base plane facing the camera); the camera turns to the plane with a grid; draw any number of rectangles, circles and polygons (R / C / P switch, Esc selects, Del removes; snaps to corners, centres and the origin); Enter pulls them all; shapes inside shapes are holes (even-odd). ✎ on an extrude step reopens its sketch.
- Drawing (R / C / P): on the top face under the pointer (adds to that part; pulling into it cuts) or on the base plane facing the camera (new part). Drag or click twice; Alt from the centre, Shift square, Ctrl snaps; type sizes and depth (expressions stay live); then pull with the mouse, click or Enter.
- Fillets/chamfers select edges by rule (all/top/bottom/vertical) and survive dimension changes; failures name the step and keep the last valid geometry.
- Every numeric field accepts numbers, units (`3in`) and expressions with parameters (`2*ply + 10`); display units switch without changing geometry.
- Save in place (File System Access), open, drag & drop, undo/redo, offline startup; v1 files migrate to v2.
- Viewport and editing follow incase: view cube, per-view Ortho/Persp and Fit, drag a part to move it along X / Y / Z picked by the drag direction like a weapon wheel (shown at the press point; leave the dead zone ring to pick, go back through it to change; type a distance, Enter keeps, Esc undoes; Alt: free in the base plane facing the camera; Ctrl snaps 5 mm), cube drag with locked hidden pointer, Shift-click multi-select, Tab through parts under the click, arrows nudge (Shift ×10), Del, ⌘D duplicate, Esc, drag a field or its label to scrub.
- Section viewer (from incase, plus Z): two-handle range per axis, invert, reset / double-click, hatched caps on cut faces; clicking a cut face picks its part. Custom sections (saved in the file): + Section, click a face; the plane runs parallel to it through the middle of its part, removing the side towards the camera; name, on/off, offset, flip, delete.
- Autosave toggle: writes into the open file a moment after each change (Chromium; no history snapshot, ⌘S adds one).
- Icons and toolbar in incase's style.
- Not yet: sketches on side faces, face edits, editing profiles by dragging, instances, groups, quad view, imports/exports.

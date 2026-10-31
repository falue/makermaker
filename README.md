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

## Stage 0 status

- Parts are recipes: base extrusion (rectangle with corner radius, or circle) → through-holes → fillets/chamfers as final layer.
- Fillets/chamfers select edges by rule (all/top/bottom/vertical) and survive base dimension changes; failures name the step and keep the last valid geometry.
- Every numeric field accepts numbers, units (`3in`) and expressions with parameters (`2*ply + 10`); display units switch without changing geometry.
- Save in place (File System Access), open, drag & drop, undo/redo, offline startup.
- Viewport and editing follow incase: view cube (sides switch to orthographic, corners, drag to orbit, turn arrows), Ortho/Persp, F fit, drag parts to move (Ctrl snaps 5 mm; horizontal plane, screen plane in side views), Shift-click multi-select, Tab through parts under the click, arrows nudge (Shift ×10), Del, ⌘D duplicate, Esc, drag a field label to scrub.
- Not yet: face edits, sketches on faces, instances, groups, quad view, imports/exports.

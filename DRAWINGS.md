# Drawings: plan

Not built yet. Technical drawings of the design: sheets of paper with views of the parts at chosen scales, exported as clean vector PDF or SVG.

## What it does

- A new **Drawings** workspace beside the 3D view. It holds any number of sheets, kept in the `.mmk` file.
- **A sheet** has a paper size (A4 to A0, Letter, Tabloid, custom), portrait or landscape, and a title block.
- **Title block**: one simple preset, with fields for title, part number, drawn by, date, material, sheet n of m and the main scale. Most are filled in automatically. Blocks can be switched off.
- **Views** are placed on a sheet. Each has its own **scale** (1:1, 1:2, 2:1 or typed), so several scales fit on one page. Each view shows chosen bodies or a group from a direction: front, back, left, right, top, bottom, angled, or the current 3D view.
- **Views stay live**: when the model changes, the views update. Hand-added lines and notes stay where they are.
- **Editing on the sheet** works like the sketch tools, with the same keys and handles:
  - Move, resize (changes the view's scale) and rotate views.
  - Draw lines, rectangles, circles and text on the paper.
  - Snap to view corners, edges and other sheet items.
- **Multipage**: a sheet list with add, duplicate, reorder and delete. A PDF holds all sheets, SVG gives one file per sheet (several as one zip).

## How it works

- **Projection**: replicad already has `drawProjection` / `makeProjectedEdges` (OpenCascade's hidden line removal), which return exact visible and hidden edges, curves included, as vectors. It runs in the existing kernel worker, one view at a time, and results are cached by the body's recipe and the direction, so a sheet stays fast (see the 50-60 fps goal).
- **Sheet display**: an SVG element in the page, not WebGL. Paper millimetres are the coordinates; zoom and pan change only the viewBox. Line weights stay true on paper.
- **Document**: `doc.drawings: Sheet[]`, plain data like everything else, one schema step up.
  ```
  Sheet { id, name, paper, orientation, titleBlock: {...} | null, views: View[], items: Item[] }
  View  { id, bodies: string[], direction, scale: Expr, at: [x, y], turn: Expr, hidden: boolean }
  Item  { line | rect | circle | text, in paper mm, a view's id if it moves with that view }
  ```
  Scales take formulas like other fields.
- **Commands**: each step gets a command in `src/api/commands.ts` (`sheet`, `view`, …), so Python can build sheets too. That fits with `cad.measure` and `cad.snapshot`.
- **SVG export**: the sheet as it is shown, in real millimetres, `<path>` for all geometry.
- **PDF export**: a small writer of our own, no new dependency. PDF's page format for lines and curves is simple, arcs and beziers map directly, and its built-in Helvetica covers text in Western languages. If fonts or other scripts are wanted later, a library would be a separate decision.

Line styles follow ISO 128: thick for visible edges, thin dashed for hidden, thin chain for centre lines.

## Steps

Each step is usable on its own.

1. **Sheets and paper**: workspace, sheet list, paper sizes, title block, SVG export of the empty sheet. (small)
2. **Views**: place a view of a selection from a direction with a scale; projection in the worker with caching; move, resize, rotate; hidden lines on or off. (large, the core)
3. **PDF export**: one file, all sheets, true scale when printed at 100 %. (small)
4. **Drawing on the sheet**: lines, shapes, text, snapping to views. (medium)
5. **Dimensions on the sheet**: pick two points or an edge, the real size is read from the model and follows it. Waits for Dimensions and constraints only if they should share a look; it can be built first. (medium)
6. **Later**: section views, detail views (a circled area at a larger scale), centre lines, hole callouts, parts list.

## Open questions

1. The request's sentence ended at "move and drawing lines and resizing and rotating should …". This plan assumes it meant: they work on the sheet just as they do in a sketch. Is that right?
2. Should resizing a view always change its scale? This plan says yes, and a scale can also be typed.
3. Only one title block preset for now, with your own name or logo as a setting?
4. Should dimensions (step 5) come in the first usable version? A drawing without sizes is of limited use, so this plan would do steps 1 to 3, then 5, then 4.

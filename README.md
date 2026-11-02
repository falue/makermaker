# MAKERMAKER

Browser CAD for workshop fabrication. Goals and decisions: [GOAL.md](GOAL.md); terms: [CAD_DEFINITIONS.md](CAD_DEFINITIONS.md).

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
- `src/kernel` – Replicad/OpenCascade build of bodies, runs in a Web Worker
- `src/viewer` – three.js viewport
- `src/ui` – panels
- `src/io` – `.mmk` design file (ZIP: `document.json` + `history/`), file access
- `public/sw.js` – offline cache

## Status

- Bodies are recipes of extrude steps: each has a sketch plane (ground / front / right plane with offset, or the top face of an earlier step), one or more profiles (rectangle with corner radius, circle, polygon), a depth and add / cut (cut: blind or through). Features run in order, except fillets/chamfers: unbaked they run last, so they also round or chamfer edges of later cuts (their edges draw light grey). Bake (button on the card) keeps one where it is: later cuts go through it (hatched card, dark edges). Click a fillet/chamfer face to pick that part (double-click: the whole finish); Del leaves that edge out (Restore on the card brings it back) or deletes the whole finish.
- Sketch mode: New sketch (S or the toolbar's first tool) picks a top face or empty space, turns the camera to it and shows a grid; leaving the first pull of a direct shape flat (click or Esc) also enters it; Draw on a selected sketch reopens it. In sketch mode R / C / P draw flat into the sketch and the tool goes on; Esc stops the tool, Esc again or ✓ leaves. E in sketch mode shows the sketch's areas (overlapping shapes split into pieces, computed exactly by the kernel): click areas to pick them (double-click: everything inside the smallest shape there, overlaps and shapes inside it included), clicking a sketch in the list picks all of its areas; once something is picked a note at the pointer says to hit Enter; Enter or E pulls them into one extrusion linked to those areas (stored as inside / outside shapes, so they follow shape edits).
- Direct tools: R rectangle, C circle (cylinder), N regular polygon (diameter, Tab: number of sides; the first corner points at the pointer), P polygon (Esc leaves it open), L line (a single line, two clicks; Ctrl-click: the next line from where the last one ended; lines are never extruded), O sphere (drag from its centre on a face or the ground). Shapes keep their meaning (a hexagon stays a regular polygon with 6 sides). Drawing tools and Extrude stay on after each shape or pull until Esc; one-shot actions (look at face and the like) end by themselves.
- Bodies have a colour (picker in the body panel, swatch in the list; new bodies get one from a palette) and an eye to show / hide them like sketches; hidden bodies are still built but not drawn, picked or snapped to. Selected bodies glow.
- Snapping while drawing: corners and line ends, centres, the middles of sides and straight edges, circle quadrants, crossings of sketch lines, circles and body edges, then along lines and edges (Ctrl: the grid); only geometry in the plane drawn on. A note next to the pointer says what it snaps to; the shape, line or edges it belongs to light up.
- Renaming: click a name in the object or sketch list to edit it in place (Enter or clicking away saves, Esc keeps the old name).
- Construction lines: any shape can be switched to a construction line and back (the Construction checkbox on its row in the sketch panel, or Q with it selected): drawn dashed, snapped to, never extruded (linked extrusions drop them). The next shapes are drawn as the last one switched (Q alone toggles it); construction shapes stay flat, no pull.
- Push / pull faces: click a face made by an extrusion, then E (or E, then click the face): the face follows the mouse; Esc puts it back. An end face changes the extrusion's depth; a side face moves that side of its shape (a rectangle side alone, circles and regular polygons grow evenly, polygon sides move both corners), in the linked sketch if there is one. Faces cut by a tool body move that tool body's shape. Expressions stay: `ply` → `ply + 6`.
- Boolean tool (toolbar flyout, or the panel with two or more bodies selected): join, cut or intersect; the first selected body keeps the result, the others become its tool bodies: owned by it (they move with it and are deleted with it; deleting a tool body removes its boolean), still editable (moving or editing them updates the result). Cutters show as red outlines without fill, join / intersect tools hide; removing the boolean (×) makes the tool body a body of its own again. Faces never depend on booleans, so a cutter drawn on the target's face works; real cycles are reported.
- Shape fields work like Illustrator's transform panel: each shape has its own 3×3 reference point grid (left of its X / Y) that picks which point of its box X / Y give (centre: the stored expressions; else measured numbers), and that point stays put when W / H / Ø or the turn change; its link button makes W and H change together. The reference point shows on the shape as a blue mark (selected shapes, and shapes not measured from their centre) with an arrow in the direction the shape grows. Clicking within 8 px of a sketch outline (or of a circle's centre dot) picks that shape. Values keep their expressions where they can (`a` moved by 5 becomes `a + 5`).
- Tools work both ways: tool first, then the object or face (a drag meanwhile turns the view, only a click picks), or the object or face first, then the tool. Boolean with fewer than two bodies selected: click bodies (the first keeps the result), Enter applies; Delete / Duplicate with nothing selected take the body clicked next. The active tool is highlighted in the toolbar.
- Selected bodies get thick cyan edges; their colour stays.
- Sketches go on any flat face: an extrusion's end face or straight side face (the sketch follows that face when the body changes), else a fixed plane where the face was. New sketch (S) with a face clicked on a selected body uses that face right away.
- A sketch on a base plane moves with the body that extrudes it (that body's extrusion lies in its coordinates).
- Object list: groups and bodies only; sketches have their own list below (with the body each belongs to). A body with a sketch (one it extrudes, or one on its face) gets a sketch button in its row that selects that sketch. In sketch mode with shapes selected, the right column shows only those shapes.
- Groups: the object list shows groups first, then bodies, per level; ▾/▸ folds a group; drag rows (with the rest of the selection): the upper or lower half of a row puts them before or after it (into its group; this also reorders the list), the middle of a group row into the group, the Objects header to the top level; any depth. The group tool (toolbar, as in incase) groups the selection (⌘G; nothing selected: click objects, Enter) or, with a group selected, ungroups it (⇧⌘G): its contents move to its parent and stay where they are. A group's eye hides its contents without touching their own eyes. Its panel (⚙ or select it): name, delete (with its contents), origin: the parent's, or a custom point and turn (degrees around X, then Y, then Z) its contents count from: changing it moves and turns them all, while inside the group they are edited unturned; booleans, face pulls, sketches on faces, snapping and sections follow the turn. Moving objects between groups keeps them in place (their own turn stays as it was, so a body moved into a turned group turns with it).
- Import (proof of concept; arrow button in the top bar, or drop a file): an OBJ mesh becomes a body that stays a mesh (parsed with three's OBJLoader, y up turned to z up, stored in the document as a mesh feature with a scale; OBJ has no unit, so 1 counts as 1 mm, but something under 10 mm is scaled to about 100 mm). It moves, groups, colours and renders like any body; booleans, face pulls and exports do not work on meshes yet.
- Export for 3D print (printer button, top right): one binary STL per selected body (groups count as their bodies; nothing selected: all shown bodies), as placed in the world; several come as one ZIP. Tool bodies are left out (their cuts and joins are in their owners). A proof of the workflow: no print checks yet.
- Export for the laser (laser button, top right; proof of concept): one SVG per selected body (else all shown bodies; tool bodies left out), the outline and holes of its biggest flat face at 1:1 in mm, built without fillets and chamfers, red hairlines; several come as one ZIP.
- Settings (gear, right of the MAKERMAKER title; chapters on the left, their settings on the right): General: the document's units (saved in its file). 3D view (saved per browser): ambient occlusion (three's GTAO pass, sized for mm; snapshots get it too; while a section cuts, it reads the cut view's own depth and normals, cut faces included). Background of the 3D view and new renders, around the horizon (looking down shows the lower colour, looking up the upper, level the blend; ortho views as a perspective camera would see it): solid (the theme grey), two colours meeting sharply at the horizon, or one of 8 sky presets (every third hour of the "sky gradients" CodePen by billyysea, blended over ±25°).
- View: the wheel zooms towards the pointer; Grid and Origin switches (top left) show or hide the ground grid and the origin (thick, drawn over everything; the move gizmo uses its colours); Fit sits next to look-at-face under the view cube; the half-moon button switches light / dark. Sphere centres show a dot and snap like corners.
- Renders (one pipeline for snapshots and nice renders; the list sits in the right column, opened with the camera-with-star button; clicking something in the 3D view, the list or a group's ⚙ closes it):
  - Snapshot (camera button): downloads `<file>_snapshot.png` at once (transparent background, twice the screen resolution, without grid, origin, sketches, cutters or selection) and keeps it in the list without opening it; Render nice on it renders that view nicely.
  - Render this view: a small picture at once, then the real render queued (three-gpu-pathtracer, 256 passes, soft sky light); renders run one after another, slower while the list is closed (a status row then sits on top of the right column), the picture growing live.
  - Each render keeps its camera (position, target, ortho / persp, zoom, size) and background (from the settings when made; its colours above and below the horizon can be changed for the next render of that view). The picture is traced on a transparent background and laid over the same horizon gradient as the 3D view (from its camera's tilt); a solid background also gets a floor of its colour for the shadows.
  - Render again re-renders the same view with the model as it is now and saves the picture by itself; Use view turns the 3D view to it; Download saves `<file>_render_<n>.png`; × deletes. Full pictures stay until the page reloads; small copies of each result are saved in the file (up to 8 per view, older ones below the newest).
- Rotation: the body panel has Rotation X° / Y° / Z° (degrees around X, then Y, then Z of its group); sketches it extrudes, booleans, face pulls and snapping follow the turn. Document schema 10.
- Shortcuts: every keyboard action lives in one table (`src/ui/keys.ts`: name, order, default keys, hint), used by the app's key handler and by the tools (confirm, cancel, other side, erase); Settings → Hotkeys lists it as it is; a keyboard mapper can edit it later. Typed values and the drag modifiers are not in it yet.
- Isolate: Ctrl-click (or right-click) a body's eye to show only that body (its cutters stay); its eye turns into a framed eye and all other rows grey out (their eyes still show or hide them); clicking the framed eye again in any way shows what was shown before.
- Pulling always makes a new body, also when drawn on another body's face (joining is a boolean, later); its sketch stays attached to that face, so the new body follows it.
- Sketches are objects (left list, eye to show/hide): shapes on a base plane or a body's face. R / C / P draw into the sketch under the pointer, the top face under it (that face's sketch), the selected sketch, or the base plane facing the camera; then pull right away (the pointer is hidden and locked, so pulling has no end; movement counts along the extrusion direction on screen), or click without pulling / Esc to keep the shape flat. E pulls the selected shapes (or the whole selected sketch). Extrusions stay linked to their sketch shapes (the broken-chain icon unlinks: copies the shapes into the step); shapes inside shapes are holes (even-odd). Ctrl snaps; the pointer snaps to corners and centres of all visible sketches and to body corners (big squircle), else to the nearest line: sketch outlines and body edges (the hit line lights up, small squircle), all projected onto the drawing plane; typed sizes and depth stay expressions. Selected shapes: drag to move in the sketch plane (axis wheel limited to the plane's two axes); a single shape gets incase-style handles (Alt from the middle, Shift proportional, Ctrl snaps, type a size, Tab other side) and a round handle to turn it (Shift 15°); only changed values are written, others keep their expressions. Two or more selected shapes: align left / centre / right / top / middle / bottom, distribute (three or more); ⌘D duplicates shapes (keeping expressions), arrows nudge them in their plane, Del deletes them.
- Fillets/chamfers select edges by rule (all/top/bottom/vertical) and survive dimension changes; failures name the step and keep the last valid geometry.
- Every numeric field accepts numbers, units (`3in`) and expressions with parameters (`2*ply + 10`); display units switch without changing geometry.
- Save in place (File System Access), open, drag & drop, undo/redo, offline startup; v1 files migrate to v2.
- Tools survive camera moves: labels and markers follow orbit, cube, Look at and Fit; while a tool runs, right-drag turns the view and middle-drag pans.
- Look at a face: the button under the view cube, then click a face; the camera looks straight at it (orthographic).
- Viewport and editing follow incase: view cube, per-view Ortho/Persp and Fit, drag a body to move it along X / Y / Z picked by the drag direction like a weapon wheel (shown at the press point; leave the dead zone ring to pick, go back through it to change; type a distance, Enter keeps, Esc undoes; Alt: free in the base plane facing the camera; Ctrl snaps 5 mm), cube drag with locked hidden pointer, Shift- or ⌘/Ctrl-click toggles bodies and shapes in the view (in the lists ⌘/Ctrl-click toggles, Shift-click selects a range), Tab through bodies under the click, arrows nudge (Shift ×10), Del, ⌘D duplicate, Esc, drag a field or its label to scrub.
- Section viewer (from incase, plus Z): two-handle range per axis (cuts are fixed world positions: adding or moving bodies widens the sliders' range, the handles follow, the cut stays), invert, reset / double-click, hatched caps on cut faces; clicking a cut face picks its body. Custom sections (saved in the file): + Section (the button then reads "Click any face or plane"), click a face (hovered faces light up) or empty space for the base plane facing you; the plane lies on it (offset 0), removing the side towards the camera; name, on/off, offset, flip, delete.
- Autosave toggle: writes into the open file a moment after each change (Chromium; no history snapshot, ⌘S adds one).
- Icons and toolbar in incase's style.

## Planned, not built yet

Collected from [GOAL.md](GOAL.md) and the design talks; roughly in the order they were asked for.

- **Rebindable hotkeys**: every shortcut and modifier role (Ctrl snaps, Alt from the centre, ...) set by the user.
- **Undo history list**: ⌘Z twice shows the latest steps; drag a line through the log to move in history.
- **Render quality target**: renders stop at a chosen quality (say 80 %) and save the picture; raising it to 100 % continues the render (or renders again, whichever the path tracer allows).
- **Photo sphere backgrounds** for the 3D view and renders, next to solid and gradient.
- **Nicer renders**: materials and lighting choices for the path traced render, Mitsuba 3 through a local helper (deferred); screenshot turntable and dolly clips.
- **Laser export, properly**: picking which face or profile to cut (now: the biggest flat face), DXF, kerf, nesting several parts on one sheet (the rules for which faces qualify are still open).
- **3D print export, properly**: print checks (closed, manifold, scale) and 3MF next to the current STL proof.
- **Imports**: STEP, STL / 3MF / GLB as mesh bodies (OBJ works as a proof of concept), SVG / DXF into sketches; meshes in booleans and exports.
- **Materials**: name, sheet thickness and look; groups give defaults; thickness mismatches shown.
- **Joints**: fixed, hinge and slider between bodies or groups.
- **Duplicates**: linked copies (shared design, own placement) next to independent ones.
- **Cutters, further**: one cutter cutting several bodies, an editing mode that reveals hidden cutters, a note when a cutter removes nothing.
- **Edge references**: fillets on clicked edges (now: rules plus left-out edges), robust after edits.
- **Face edits**: moving faces that no extrusion made (fillet, boolean and sphere faces).
- **Sketching**: lines and arcs, dimensions, constraints if needed.
- **Drawings**: paper sheets with scaled views, dimensions, sections, PDF export.
- **Quad view**: four editable views at once.
- **incase**: the sibling project ../incase should be included here.
- **Rotating in the 3D view** as in incase.
- **Render camera**: change the field of view for renders, set it as real-life camera focal length in mm, and a default field of view in the settings.
- **Threads**: holes and cylinders defined as threads with real thread geometry, metric and inch (UNC / UNF); special geometry that is always modelled, built so that e.g. the top edge of a threaded hole or cylinder can still be chamfered.
- **Mesh to CAD model**: a button that turns a mesh into a CAD model, like [this video](https://youtu.be/meBi616y1mg) shows ([ScanRuler](https://github.com/CNCKitchen/ScanRuler) by CNC Kitchen).
- **Central CAD command API**: every modeling action (create, edit, select bodies, sketches, features, materials, transforms, booleans, bevels, holes, ...) through one TypeScript API used by the GUI and scripting, independent of the UI and kernel where possible.
- **LLM control**: an API through which an LLM can control everything.
- **Python scripting**: an in-browser editor (Monaco + Pyodide) with the command API as a Python module (`cad.box(...)`, `cad.move(...)`, `cad.bevel(...)`, the selection), Run, console, errors, autocomplete, offline caching.
- **Desktop wrapper** (Tauri / Electron) with native file access.

### Design notes

- Shift does the opposite of a tool where that makes sense.
- Editing 2D and 3D objects uses the same tools wherever possible (booleans work on both, for example). There is no special sketch mode: sketches can be drawn at any time. Sketch objects are then grouped like 3D objects: plain groups of sketch objects instead of a separate sketch container. How they get grouped automatically is still to be decided.

# MAKERMAKER: status and technical notes

What is built, how, and what is planned. For users: [README.md](README.md). Goals and decisions: [GOAL.md](GOAL.md); terms: [CAD_DEFINITIONS.md](CAD_DEFINITIONS.md).

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

- Bodies are recipes of extrude steps: each has a sketch plane (ground / front / right plane with offset, or the top face of an earlier step), one or more profiles (rectangle with corner radius, circle, regular polygon, polygon) or picked areas, a depth, how far it also reaches behind its plane (back) and add / cut (cut: blind or through). Features run in order, except fillets/chamfers: unbaked they run last, so they also round or chamfer edges of later cuts (their edges draw light grey). Bake (button on the card) keeps one where it is: later cuts go through it (hatched card, dark edges). Click a fillet/chamfer face to pick that part (double-click: the whole finish); Del leaves that edge out (Restore on the card brings it back) or deletes the whole finish.
- Sketch mode: New sketch (S or the toolbar's first tool) picks a top face or empty space, turns the camera to it and shows a grid; leaving the first pull of a direct shape flat (click or Esc) also enters it; Draw on a selected sketch reopens it. In sketch mode R / C / P draw flat into the sketch and the tool goes on; Esc stops the tool, Esc again or ✓ leaves. E in sketch mode shows the sketch's areas (overlapping shapes split into pieces, computed exactly by the kernel; where lines take part, the faces they enclose with the shapes they reach: ends sticking out are ignored, a line across splits a face, curves there become fine polylines, see `src/doc/arrangement.ts`): click areas to pick them (double-click: everything inside the smallest shape there, overlaps and shapes inside it included), clicking a sketch in the list picks all of its areas; once something is picked a note at the pointer says to hit Enter; Enter or E pulls them into one extrusion linked to those areas (stored as inside / outside shapes, or for line faces as a point inside, so they follow shape edits). E on a sketch with lines (not in sketch mode) opens it with all its areas picked.
- Direct tools: R rectangle, C circle (cylinder), N regular polygon (diameter, Tab: number of sides; the first corner points at the pointer), P polygon (Esc leaves it open), L line (a single line, two clicks; hold ⌘ (else Ctrl) after one: the next from its end; a line extrudes only as the edge of a face lines enclose), O sphere (drag from its centre on a face or the ground). Shapes keep their meaning (a hexagon stays a regular polygon with 6 sides). Drawing tools and Extrude stay on after each shape or pull until Esc; one-shot actions (look at face and the like) end by themselves.
- Bodies have a colour (picker in the body panel, swatch in the list; new bodies get one from a palette) and an eye to show / hide them like sketches (Shift-click another eye in the same list: every row between, both included, goes the way the first click went; in sketch mode the same for see-through / fully shown); hidden bodies are still built but not drawn, picked or snapped to.
- Snapping while drawing: corners and line ends, centres, the middles of sides and straight edges, circle quadrants, crossings of sketch lines, circles and body edges, then along lines and edges, else on the zoom's step; only geometry in the plane drawn on. A sketch takes the pointer when it is over one of its shapes or near an outline; empty space draws on the ground unless it is seen almost edge-on. A note next to the pointer says what it snaps to (along a side with the lengths on both sides); the shape, line or edges it belongs to light up. With the pointer on a line, A adds an evenly spaced snap point along it (around a circle: one more than the 4 quadrants), Shift A removes one; while changing, all its points show.
- Lines that close a loop (the new line's ends meet other lines' ends, within 0.001 mm, either way round) become one polygon, which extrudes like any shape.
- Line tool: holding ⌘ (else Ctrl) after a line starts the next one at its end at once, shown, snapped and typed into like the first (it stays when ⌘ is let go, to type; Esc drops it; ⌘ as part of a shortcut like ⌘Z does not start it); a click still holding ⌘ goes on from the new end.
- The angle counts from the previous line (going straight on is 0°: the next polygon side, a line on from the last with ⌘), else from the plane's x axis; B with the pointer on a straight line, edge or guide counts it from that line instead (again, or off a line: from the x axis); the hint shows on a line.
- Lines and polygon sides are drawn as angle and length from the last corner: the angle turns in 1° steps (Ctrl: the minimum angle, Settings → General, default 0.01°; Shift: the angle step, default 45°, A finer, Shift A coarser, through 90, 45, 30, 15, 10, 5, 1°, set before pressing Shift; rays around the last corner preview its directions), the length on the zoom's step (Ctrl: the minimum step). A snap point or line sets the end exactly (with Shift, or a typed angle, its distance along that angle). The pointer's note shows the length (L) first; the angle (∠) is labelled inside the angle, between a faint ray along the plane's x axis and the side with an arc between them, as close as it stays clear of the other labels, the lines, the pointer and its note and the view's controls, else just outside the angle: typing a digit starts the length, Tab switches to the angle, a typed value stays while the pointer sets the other, click or Enter sets the corner.
- Modifiers, one meaning each (`MODS` in src/ui/keys.ts, listed in Settings → Hotkeys). At a click: Shift adds to the selection or takes away (lists: a range), ⌘ (else Ctrl) adds one in lists, isolates on an eye and goes on with the line tool, Alt picks faces and edges. While moving (drags, handles, pulls, scrubbing a field, arrow keys): no key moves in steps that follow the zoom (a power law rounded to 1-2-5: about 1 mm at a normal zoom, 0.5 m with 20 m across the view; arrows 1 mm), Shift constrains (square, proportions, 15° turns) and takes ten times bigger steps, Ctrl moves in the minimum step (Settings → General, default 0.01 mm; turns 0.1°), Alt draws and resizes from the centre; they combine. Turns default to 1°.
- Faces and edges: hold Alt to light the edge near the pointer (within 6 px, not behind a face) or else the face under it; Alt-click selects its body and picks that part (Shift + Alt adds more faces or edges of that body, or takes one away; picked parts are blue, the Alt preview orange; choosing in the list starts over) (a face: E pulls it, S sketches on it); a double right-click (or Ctrl double-click) near an edge picks its loop (a plain double-click does not; the double press is counted by the app, as a Mac sends no dblclick for Ctrl- or right-clicks): the edges joined end to end in the plane of the face under the pointer. Picked edges show their length, how many, and Ø when they form one circle.
- Info panel (bottom of the right column): a picked edge's length or face's area; one sketch shape's size or Ø and area (a line: its length), several shapes: their count; bodies: box size as L / W / H (hovering one draws it along the box edge in the view), one body's position (hovering it marks the point) and turn, volume and surface area (from the shown triangles, so curved parts are a hair off; areas and volumes one unit up: mm files show cm² and cm³). On a Mac ⌘ adds to or removes from the selection.
- M (or the move button in the toolbar, beside Extrude and Boolean): the X / Y / Z fields below, all three at once, each starting at 0 (Duplicate: 5, 5, 0 mm; selected: typing replaces it), the cursor in X (Tab to the next).
- While the move fields are open the move gizmo (the axis wheel) sits at the middle of the selection and follows the preview; a press on it starts the same move as grabbing a body (dead zone, the axis by the drag's direction, the zoom's step: Shift ×10, Ctrl the minimum step) and writes the distance into that axis' field; the field's axis is shown strong; Enter moves, Esc cancels.
- X / Y / Z: a field at the pointer takes a distance (expressions and units, `-100` too); X / Y / Z in it add that axis' field (always in X Y Z order) or go back to it, each keeping its value (typed instead in the middle of a name, or where a parameter starting with that letter could begin: Tab completes it); while typing, the selection shows moved and a translucent copy stays where it was; turning the view meanwhile (drag, cube, wheel) keeps the field, and a click in the view does not select; To object (button, or T in a field unless a parameter name starts there): click a corner, edge or face (the point it reaches is marked while aiming, the pointer's note says what it is: corner, centre, 1/2 of an edge, on edge, on face, and the selection already shows moved there; off any object the value from before), the selection moves along the field's axis until its nearest side reaches it; Enter moves by all of them the selection that far along that axis (bodies; shapes within their sketch plane, the selected ones or all of the selected sketch; across its plane the whole sketch, selected shapes or not, shown live with the bodies extruded from it: a base-plane sketch by its offset, one extruded into a body together with that body, a free plane itself, a sketch on a face with no body of its own leaves the face onto a fixed plane; grey ghosts show where they were), Esc cancels.
- Tab / Shift Tab: select the next / previous body under the pointer (while typing a size Tab switches the side).
- Parameter names complete in every value field: the rest of a matching name shows in grey after the cursor, Tab writes it out with a space. A calculation shows its result in grey after the text (`2*ply` → `= 8 mm`; turns in degrees).
- Renaming: click the name of the selected row in the object or sketch list to edit it in place (the first click selects, or enters the sketch) (Enter or clicking away saves, Esc keeps the old name).
- Guide lines: while drawing, hovering a straight line or edge for a moment (Settings → General → Guide delay, default 333 ms) adds an endless dashed guide along it (magenta; an edge off the plane is projected onto it). Resting on a corner, a line end or a centre gives two guides through it, along the plane's X and Y. The top, bottom and sides of circles, round body edges (cylinders) and spheres give one too, along the plane's axes, snapped to like any line, crossings included. One per direction: a parallel line's guide replaces it, other directions add theirs. A click drops them; G on a guide keeps it (thicker) until G again or sketch mode ends.
- Sketch groups (what was "sketches"; schema 11): a sketch group holds shapes on one plane, in nested sub-groups (`groups` on the sketch, `group` on each shape). In sketch mode the rest fades: bodies turn see-through (still hiding each other: their depth is drawn first) and are not picked, their eyes show it and switch a body back to fully shown (and again to see-through), other sketch groups' shapes and shapes outside the open sub-group turn faint. A breadcrumb under Ortho | Persp shows the way down (`Plate outline › Group 1`); clicking a part goes back up there, Esc goes up one level (at the top: leaves). Clicking a shape in a sub-group that is not open picks the whole sub-group; double-clicking a shape opens its sketch group down to its sub-group. ⌘G (or the group tool) puts the selected shapes and whole sub-groups into a new sub-group of the open one; ⇧⌘G dissolves a selected sub-group. The sketch panel lists sub-groups as foldable rows (a row picks all its shapes).
- Construction lines: any shape can be switched to a construction line and back (the Construction checkbox on its row in the sketch panel, or Q with it selected): drawn dashed, snapped to, never extruded (linked extrusions drop them). The next shapes are drawn as the last one switched (Q alone toggles it); construction shapes stay flat, no pull.
- To object in pulls: while extruding (drawn shapes, selected shapes or picked areas) or pulling a face, the pointer's note says that T (before typing a size) reaches an object; T shows the pointer and aims at once: the point a click would reach is marked and named in the note, and the depth already follows it; the click keeps it.
- Push / pull faces: click a face made by an extrusion, then E (or E, then click the face; E, then a sketch in the list pulls all its shapes): the face follows the mouse; Esc puts it back. An end face changes the extrusion's depth; a side face moves that side of its shape (a rectangle side alone, circles and regular polygons grow evenly, polygon sides move both corners), in the linked sketch if there is one. Faces cut by a tool body move that tool body's shape. A face pushed past the opposite one goes on through it: the body then lies beyond that face (an end face: the depth turns negative; a side: the shape flips over to the other side, sizes stay positive). Expressions stay: `ply` → `ply + 6`.
- Boolean tool (toolbar flyout, or the panel with two or more bodies selected): join, cut or intersect; the first selected body keeps the result, the others become its tool bodies: owned by it (they move with it and are deleted with it; deleting a tool body removes its boolean), still editable (moving or editing them updates the result). Tool bodies (cutters, join / intersect tools) stay hidden until selected (in the list, or with on the boolean card); then they show as red edges without fill and a red silhouette outline; tool bodies are listed under their owner, which starts folded and opens with its red boolean icon (where a group has its ⚙, between the sketch button and the eye), and have their op's icon in place of the eye ("Cuts Plate"; they are hidden anyway); clicking it frees them from the boolean. The sample has a test piece: a block with a ball and a cylinder cut out of it and a 20 × 20 × 30 mm polygon joined on its back right corner. removing the boolean (×), or Free from boolean in the tool body's own panel, makes the tool body a normal body again. Faces never depend on booleans, so a cutter drawn on the target's face works; real cycles are reported.
- Shape fields work like Illustrator's transform panel: each shape has its own 3×3 reference point grid (left of its X / Y) that picks which point of its box X / Y give (centre: the stored expressions; else measured numbers), and that point stays put when W / H / Ø or the turn change; its link button makes W and H change together. The reference point (the reference diamond) shows on selected shapes as a blue mark with an arrow in the direction the shape grows; only selected shapes show their fields. Clicking within 8 px of a sketch outline (or of a circle's centre dot) picks that shape. Values keep their expressions where they can (`a` moved by 5 becomes `a + 5`).
- Floating labels and fields (sizes while drawing or pulling, the move label, the move fields, the pointer's note while over the view) never leave the 3D view: they slide back inside at its edges (`keepInside`, src/ui/inside.ts).
- Tools work both ways: tool first, then the object or face (a drag meanwhile turns the view, only a click picks), or the object or face first, then the tool. Extrude with nothing selected: a click inside a closed shape of a sketch, or inside a face its lines enclose (in front of any face), pulls that area at once (on a shape's outline: all inside that shape); hovering lights what a click pulls (the piece, or the shape with its outline) (move, click or type a depth); Shift-click opens the sketch with it picked, more areas to click, then Enter or E pulls them (as the sketch first, then E). Boolean with fewer than two bodies selected: click bodies (the first keeps the result), Enter applies; Delete / Duplicate / V (hide) with nothing selected (toolbar or key) take the body or sketch clicked next; X / Y / Z with nothing selected: a click picks what moves (a body, sketch or group) and opens the field; a sketch picked so is selected, not entered; a shape clicked (in the view, in sketch mode or not) is picked and moves, Shift / ⌘-clicks collect several, then Enter. The active tool is highlighted in the toolbar.
- Selected bodies get a crisp cyan outline (3 px on screen) around their silhouette, through holes too and also when cut by a section (they are drawn into a mask, a ring around it goes over the picture); their colour stays.
- Sketches go on any flat face: an extrusion's end face or straight side face (the sketch follows that face when the body changes), else a fixed plane where the face was. New sketch (S) with a face clicked on a selected body uses that face right away.
- Object list: groups and bodies only; sketches have their own list below (a sketch that belongs to a body has a body button that selects it). A body with a sketch (one it extrudes, or one on its face) gets a sketch button in its row that opens that sketch. In sketch mode with shapes selected, the right column shows only those shapes.
- Groups: the object list shows each level's groups and bodies in their places (`order`; without one groups first, then bodies); the ▸ / ▾ in a group's row, where bodies show their colour, folds it, and so does a plain click on the row (it also selects the group; not the click on its name that starts renaming); drag rows (with the rest of the selection): the upper or lower half of a row puts them before or after it (into its group; this also reorders the list), the middle of a group row into the group, the Objects header to the top level; any depth (moving before or after numbers that level's places anew). The group tool (toolbar, as in incase) groups the selection (⌘G; nothing selected: click objects, Enter) into a group named after the first object picked, in that object's place in the list, or, with a group selected, ungroups it (⇧⌘G): its contents move to its parent and stay where they are. A group's eye hides its contents without touching their own eyes. Its panel (⚙ or select it): name, delete (with its contents), origin: the parent's, or a custom point and turn (degrees around X, then Y, then Z) its contents count from: changing it moves and turns them all, while inside the group they are edited unturned; booleans, face pulls, sketches on faces, snapping and sections follow the turn. Moving objects between groups keeps them in place (their own turn stays as it was, so a body moved into a turned group turns with it).
- Import (arrow button in the top bar, or drop a file): a STEP file (.step / .stp) becomes a real solid body: the kernel reads it (in mm, as the file says; big files take a while, each is read once per session), the file's text is stored in the document; booleans, fillets, sketches on its faces and exports work on it. An STL or OBJ mesh becomes a body that stays a mesh (parsed with three's loaders, stored as a mesh feature with a scale). Neither format has a unit: a small dialog asks for it (mm / cm / m / in) or for its size along X, Y or Z (the others follow, proportional), the body showing at each size as it is set; guessed as cm and z up for Autodesk / Fusion OBJ files, else mm (OBJ turned from y up to z up). Tests check a 50 mm cube from Fusion as STL, OBJ and STEP (`src/io/fixtures`). Meshes move, group, colour and render like any body; booleans, face pulls and exports do not work on them yet.
- Export for 3D print (printer button, top right): one binary STL per selected body (groups count as their bodies; nothing selected: all shown bodies), as placed in the world; several come as one ZIP. Tool bodies are left out (their cuts and joins are in their owners). A proof of the workflow: no print checks yet.
- Export for the laser (laser button, top right; proof of concept): one SVG per selected body (else all shown bodies; tool bodies left out), the outline and holes of its biggest flat face at 1:1 in mm, built without fillets and chamfers, red hairlines; several come as one ZIP.
- Settings (gear, right of the MAKERMAKER title; chapters on the left, their settings on the right): General: the document's units (saved in its file). 3D view (saved per browser): ambient occlusion (three's GTAO pass, sized for mm; snapshots get it too; while a section cuts, it reads the cut view's own depth and normals, cut faces included). Background of the 3D view and new renders, around the horizon (looking down shows the lower colour, looking up the upper, level the blend; ortho views as a perspective camera would see it): solid (the theme grey), two colours meeting sharply at the horizon, or one of 8 sky presets (every third hour of the "sky gradients" CodePen by billyysea, blended over ±25°).
- View: the wheel zooms towards the pointer; Grid and Origin switches (top left) show or hide the ground grid and the origin (thick, drawn over everything; the move gizmo uses its colours); under the view cube: look at a face, Fit (F: the camera keeps its direction and the point it looks at and only moves back or forth, or zooms in ortho, until everything is in view) and Home (H: everything framed from the front-right corner), both gliding there like the view turns; the half-moon button switches light / dark. Sphere centres snap like corners; a selected sphere shows its centre as a dot.
- Renders (one pipeline for snapshots and nice renders; the list sits in the right column, opened with the camera-with-star button; clicking something in the 3D view, the list or a group's ⚙ closes it):
  - Snapshot (camera button): downloads `<file>_snapshot.png` at once (transparent background, twice the screen resolution, without grid, origin, sketches, cutters or selection) and keeps it in the list without opening it; Render nice on it renders that view nicely.
  - Render this view: a small picture at once, then the real render queued (three-gpu-pathtracer, 256 passes, soft sky light); renders run one after another, slower while the list is closed (a status row then sits on top of the right column), the picture growing live.
  - Each render keeps its camera (position, target, ortho / persp, zoom, size) and background (from the settings when made; its colours above and below the horizon can be changed for the next render of that view). The picture is traced on a transparent background and laid over the same horizon gradient as the 3D view (from its camera's tilt); a solid background also gets a floor of its colour for the shadows.
  - Render again re-renders the same view with the model as it is now and saves the picture by itself; Use view turns the 3D view to it; Download saves `<file>_render_<n>.png`; × deletes. Full pictures stay until the page reloads; small copies of each result are saved in the file (up to 8 per view, older ones below the newest).
- Rotation: the body panel has Rotation X° / Y° / Z° (degrees around X, then Y, then Z of its group); sketches it extrudes, booleans, face pulls and snapping follow the turn. Document schema 10.
- Shortcuts: every keyboard action lives in one table (`src/ui/keys.ts`: chapter, name, order, default keys, hint; Settings → Hotkeys lists them by chapter), used by the app's key handler and by the tools (confirm, cancel, other side, erase); a keyboard mapper can edit it later. Typed values and the drag modifiers are not in it yet.
- Isolate: ⌘-click (else Ctrl-click) a body's eye to show only that body (its cutters stay); its eye turns into a framed eye and all other rows grey out (their eyes still show or hide them); clicking the framed eye again in any way shows what was shown before.
- Pulling always makes a new body, also when drawn on another body's face (joining is a boolean, later); its sketch stays attached to that face, so the new body follows it.
- Sketches are objects (left list, eye to show/hide; a sketch that belongs to a body has a body button that selects it, as a body's sketch button opens its sketch): shapes on a base plane or a body's face. R / C / P draw into the sketch under the pointer, the top face under it (that face's sketch), the selected sketch, or the base plane facing the camera; then pull right away (the pointer is hidden and locked, so pulling has no end; movement counts along the extrusion direction on screen), or click without pulling / Esc to keep the shape flat. E pulls the selected shapes (or the whole selected sketch). An extrusion can also reach behind its sketch plane (Back in its card): pulling with Alt goes both ways from the plane (back as far as the depth, like a rectangle from its centre); typing sets the depth, Tab then how far back; that back face can be pushed and pulled like the end face. A sketch and the body extruded from it move together both ways: the body moves freely in every direction and its sketch is shown moved along (a body drawn on another body's face also rides along with that face; a tool body drawn on its owner's face is not dragged twice). Extrusions stay linked to their sketch shapes (the broken-chain icon unlinks: copies the shapes into the step); shapes inside shapes are holes (even-odd). The pointer snaps to corners and centres of all visible sketches and to body corners (big squircle), else to the nearest line: sketch outlines and body edges (the hit line lights up, small squircle), all projected onto the drawing plane; typed sizes and depth stay expressions. Selected shapes: drag to move in the sketch plane (axis wheel limited to the plane's two axes); a single shape gets incase-style handles (Alt from the middle, Shift proportional, Ctrl precise, type a size, Tab other side) and a round handle to turn it (Shift 15°); only changed values are written, others keep their expressions. Two or more selected shapes: align left / centre / right / top / middle / bottom, distribute (three or more); ⌘D duplicates shapes (keeping expressions), arrows nudge them in their plane, Del deletes them.
- Fillets/chamfers select edges by rule (all/top/bottom/vertical) and survive dimension changes; failures name the step and keep the last valid geometry. Picked edges (Alt-click, or a double right-clicked loop) get their own finish by dragging one of them: up a fillet, down a chamfer, the size following the mouse (typed sizes work, release or Enter keeps it, Esc puts it back); the finish stores the edges as points along them (rule "Picked edges"), matched again on each rebuild. The sample document has two test pieces for it (one chamfered edge, one rounded edge). A picked fillet / chamfer (click its face) is resized the same way: press its face again and drag, up bigger, down smaller, past 0 it turns into the other kind (an expression stays while the kind does). A finish too big for its edges is clamped: the kernel finds the largest size that works (halving the gap 10 times) and that is written instead (same undo step, a note says so); drags and scrubbing the panel field stop there, and typing beyond it later is cut to it at once. A size set below 0 turns a fillet into a chamfer and back (`-3` → `3`, `-ply` → `ply`, longer expressions as `-(…)`).
- Every numeric field accepts numbers, units (`3in`) and expressions with parameters (`2*ply + 10`); display units switch without changing geometry.
- Save in place (File System Access), open, drag & drop, undo/redo, offline startup; v1 files migrate to v2.
- Tools survive camera moves: labels and markers follow orbit, cube, Look at, Fit and Home; while a tool runs, right-drag turns the view and middle-drag pans.
- Look at a face: the button under the view cube, then click a face; the camera looks straight at it (orthographic).
- Viewport and editing follow incase: view cube, per-view Ortho/Persp, Fit and Home, drag a body to move it along X / Y / Z picked by the drag direction like a weapon wheel (shown at the press point; leave the dead zone ring to pick, go back through it to change; type a distance, Enter keeps, Esc undoes; steps follow the zoom: Shift coarse, Ctrl precise), cube drag with locked hidden pointer, Shift- or ⌘/Ctrl-click toggles bodies and shapes in the view (in the lists ⌘/Ctrl-click toggles, Shift-click selects a range), Tab through bodies under the click, arrows nudge (Shift ×10, Ctrl the minimum step), Del, ⌘D duplicate (⌘C / ⌘V the same: ⌘C takes a copy of the selection, each ⌘V adds copies of it; ⌘X takes it away and ⌘V puts it back as it was, in place, the move fields at 0; a body pasted with the sketch it extrudes is linked to the pasted sketch; copies in place, then the move fields open at 5, 5, 0 mm, the copies shown moved and the originals as ghosts: type where the copies go), Esc, drag a field or its label to scrub.
- Section viewer (from incase, plus Z): two-handle range per axis (cuts are fixed world positions: adding or moving bodies widens the sliders' range, the handles follow, the cut stays), invert, reset / double-click, hatched caps on cut faces; clicking a cut face picks its body. Custom sections (saved in the file): + Section (the button then reads "Click any face or plane"), click a face (hovered faces light up) or empty space for the base plane facing you; the plane lies on it (offset 0), removing the side towards the camera; name, on/off, offset, flip, delete.
- Autosave toggle: writes into the open file a moment after each change (Chromium; no history snapshot, ⌘S adds one).
- Icons and toolbar in incase's style.

## Planned, not built yet

Collected from [GOAL.md](GOAL.md) and the design talks; roughly in the order they were asked for.

- **Rebindable hotkeys**: every shortcut and modifier role (`MODS` in keys.ts: Shift constrain, Ctrl precise, Alt from the centre, ...) set by the user.
- **Undo history list**: ⌘Z twice shows the latest steps; drag a line through the log to move in history.
- **Render quality target**: renders stop at a chosen quality (say 80 %) and save the picture; raising it to 100 % continues the render (or renders again, whichever the path tracer allows).
- **Photo sphere backgrounds** for the 3D view and renders, next to solid and gradient.
- **Nicer renders**: materials and lighting choices for the path traced render, Mitsuba 3 through a local helper (deferred); screenshot turntable and dolly clips.
- **Laser export, properly**: picking which face or profile to cut (now: the biggest flat face), DXF, kerf, nesting several parts on one sheet (the rules for which faces qualify are still open).
- **3D print export, properly**: print checks (closed, manifold, scale) and 3MF next to the current STL proof.
- **Imports**: 3MF / GLB as mesh bodies (STEP, STL and OBJ work), SVG / DXF into sketches; meshes in booleans and exports. Maybe use [cadmpeg](https://github.com/cadmpeg/cadmpeg) 
- **Materials**: name, sheet thickness and look; groups give defaults; thickness mismatches shown.
- **Joints**: fixed, hinge and slider between bodies or groups.
- **Duplicates**: linked copies (shared design, own placement) next to independent ones.
- **Cutters, further**: one cutter cutting several bodies, an editing mode that reveals hidden cutters, a note when a cutter removes nothing.
- **Edge references**: picked edges (now matched by points along them) that survive edits which move or split them.
- **Face edits**: moving faces that no extrusion made (fillet, boolean and sphere faces).
- **Sketching**: arcs, dimensions, constraints if needed.
- **Drawings**: paper sheets with scaled views, dimensions, sections, PDF export.
- **Quad view**: four editable views at once.
- **incase**: the sibling project ../incase should be included here.
- **Rotating in the 3D view** as in incase.
- **Render camera**: change the field of view for renders, set it as real-life camera focal length in mm, and a default field of view in the settings.
- **Threads**: holes and cylinders defined as threads with real thread geometry, metric and inch (UNC / UNF); special geometry that is always modelled, built so that e.g. the top edge of a threaded hole or cylinder can still be chamfered.
- Super nice joint tool (hinges and rotations), set clamping positions, and ease-in-out animations
- **Mesh to CAD model**: a button that turns a mesh into a CAD model, like [this video](https://youtu.be/meBi616y1mg) shows ([ScanRuler](https://github.com/CNCKitchen/ScanRuler) by CNC Kitchen).
- **Central CAD command API**: every modeling action (create, edit, select bodies, sketches, features, materials, transforms, booleans, bevels, holes, ...) through one TypeScript API used by the GUI and scripting, independent of the UI and kernel where possible.
- **LLM control**: an API through which an LLM can control everything.
- **Python scripting**: an in-browser editor (Monaco + Pyodide) with the command API as a Python module (`cad.box(...)`, `cad.move(...)`, `cad.bevel(...)`, the selection), Run, console, errors, autocomplete, offline caching.
- **Desktop wrapper** (Tauri / Electron) with native file access.
- **Image as plane** (stretch goal; the one Fusion feature worth copying): insert a PNG, WebP, JPG, GIF or SVG on a picked plane; calibrate its size by clicking two points on it and typing their real distance, the image scales to match. Bonus: an AI model (chatGPT or similar - not gemini as its nota ble to create SVGS, only pixel based) turns a photo or scan of a technical drawing into an SVG that is placed instead, with a preview before it is used.
> prompt fort iamge to svg conversions:
```text
Create a **simple, scale-accurate 2D SVG** from the attached reference image for import into CAD / 3D software.

Use **only the attached image**. Do **not** search online, use datasheets, or add dimensions from external knowledge.

The goal is **mechanical reference geometry**, not visual reproduction.

Requirements:

- Use any dimensions explicitly shown in the image as the primary scale reference.
- Infer all other dimensions proportionally from the image.
- Keep everything in **metric millimetres**.
- Make the SVG physically scaled so that CAD software imports it at the intended real-world size.
- Use simple black outlines on a white background.
- No shading, textures, perspective, decorative detail, dimension arrows, or photographic detail.
- Use as **few SVG objects as practical**.

Prioritize these features:

- overall outer dimensions
- outline/profile of the main object
- corner radii
- mounting holes
- screw-hole locations
- pin/header locations
- repeated hole or pin spacing
- connectors, switches, sockets, and other parts protruding beyond the main body
- other mechanically important features

For repeated pins, pads, holes, or headers:
- detect whether they appear to use a regular raster/pitch
- infer that pitch from the drawing where possible
- preserve the correct number and approximate locations
- if a standard-looking pitch can be inferred directly from the image, note the estimated pitch, for example `~2.54 mm`

For mounting holes:
- include their estimated diameter and centre positions
- note the corresponding **metric screw size**
- if the screw size is explicitly stated in the original drawing, reproduce it normally, e.g. `M3`
- if it is only inferred from the image, mark it clearly as approximate, e.g. `~M3`, `~M2.5`, etc.
- never present an inferred screw size as exact

For connectors or components that stick out beyond the main outline:
- make them separate SVG objects
- simplify each one to a rectangle, rounded rectangle, circle, or similarly basic shape
- do not draw internal connector details unless mechanically necessary

For pins and labels:
- label only the most important pins/functions if they are clearly readable or inferable from the supplied image itself
- do not invent pin functions
- keep labels in a separate SVG group so they can easily be removed before CAD import

Accuracy rules:

- Clearly distinguish between:
  - dimensions explicitly shown in the image
  - dimensions estimated proportionally
  - dimensions inferred from repeated geometry/pitch
- Do not silently use outside knowledge.
- If something is uncertain, make a reasonable proportional estimate rather than omitting it.
- Prefer mechanically useful approximate geometry over visual detail.

SVG construction:

- output a **real SVG file directly**, not a raster image
- use millimetres for width/height where possible
- use a matching `viewBox`
- give important objects sensible IDs such as:
  - `main-outline`
  - `mounting-holes`
  - `header`
  - `usb-port`
  - `power-port`
- group optional text labels separately
- keep the SVG clean and easy to edit

Also provide a short note listing:
- the dimensions taken directly from the image
- the most important estimated dimensions
- estimated raster/pitch values
- estimated mounting screw sizes, using `~M3` style notation wherever they were not explicitly specified

The final result should look like a **minimal mechanical CAD tracing**, not like the original photograph or product illustration.
```

### Design notes

- Shift does the opposite of a tool where that makes sense.
- Editing 2D and 3D objects uses the same tools wherever possible (booleans work on both, for example). There is no special sketch mode: sketches can be drawn at any time. Sketch objects are then grouped like 3D objects: plain groups of sketch objects instead of a separate sketch container. How they get grouped automatically is still to be decided.

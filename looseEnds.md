# Loose ends

Smaller things left open by finished work. Kept up to date with each change; bigger features are in STATUS.md's Planned list.

## Real geometry
- The survey and what is done: STATUS.md, "PARAMOUNT, solve ASAP" at its top (steps 1–6 built 2026-11-07). Nothing of it left open but what lies in the input: imported meshes have no solid; bodies over 20000 faces keep their faces' and edges' values from the mesh.
- Kept on purpose, with reasons in STATUS: the thread stays faceted (an exact helix cut fails in this OpenCascade build); a cut moving along a joint is stamped in steps.

## Lines and polygons
- What follows a changed side moves along rigidly; a polygon's last point stays, so the side before it takes up the change. A shape closed in another way than that (its last side meant to stay at an angle, say) can shift differently than wanted. Only sides changed through a formula do this: dragging a point moves that point.
- A typed sweep angle of an arc is used once (its diameter stays). `cad.line` and `cad.polygon` take plain points, no side formulas.
- A turned polygon following a parameter turns around its new middle, so it can shift a little.
- A tangent line starts on a sketch circle, arc or bezier side, or a body's round edge: not on a rounded rectangle's corner or a body's elliptic or spline edge. No line ending tangent from a free start, none tangent to two curves. It holds while drawing, no lasting link to the curve. In the one-line and polygon modes, not bezier or arc. A typed angle no tangent of a short arc runs at is ignored.


## Cut and sections
- Coming apart: bodies sharing steps by a link stay whole (a piece step would go to every linked copy). A boolean's pieces keep its tool bodies, shared: moving a tool reshapes all of them. If an edit later changes how many pieces there are or their order, a Piece step can point at another piece or none (it then shows an error). The `cad.boolean` and Python cuts do not split.
- A section's axis shows only while it is being picked; there is no way back to its own line except a new section.

## Thread
- A cosmetic thread is not in STEP or STL (it is not geometry). A linked copy's own thread steps still show the old card (its fields do not resize the hole). A face not pulled from a circle (a revolve, a sphere, a STEP or mesh body) is not resized. A circle's Ø written as a formula becomes a plain number when resized.

## Measuring
- A drawing tool's snap onto a free-form body edge (a spline, say) is very close but not exact: it uses the circle through the mesh points next to it. Round edges come out exact to the view's number precision.
- While a long build runs, a picked point waits up to 1.5 s for the solid, then takes the mesh's point (the Distance measure shows it with ~).

## Interference and clearance
- "From 30°" comes from steps (hinges 3°, sliders 1 mm, at most 60), so the start can be up to a step late. The sweep: flat faces sliding are exact; curved bodies and hinges also stand at each step (3°, 1 mm, at most 60), so a wall thinner than a step could slip past a curved part only if that part is thinner than a step too, and a cut along a joint has ridges of hundredths of a mm. A long slider (over 60 mm) has bigger steps. Big curved files: not timed.
- Deleting a body that makes a linked cut removes the cut. A and B cutting each other is refused with the usual build error.
- Large documents on Everything can take a while, and the worker builds nothing meanwhile (Stop ends it between two tests; one long boolean or a slow grow still has to finish first). Not measured on big files.
- Assumed for the sphere's ways: three points give the smallest ball (three alone do not fix one), four the exact one. "Three planes and a centre or diameter": after the third plane, the pointer sets where its centre lies (snaps count) or a typed Ø sets the size. A sphere is plain numbers afterwards: it does not follow the points or planes. No Python command of its own yet: `cad.sphere` takes a centre and diameter. T and M do not reach into its Ø field yet.
- `await cad.check` keeps what the run did so far as its own undo step, because solids have to be built for it: a script with checks can be more than one undo step.

## Coat
- Excluding a flat face removes what grew out of it over the face's own box and a margin; where another part of the body rises right beside that face, its coat there can get cut too.
- Only flat faces can be excluded. Meshes cannot be coated.
- Attach: a group as one of its objects moving by itself does not take the others along (a body does). The anchor only shows where it is: Rotate still asks for its point. Joint swap (⇅ in a joint's panel) keeps the motion between the two, so the whole assembly can shift when the joint is not at 0.

## Curves
- Sketch areas closed by lines come from OpenCascade's splitter on the true curves, fuzzy within 1e-3 mm: a line ending up to 1e-3 mm short of a curve still closes its area. Picked areas are joined as solids, not flat.
- Moving a point holds tangents through arcs (`tangentsHeld`), with exceptions: an arc turned almost straight or doubling back loses it there, a chain ending back at the moved point cannot close smoothly, a bezier's handle turns and stops there, and dragging a bezier's handles does not reach an arc beyond. Tried through tests, not yet by hand.
- The sketch shows a curved polygon's corner radius only on the extruded body, as with straight polygons.

## Extrude
- Seen once by hand (2026-11-08): "Extrude: memory access out of bounds" (a WebAssembly error out of the kernel). Steps to reproduce unknown yet.

## Combining shapes
- History rows should all open their step's tool (user, 2026-11-07: no editing in the right column but the main L W H / X Y Z fields). Done for Thread, Bulge, Draft and Box joint; Extrude, Cut / Join, Push, Shell, Coat, Revolve, Loft, Sweep, Mirror, Split, Piece, Sphere and Fillets still show their card below the row: their tools have no edit mode for an existing step yet.
- Not built yet: a face pulled on a body offers no New body (its Push step joins or cuts by the direction).
- Not built yet: clicking a face selects only extrusion and boolean steps; Push, revolve and the other steps only from Object history.
- Not built yet: the laser and SVG / DXF outlines leave fillets out, so a body rounded by fillets cuts with sharp corners (they should take the upright edges' fillets along).
- A body's shape with corner R from an unlinked sketch (its own shapes) shows that R only in its Extrude card, not in the body's card.
- The right-click menu offers only Fold, Unfold and Fold all so far (bodies without tool bodies get none).
- Folded tool bodies count as tool bodies wherever those are told apart (`ownersOf`): Interference, Select all, the exports and the view skip them; `cad.measure` gives every body, tool bodies and folded ones too (as before).
- Not tried by hand yet: the whole Join / Cut / Object history / Fold flow.

## View
- After the view cube was dragged over the top or bottom, the camera stays upside down until a cube side, a corner or Home: orbiting the view itself meanwhile feels the other way round sideways, and the view's own orbit still stops at the poles.
- Dragging a body or sketch shapes opens the move fields at the first step; an image's open only on letting go (its fields have no gizmo for the drag to write).

## Renders
- A material's own render look and its glow Reach are not in MaterialX exports or imports; the Python `look` command cannot set the render look.
- A glowing body's light comes from its middle: a long glowing strip lights like a ball. In renders a glowing body casts no shadow (so its light gets out).
- Save to was tried headless with the browser's private folders standing in for the pickers (every choice, ./renderings made again, a folder gone, a folder not holding the document); not yet with the real folder picker and its permission prompts. The live render view was tried headless only.
- "See in live render" sets the view's camera but not its picture size: the live picture has the view's shape, not the render's Aspect.
- Before its first render, a render's thumbnail is the view cut to its Aspect from the middle: a wider Aspect really shows a little more at the sides.
- The Photo sphere dropdown on each render does not belong there: it should be global, but a photo sphere is a setting of both the 3D view (background) and the renders (background and light). Needs a rethink of where backgrounds and photo spheres live.
- A render saved from a live view gets its preview as thumbnail; its camera is the live view's at its size on screen.

## Versions
- Versions are kept per save, up to 50, autosave one every 5 minutes; a design never saved has none. They have no names; × on a row deletes one (written at once when the file has a handle, else with the next save). A version shown replaces what is on screen, so its tool panels and selection reset.

## Terminal
- Renaming a picked .py file uses the file handle's `move`, only in newer Chromium; not tried by hand.
- A script's result arriving while a tool is in the middle of a drag or a drawing is not held back. Not tested what that does to the drag.

- `cad.measure` knows bodies as built when the run began: a shape changed in the same run is measured as it was. Its boxes ignore a group's turn when something moved in the run. It only gets its numbers if the run's text contains the word measure, so a helper function loaded from elsewhere would not.
- `cad.move` on a group without its own origin moves its bodies, not sketches that have no body.

## Imports
- One colour or one texture per part: several vertex colours become their average, see-through is ignored. Above 200 parts they merge by colour and texture, as bodies each would be too heavy. A texture is kept as the picture only: its tint, a SketchUp texture's own colour change (colorized) and transparency are not. 3MF textures and OBJ materials are not read. A GLB's texture is drawn into a PNG, so a JPEG one grows. A textured material on a body without texture coordinates (not imported) repeats every 12 mm. Big textures make the design file big, as pictures do. An all-white file counts as having no colours. OBJ and STL stay one body.

## Speed
- Reading and meshing a 15 MB STEP file (7,948 faces, about 7.7 s per copy) takes the worker's memory up to 1.9 GB; a few times that size could hit the browser's WebAssembly limit. Not caused by keeping solids; the copy or the mesh step is where to look first.
- Rebuilding a body leaves some memory behind in the worker even when its shape is deleted; dropping the mesh first reduced this. Over very long sessions it could add up.
- Only joint animation on the lamp has been measured against the 50-60 fps goal. Dragging bodies, editing sketches and big STEP files have not.

## Tests
- `setPointerCapture` threw InvalidStateError in Playwright pulls, cause unknown; not seen by hand.
- The manual checklist's "Check these first" group in CHECKLIST.md has not been run.

## Assumed, change if wrong
Answers assumed where a request left a question open.

- Dialogs and panels close with one icon (`closeButton` in src/ui/icons.ts): Settings, Materials, Renders. × buttons on list rows and cards delete things and stay as they are.
- "Edit material…" beside the material list uses the materials icon, the same as the top bar's button.
- An image's rotate button turns it right away with the pointer, as Rotate does for bodies; the Turn field stays typed from 0 each time, because images store no turn value of their own.
- Cross-browser is noted as a goal only; nothing about it is built yet.
- A tool body listed in another group than its body: moving that whole group moves the tool alone and so reshapes the cut, and moving a group holding only the body leaves the tool behind. Moving the body itself takes the tool along.
- A tool body in a group turned differently from its body's: going along with the body is not tested there.
- Deleting a tool body removes its cut too, also when it is listed elsewhere, since the cut is built from it. Keeping the cut would need a Flatten step (see CAD goals).
- Dragging a tool body right under its owner, or among that owner's other tool bodies, lists it under the owner again; anywhere else lists it there.
- Tab goes through on line / on edge / a point along it only before anything is drawn; while drawing Tab keeps its other uses (a size's other field, a line's angle), so the nearest wins there.
- The list's boolean colours reuse the joint's two colours: the body it cuts as "stays", tool bodies as "moves".
- A tool body's eye: off hides it until selected, on shows its red outlines at all times. Only tool bodies listed elsewhere have it; those under their body keep just the red icon.
- A joint's sweep shows in see-through orange for the bodies being checked. Interference and clearance are one tool: Clearance 0 is interference. A row's Cut A | Cut B | Ignore control shows on the row the pointer is on, or the part clicked in the view; Ignore lasts while the panel is open.

## Pull on a body
- Pull on a body: Cut is offered when the pulled solid shares volume with the body (mesh test, shrunk a hair along the pull). A solid that only touches the body sideways (its wall on the body's wall, drawn beside the face) still counts as overlapping.


## View modes
- Lines and All lines: a section shows its cut copies shaded, and the extra views beside the main one draw Lines as classic hidden lines (each body hiding the others too).

## Group origins
- A group origin change pins the group's free base-plane sketches as fixed planes: they no longer follow when the group moves later.

# MakerMaker — Loose Ends

## Bug 1 — In-progress polygon does not snap to its own segments

**Status:** Reported during manual QA; not independently reproduced.

**Steps to reproduce:**
1. Activate the Line tool and start drawing a polygon point by point.
2. Before finishing the polygon, move the cursor over a segment already drawn in that same polygon, away from its endpoints or other special snap points.

**Observed:** Snapping works on other edges and on points associated with the in-progress polygon, but not at arbitrary positions along the polygon's own already-drawn line segments.

**Expected:** Previously drawn segments of the still-active polygon should be eligible for on-line/segment snapping, just like other edges.

**Reporter note:** “The freshly created polygon doesn't have line snapping … it snaps to edges … but it doesn't snap to its own lines … it snaps to points … but nowhere to the thing.”

## Bug 2 — Closing a polygon unexpectedly exits sketch mode

**Status:** Reported during manual QA; not independently reproduced.

**Steps to reproduce:**
1. Enter sketch mode.
2. Activate the Line tool in polygon mode.
3. Draw at least three corners and click the starting point to close the polygon.

**Observed:** Closing the polygon exits sketch mode unexpectedly.

**Expected:** The polygon stays flat, sketch mode remains active, and the drawing tool can continue to draw another shape.

**Related checklist item:** “Closed inside sketch mode: stays flat, the tool goes on” — **failed; leave unchecked**.

## Bug 3 — Two-point polygon retraces its own segment instead of refusing closure

**Status:** Reported during manual QA; not independently reproduced.

**Steps to reproduce:**
1. Activate the Line tool in polygon mode.
2. Click a first point, then a second point.
3. Click the first point again, attempting to close a polygon with only two distinct points.

**Observed:** The pointer hint says “point of this line,” and the tool draws a second line directly on top of the first rather than rejecting the invalid closure.

**Expected:** The operation is refused with an explanatory hint, and polygon drawing remains active so another point can be added.

**Related checklist item:** “Out and straight back with two points: refused with a hint, drawing goes on” — **failed; leave unchecked**.

## Session review — 2026-11-07

The three bugs above remain open in the manual QA log. The subsequent Bézier tests (smooth curve by clicks, mirrored orange handles, Shift angle stepping, Control fine movement, tangent transition from a straight line, smooth closure, drag-controlled closure, and Alt held during a handle drag) **passed**. No additional Bézier bug was reported. The exploratory “Control changes a handle tip to a diamond” scenario is **not a specified requirement and not a bug**. Arc tests remain untested.

## Session additions — 2026-11-08 (voice QA)

All findings below are **user-observed, not independently reproduced**. Previous reports above are preserved.

### Bug 4 — Selection cycling limited to bodies/objects

**Steps to reproduce:** Place or find selectable elements that overlap, including bodies/objects, sketches, panels/planes, or images; use the app's selection-cycling interaction over the overlap.

**Observed:** Cycling works with objects, but not with sketches, panels/planes, or images (as reported). Specific selection-cycling key/action and the exact combination of overlapping element types were not captured.

**Expected / suggestion:** Extend selection cycling consistently to other selectable element types, including sketches, planes/panels, and images. Confirm intended selection precedence and UI scope before implementation.

**Status:** Partial coverage of an exploratory selection check; not a complete checklist item pass.

### Improvement 5 — Normalize negative dimensions while preserving geometry

**Steps to reproduce:** Set a body's Height to a negative value, for example Height = −40 while Z = 0. Also try entering negative Width and Length values.

**Observed:** Negative Height is allowed and the object extends in the opposite direction while retaining the negative displayed value. Negative Width and Length are currently disallowed.

**Expected / requested:** Allow negative values during manipulation or entry for all three dimensions, then normalize on commit without moving the occupied geometry: Height −40, Z 0 → Height 40, Z −40. Apply the analogous compensation to Width/X and Length/Y (respecting each field's assigned axis). The user describes this as a consistency improvement, not invalid geometry.

**Status:** Enhancement request; no precise existing checklist item tested.

### Bug 6 — Zoom to Fit unreliable after zooming far out

**Steps to reproduce:** Zoom far out in the model view, then invoke **Zoom to Fit** / **Move Fit**.

**Observed:** Instead of framing the model, the view moves unexpectedly or seemingly arbitrarily. The **Home** action behaves correctly across the zoom levels and rotations tested.

**Expected:** Zoom to Fit should reliably frame the intended model/content regardless of the starting zoom level.

**Status:** Failed exploratory camera check; Home passed. Specific reproducible model and camera state not recorded.

### Bug 7 — Work-plane size changes when changing document units

**Steps to reproduce:** Add or display a work plane, switch document units between millimetres and inches, and observe its size. Compare imported images and SVGs.

**Observed:** Work planes change apparent size when switching units. Images and imported SVGs stay put / do not appear mis-scaled.

**Expected:** Switching units should change units and displayed measurements, not the physical size of a work plane.

**Status:** Units check partial / failed for work planes; not evidence for all unit-related functionality.

### Bug 8 — SVG import feedback toast does not dismiss automatically

**Steps to reproduce:** Import an SVG file and observe the grey top-bar toast naming the filename and reporting shapes imported as a sketch on the ground.

**Observed:** The import feedback remains visible, apparently until another message replaces it.

**Expected / suggestion:** Transient successful import feedback should disappear after a suitable delay (or use an otherwise unobtrusive persistent history mechanism).

**Status:** Reported; replacement-by-next-message behaviour was an impression, not a formally timed test.

### Bug 9 — Distance measure hint is clipped

**Steps to reproduce:** Activate Distance measure, then hover where its help/hint is displayed.

**Observed:** A long white instruction starts with “Distance measure, click points, each from the one before…” (approximate spoken wording); supplementary grey text beginning with “Alt-click…” is much longer and ends up truncated with an ellipsis. The text's layout is awkward.

**Expected / suggestion:** Tooltip/help layout should accommodate both main and secondary instructions, wrapping or expanding rather than truncating important content.

**Status:** UI layout issue reported; full original wording was not captured.

## Other quick checks reported during the 2026-11-08 session

These outcomes were reported as passing, but the broad spoken checks should **not** be treated as confirmation of every subcondition of the original, more detailed checklist entries:

- Existing-file Save and Save As after a small edit.
- Undo twice and Redo twice following two edits.
- Pan, zoom, rotate and Home (but **not** Zoom to Fit).
- Snapping to endpoints, midpoints, centres, and intersections during drawing or moving.
- Editing a dimension and committing with Enter.
- Duplicating a body and moving its copy independently.
- Hide and restore an object.
- Renaming an object: persisted after save/reopen; list position also preserved as reported.
- Group two objects, move them, ungroup: positions preserved.
- Multi-select deletion affected the expected objects.
- Two-point measurement gave the expected result (other Distance measure behaviours not checked).
- Escape cancels a drawing in progress cleanly (not necessarily every Esc path specified by the checklist).
- Object material/colour persists after save and reopen.

**Not tested:** STL export — no STL export option was available in the tested application. This is **not** counted as a bug or a passed checklist item. The source checklist instead specifies other export checks, including STEP, SVG and DXF.

**Checklist integrity:** All original entries and existing `[x]` marks are preserved. No new `[x]` marks were added because today's broad checks did not establish an exact full original checklist item. Future guided sessions should return to the unchecked specific items.

# Loose ends

Smaller things left open by finished work. Kept up to date with each change; bigger features are in STATUS.md's Planned list.

## Lines and polygons
- What follows a changed side moves along rigidly; a polygon's last point stays, so the side before it takes up the change. A shape closed in another way than that (its last side meant to stay at an angle, say) can shift differently than wanted. Only sides changed through a formula do this: dragging a point moves that point.
- A typed sweep angle of an arc is used once (its diameter stays). `cad.line` and `cad.polygon` take plain points, no side formulas.
- A turned polygon following a parameter turns around its new middle, so it can shift a little.
- A tangent line starts on a sketch circle, arc or bezier side, or a body's round edge: not on a rounded rectangle's corner or a body's elliptic or spline edge. No line ending tangent from a free start, none tangent to two curves. It holds while drawing, no lasting link to the curve. In the one-line and polygon modes, not bezier or arc. A typed angle no tangent of a short arc runs at is ignored.

- 3D lines: no point handles to drag yet (move them as a whole). A typed length or angle without an axis lock puts the point on the plane (measured on it). A line started in 3D and switched to bezier or arc mode is kept flat. A 3D line's own points snap only on the plane while drawing it; sketch Offset, Mirror and laser / DXF export use its plane projection. A click on a snap off the plane in one-line mode keeps the mesh point (no time to move it onto the real geometry).

## Wire tool (planned, decided 2026-11-08)
- After the 3D sweep: two face clicks, a round wire between them, solved in 3D (stiffness, min bend radius, gravity always world -Z, also inside a turned group; it rests on bodies only, no floor; starts taut). Colours in turn: red, black, blue, white, yellow, green, orange, … (about 10 bright ones), then red again, shiny. Ends follow their bodies (re-solved). Plug ends: a hidden part of the wire, changed only in the wire tool; both ends plugs: the length typed includes them. Can't reach: the target as a red ghost, the closest reachable as the solid. Drag an end to move it, the middle to add a guide. No default keys; a clash-check button. A clicked wire: its centre line's length (plugs included) in the Info panel.

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
- Moving a point holds tangents through arcs (`tangentsHeld`), with exceptions: an arc turned almost straight or doubling back loses it there, a chain ending back at the moved point cannot close smoothly, a bezier's handle turns and stops there, and dragging a bezier's handles does not reach an arc beyond.
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

## View
- After the view cube was dragged over the top or bottom, the camera stays upside down until a cube side, a corner or Home: orbiting the view itself meanwhile feels the other way round sideways, and the view's own orbit still stops at the poles.
- Dragging a body or sketch shapes opens the move fields at the first step; an image's open only on letting go (its fields have no gizmo for the drag to write).

## Renders
- A material's own render look and its glow Reach are not in MaterialX exports or imports; the Python `look` command cannot set the render look.
- A glowing body's light comes from its middle: a long glowing strip lights like a ball. In renders a glowing body casts no shadow (so its light gets out).
- "See in live render" sets the view's camera but not its picture size: the live picture has the view's shape, not the render's Aspect.
- Before its first render, a render's thumbnail is the view cut to its Aspect from the middle: a wider Aspect really shows a little more at the sides.
- The Photo sphere dropdown on each render does not belong there: it should be global, but a photo sphere is a setting of both the 3D view (background) and the renders (background and light). Needs a rethink of where backgrounds and photo spheres live.
- A render saved from a live view gets its preview as thumbnail; its camera is the live view's at its size on screen.

## Versions
- Versions are kept per save, up to 50, autosave one every 5 minutes; a design never saved has none. They have no names; × on a row deletes one (written at once when the file has a handle, else with the next save). A version shown replaces what is on screen, so its tool panels and selection reset.

## Terminal
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

## Assumed, change if wrong
Answers assumed where a request left a question open.

- Dialogs and panels close with one icon (`closeButton` in src/ui/icons.ts): Settings, Materials, Renders. × buttons on list rows and cards delete things and stay as they are.
- "Edit material…" beside the material list uses the materials icon, the same as the top bar's button.
- An image's rotate button turns it right away with the pointer, as Rotate does for bodies; the Turn field stays typed from 0 each time, because images store no turn value of their own.
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

## Found by hand (2026-11-07 / 08, user-observed, not reproduced)
- Closing a polygon inside sketch mode (Line tool, polygon mode, three corners, click the start) leaves sketch mode; it should stay flat and the tool go on (checklist: "Closed inside sketch mode").
- Tab cycling under the pointer covers bodies and work planes (93d0730), not sketches or images.
- Negative sizes: a body's H can be typed negative (it grows the other way and keeps showing −40); L and W refuse it. Wanted: all three take a negative value and on Enter it turns positive with the position moved, the space it fills unchanged (H −40 at Z 0 → H 40 at Z −40).
- Switching the document between mm and inch changes a work plane's size on screen (images and imported SVGs stay put).
- Long tool hints (Distance measure's) are cut short with … in the floating panel's one line (all of it only on hover).
- Wanted: Revolve of an open outline (a surface). Not built: bodies are solids only.

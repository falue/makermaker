# Loose ends

Smaller things left open by finished work. Kept up to date with each change; bigger features are in STATUS.md's Planned list.

## To do (user list, 2026-11-11)
- Reminder for the user (2026-11-12): in testdata/türkartenleser-2.mmk delete "montage block wand mirrored" (it was made before copies got their own tool bodies, so it shares the original's and does not build), then mirror, move and join again.

## Lines and polygons
- What follows a changed side moves along rigidly; a polygon's last point stays, so the side before it takes up the change. A shape closed in another way than that (its last side meant to stay at an angle, say) can shift differently than wanted. Only sides changed through a formula do this: dragging a point moves that point.
- A typed sweep angle of an arc is used once (its diameter stays). `cad.line` and `cad.polygon` take plain points, no side formulas.
- A turned polygon following a parameter turns around its new middle, so it can shift a little.
- A tangent line starts on a sketch circle, arc or bezier side, or a body's round edge: not on a rounded rectangle's corner or a body's elliptic or spline edge. A line ends tangent (Ctrl, `tangentTo`) only from a corner in the plane, not when it started tangent too: none tangent to two curves. It holds while drawing, no lasting link to the curve. In the one-line and polygon modes, not bezier or arc. A typed angle no tangent of a short arc runs at is ignored.

- 3D lines: no point handles to drag yet (move them as a whole). A typed length or angle without an axis lock puts the point on the plane (measured on it). A line started in 3D and switched to bezier or arc mode is kept flat. A 3D line's own points snap only on the plane while drawing it; sketch Offset, Mirror and laser / DXF export use its plane projection. A click on a snap off the plane in one-line mode keeps the mesh point (no time to move it onto the real geometry).

## Wire tool (planned, decided 2026-11-08)
- After the 3D sweep: two face clicks, a round wire between them, solved in 3D (stiffness, min bend radius, gravity always world -Z, also inside a turned group; it rests on bodies only, no floor; starts taut). Colours in turn: red, black, blue, white, yellow, green, orange, … (about 10 bright ones), then red again, shiny. Ends follow their bodies (re-solved). Plug ends: a hidden part of the wire, changed only in the wire tool; both ends plugs: the length typed includes them. Can't reach: the target as a red ghost, the closest reachable as the solid. Drag an end to move it, the middle to add a guide. No default keys; a clash-check button. A clicked wire: its centre line's length (plugs included) in the Info panel.

## Cut and sections
- Coming apart: bodies sharing steps by a link stay whole (a piece step would go to every linked copy). A boolean's pieces keep its tool bodies, shared: moving a tool reshapes all of them. If an edit later changes how many pieces there are or their order, a Piece step can point at another piece or none (it then shows an error). The `cad.boolean` and Python cuts do not split.
- A section's axis shows only while it is being picked; there is no way back to its own line except a new section.
- An extra view's Look at a face takes a face clicked in that view, or one Alt-picked in the main view; a click there ignores the main view's section (it may land on a part cut away in the main view).
- Explode (extra views only): sketches, work planes and images stay where they are; it is not saved with the view; a live render shows the bodies unexploded; with the view's section on, dragging the slider rebuilds that section each step (can be slow with many bodies).
- An extra view's section has the axis sliders only: no custom (face) sections there, since extra views pick nothing. Its drawer shares the main one's open / closed memory. Its cut outlines take the line width of the view's size when built (not redone on resize).

## Pattern
- In a sketch the copies are plain shapes: editing the original later does not change them. Around a line lying in the sketch's plane turns around its start point.

## Thread
- A cosmetic thread is not in STEP or STL (it is not geometry). A linked copy's own thread steps still show the old card (its fields do not resize the hole). A face not pulled from a circle (a revolve, a sphere, a STEP or mesh body) is not resized. A circle's Ø written as a formula becomes a plain number when resized.

## Measuring
- A drawing tool's snap onto a free-form body edge (a spline, say) is very close but not exact: it uses the circle through the mesh points next to it. Round edges come out exact to the view's number precision.
- While a long build runs, a picked point waits up to 1.5 s for the solid, then takes the mesh's point (the Distance measure shows it with ~).

## Interference and clearance
- A body that cannot grow by the clearance has no zone in the view, and on a joint's way only its overlaps count (no clearance there).
- "From 30°" comes from steps (hinges 3°, sliders 1 mm, at most 60), so the start can be up to a step late. The sweep: flat faces sliding are exact; curved bodies and hinges also stand at each step (3°, 1 mm, at most 60), so a wall thinner than a step could slip past a curved part only if that part is thinner than a step too, and a cut along a joint has ridges of hundredths of a mm. A long slider (over 60 mm) has bigger steps. Big curved files: not timed.
- Deleting a body that makes a linked cut removes the cut. A and B cutting each other is refused with the usual build error.
- Large documents on Everything can take a while, and the worker builds nothing meanwhile (Stop ends it between two tests; one long boolean or a slow grow still has to finish first). Not measured on big files.
- Assumed for the sphere's ways: three points give the smallest ball (three alone do not fix one), four the exact one. "Three planes and a centre or diameter": after the third plane, the pointer sets where its centre lies (snaps count) or a typed Ø sets the size. A sphere is plain numbers afterwards: it does not follow the points or planes. No Python command of its own yet: `cad.sphere` takes a centre and diameter. T and M do not reach into its Ø field yet.
- `await cad.check` keeps what the run did so far as its own undo step, because solids have to be built for it: a script with checks can be more than one undo step.

## Finger joint
- Bodies that are not boxes and meet only along an edge (no shared face) are refused; boxes meeting so still work. "The thinner one" behind a shared face is measured to the body's farthest corner, so an L-shaped body can count as thicker than it is there.
- One Fingers count for all joints of a batch gives short joints the same number of tiny fingers (Finger length avoids it).

## Laser export
- Seen from the face: a round face that turns away from the view part way counts only its seen part for cylinders and spheres; a torus or spline face doing that is left out (where no other face covers it the outline can come out a little small). Blue lines come only where flat faces of the body as modelled meet, not at fillets or chamfers.
- The sheet is rows of boxes, not nested tightly, and has no size limit (a laser bed's).

## Shell
- When OpenCascade's shell fails or is broken (some lofts), the body less its inside `t` in is used (`hollowedByOffset`): only flat open faces open that way, and a wall slanted at an open face keeps a lip there of the thickness times its slope.
- A wall that does not fit shows as an error in the body's card; the Wall panel itself does not say so.

## Coat
- Growing fills holes and cuts back concave rounds smaller than the thickness only where they are plain cylinders: torus corners, spheres and spline rounds smaller than it can still make it fail. The montage block in testdata/türkartenleser 4.mmk (the case reported 2026-11-12) was not tried again in the app: it builds only there.
- A concave round is cut back over its whole length along its axis: one whose ends are cut at an angle can lose a sliver beside them before growing.
- Excluding a flat face removes what grew out of it over the face's own box and a margin; where another part of the body rises right beside that face, its coat there can get cut too.
- Only flat faces can be excluded. Meshes cannot be coated.
- Attach: a group as one of its objects moving by itself does not take the others along (a body does). The anchor only shows where it is: Rotate still asks for its point. Joint swap (⇅ in a joint's panel) keeps the motion between the two, so the whole assembly can shift when the joint is not at 0.

## Curves
- Sketch areas closed by lines come from OpenCascade's splitter on the true curves, fuzzy within 1e-3 mm: a line ending up to 1e-3 mm short of a curve still closes its area. Picked areas are joined as solids, not flat.
- Moving a point holds tangents through arcs (`tangentsHeld`), with exceptions: an arc turned almost straight or doubling back loses it there, a chain ending back at the moved point cannot close smoothly, a bezier's handle turns and stops there, and dragging a bezier's handles does not reach an arc beyond.
- The sketch shows a curved polygon's corner radius only on the extruded body, as with straight polygons.

## Extrude
- A round face pulled: T (to object) makes it reach the point clicked (its radius: the point's distance from the axis); D measures the size itself. Several round faces pulled at once take the first one's size (the others the same offset).
- A round edge picked (Alt-click) and E: the face just past its centre along its axis pulls (a cylinder's end, a blind hole's floor), picked as faces are: Enter or a drag starts the pull. A hole through has none: its circle then pulls at once from the flat face beside it (as if drawn there: a new sketch each time, join / cut / new body as a drawn shape), and Extrude starts again after; no flat face beside it: "Nothing to pull along this edge". An edge of a rounded corner or a half rim counts too, if its points lie on one circle.
- Seen once by hand (2026-11-08): "Extrude: memory access out of bounds" (a WebAssembly error out of the kernel). Steps to reproduce unknown yet.

## Combining shapes
- Deleting a body whose linked copies take over its steps (`unlinkedFrom`) also deletes its tool bodies, so the heirs lose those cuts and joins (seen while building `withOwnTools`, 2026-11-12; not changed).
- Mirror's own copies of tool bodies tested only through Duplicate in the app (same `withOwnTools`); the Mirror tool itself was not clicked through.
- Fillets and chamfers on picked edges now run before the next join or cut after them (2026-11-12): older files whose picked finish came before a cut that should have been rounded along keep that cut sharp now (only rules round later cuts). The broken-solid note has not been seen yet on a real file: the one case found (testdata/türkartenleser.mmk, a chamfer after holes) no longer breaks. Each step's check costs a little per build (not timed on big bodies; a body of one step, as an imported STEP part, is not checked).
- History rows should all open their step's tool (user, 2026-11-07: no editing in the right column but the main L W H / X Y Z fields). Done for Thread, Bulge, Draft and Finger joint; Extrude, Cut / Join, Push, Shell, Coat, Revolve, Loft, Sweep, Mirror, Split, Piece, Sphere and Fillets still show their card below the row: their tools have no edit mode for an existing step yet.
- Not built yet: a face pulled on a body offers no New body (its Push step joins or cuts by the direction).
- Not built yet: clicking a face selects only extrusion and boolean steps; Push, revolve and the other steps only from Object history.
- Not built yet: the laser and SVG / DXF outlines leave fillets out, so a body rounded by fillets cuts with sharp corners (they should take the upright edges' fillets along).
- A body's shape with corner R from an unlinked sketch (its own shapes) shows that R only in its Extrude card, not in the body's card.
- The right-click menu offers only Fold, Unfold and Fold all so far (bodies without tool bodies get none).
- Folded tool bodies count as tool bodies wherever those are told apart (`ownersOf`): Interference, Select all, the exports and the view skip them; `cad.measure` gives every body, tool bodies and folded ones too (as before).

## View
- Size labels (drawing, pulling, pushing a face) move off the view's own controls (view cube, breadcrumb, buttons) the shortest way that still fits; where none fits they stay under it. Other floating notes (the move fields, the turn label) do not avoid them yet.
- Tab through faces while a tool picks one: only Settings → Hotkeys and the command box say so, no tool's pointer note does yet.
- The file name in the top bar cannot show the file's full path on hover: browsers give only the name (File System Access), a desktop wrapper could.
- After the view cube was dragged over the top or bottom, the camera stays upside down until a cube side, a corner or Home: orbiting the view itself meanwhile feels the other way round sideways, and the view's own orbit still stops at the poles.
- Dragging a body or sketch shapes opens the move fields at the first step; an image's open only on letting go (its fields have no gizmo for the drag to write).

## Renders
- A material's own render look and its glow Reach are not in MaterialX exports or imports; the Python `look` command cannot set the render look.
- A glowing body's light comes from its middle: a long glowing strip lights like a ball. In renders a glowing body casts no shadow (so its light gets out).
- "See in live render" sets the view's camera but not its picture size: the live picture has the view's shape, not the render's Aspect.
- Before its first render, a render's thumbnail is the view cut to its Aspect from the middle: a wider Aspect really shows a little more at the sides.
- The Photo sphere dropdown on each render does not belong there: it should be global, but a photo sphere is a setting of both the 3D view (background) and the renders (background and light). Needs a rethink of where backgrounds and photo spheres live.
- A render saved from a live view gets its preview as thumbnail; its camera is the live view's at its size on screen.

## Copy and paste between tabs
- Kept simple: what a pasted body points to and that was not copied stays behind, so its step shows an error: a Join / Cut's tool body, a sketch an extrusion follows (or a body face a sketch lies on), parameters ($ply) the other document lacks. Joints stay behind. Units are not converted (mm either way, the fields show the other unit). Copied in an older version of the app: refused.

## Moving the view without a button
- The command box now opens when Space is let go, not when pressed. Space-pan and -orbit only reach a view while the pointer is over its canvas and no field has the focus. The trackpad mode is a setting since browsers cannot tell a trackpad from a mouse wheel; with it on a mouse wheel pans too. Shift + swipe was not tried on a real trackpad (macOS may swap Shift + scrolling to sideways, which would turn orbit up / down into left / right).

## File menu
- Open recent shows file names only: two designs of the same name in different folders look alike. Firefox and Safari cannot open files again by themselves, so Open recent stays greyed there. Opening a recent file (or New) does not ask about unsaved changes, as Open does not. The menu takes no arrow keys. Tested in Chromium with the open picker stubbed (files in the browser's own storage), not with files on disk.

## Versions
- Versions are kept per save, up to 50, autosave one every 5 minutes; a design never saved has none. They have no names; × on a row deletes one (written at once when the file has a handle, else with the next save). A version shown replaces what is on screen, so its tool panels and selection reset.

## Terminal
- A script's result arriving while a tool is in the middle of a drag or a drawing is not held back. Not tested what that does to the drag.
- `cad.measure` knows bodies as built when the run began: a shape changed in the same run is measured as it was. Its boxes ignore a group's turn when something moved in the run. It only gets its numbers if the run's text contains the word measure, so a helper function loaded from elsewhere would not.
- `cad.move` on a group without its own origin moves its bodies, not sketches that have no body.

## Imports
- Native CAD files (cadmpeg): Hasi.f3z comes in where Fusion's own STEP export puts it (all 320 of its solids within 0.01 mm, the linked Raspberry Pi included, 2026-11-12), with its groups named. It brings 15 solids more than Fusion's export (a 105 × 78 × 165 mm block, bars and pads; not checked whether they are hidden in Fusion), and one tiny Pi part sits 0.5 mm off. Solids without a name in the file (the Pi's, most of Hasi's) take their group's name. Sketches, features and parameters are dropped (STEP has none). Up came out right on Hasi (checked by hand, 2026-11-11; nothing is turned). NX and Creo .prt give no geometry at cadmpeg's level. The worker is not stopped after use (its memory stays). No test runs it (needs a Worker).
- One colour or one texture per part: several vertex colours become their average, see-through is ignored. Above 200 parts they merge by colour and texture, as bodies each would be too heavy. A texture is kept as the picture only: its tint, a SketchUp texture's own colour change (colorized) and transparency are not. 3MF textures and OBJ materials are not read. A GLB's texture is drawn into a PNG, so a JPEG one grows. A textured material on a body without texture coordinates (not imported) repeats every 12 mm. Big textures make the design file big, as pictures do. An all-white file counts as having no colours. OBJ and STL stay one body.

## Speed
- Drawing over big STEP assemblies (testdata/LIO test with lights.mmk, about 330 bodies): a pointer move over a dense part still takes about 0.2 s (2026-11-09): the snap points of all body edges are gathered on every move (`snapPoints`, `bodyEdges`), not only those near the pointer.
- Reading and meshing a 15 MB STEP file (7,948 faces, about 7.7 s per copy) takes the worker's memory up to 1.9 GB; a few times that size could hit the browser's WebAssembly limit. Not caused by keeping solids; the copy or the mesh step is where to look first.
- Rebuilding a body leaves some memory behind in the worker even when its shape is deleted; dropping the mesh first reduced this. Over very long sessions it could add up.
- A fillet or chamfer too big for some edges still takes 1-2 s on testdata/blowout.mmk's candle holder (2026-11-09): every trial of the size search takes the result's tight box (`sound` in `finish`), slow on the bulge's spline face.
- Measured against the 50-60 fps goal (2026-11-10, headless Chrome at 2x, 2400×1350): LIO and blowout orbit at 60 fps in Shaded, Lines and with Soft shadows; a click on LIO ~100-170 ms (the left list rebuilt, then the browser's layout of its ~400 rows). Dragging bodies and editing sketches not measured yet.
- A live render view keeps the GPU busy for its whole render (~80 s on LIO at 468×810); it pauses while the main camera moves, but other extra views still turn at 15-30 fps meanwhile.
- Every live render restart builds the tracer's BVH on the main thread (~0.95 s on LIO, the UI frozen meanwhile), even when only its camera turned: a kept tracer would skip it (camera) or refit it (moved body); three-mesh-bvh's worker could build it off the main thread.
- The first click after loading still compiles two programs in an extra view (~0.1 s), not covered by `warmShaders`.
- Geometry workers (2026-11-12): exact numbers of a big STEP body are slow, ~4 ms per face or edge (LIO's biggest, 411 faces and 1413 edges: 7.8 s); they pause between faces and edges, but its tight box (`AddOptimal`, ~2 s there) is one step that cannot, so a file opened or a drag right after LIO waits up to that long in that worker. Storing STEP bodies' meshes and exact numbers in the file would skip reading, meshing and these on opening.
- Export, print check and areas run in the first worker: STEP files the other workers read, it reads again (once, ~3 s for LIO's) and then keeps twice in memory. The print check and STL export could go by worker instead.

## Tests
- `build.test.ts` › "reports the failing feature instead of guessing" fails (seen 2026-11-09, already on 3c042fa): a 40 mm corner fillet on the 100×60 plate is no longer refused; the edge-by-edge search caps all four corners at ~30 mm and returns that.
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
- Inside a group's own origin a base plane seen from behind still draws into that plane's sketch (the sketch from behind is a fixed plane, which would not move with the group).
- A group origin change pins the group's free base-plane sketches as fixed planes: they no longer follow when the group moves later.

## Found by hand (2026-11-07 / 08, user-observed, not reproduced)
- The candle's chamfer itself was not timed (no way to build a document in Node yet); what changed is that its 7 linked copies no longer build it again.
- The entangle icon shows while moving (move fields, drags, Align), not while turning with Rotate.
- An example script saved in this browser before 2026-11-09 keeps that copy (also a broken one); only later saves store just what differs.
- Sketch export: from the list's right-click only, not from the 3D view.
- Sketch mode's section on a ground-plane sketch cuts away every body standing on the ground. Maybe a sketch on a base plane (or seen from the top) should start without the section.
- Closing a polygon inside sketch mode (Line tool, polygon mode, three corners, click the start) leaves sketch mode; it should stay flat and the tool go on (checklist: "Closed inside sketch mode"). Not reproduced (2026-11-08, headless Chrome, sample sketch "Plate outline": it stayed in the sketch, the tool went on); the exact steps are needed.
- Negative sizes: H turns positive (the body moved) only for a body's own extrude on a base plane, not linked and not reaching back; from a sketch, a face or linked it still grows the other way and shows −40. Scrubbing (no final step on letting go): L / W stop above 0, H goes on below 0 as before; only typed values flip.
- Command box (Space): app actions only. Python lines and the API commands with arguments (`box 80 60 40`) are not taken yet; no aliases beyond the names and hints ("split" finds Cut through its hint). Space opens it only from the key; no button shows it (Settings → Hotkeys lists it).

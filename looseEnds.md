# Loose ends

Smaller things left open by finished work. Kept up to date with each change; bigger features are in STATUS.md's Planned list.

## Lines and polygons
- What follows a changed side moves along rigidly; a polygon's last point stays, so the side before it takes up the change. A shape closed in another way than that (its last side meant to stay at an angle, say) can shift differently than wanted. Only sides changed through a formula do this: dragging a point moves that point.
- A typed sweep angle of an arc is used once (its diameter stays). `cad.line` and `cad.polygon` take plain points, no side formulas.
- A turned polygon following a parameter turns around its new middle, so it can shift a little.
- A tangent line starts on a sketch circle, arc or bezier side, or a body's round edge: not on a rounded rectangle's corner (its outline has no arc to snap to) or a body's elliptic or spline edge. No line ending tangent from a free start, none tangent to two curves. It holds while drawing, no lasting link to the curve. In the one-line and polygon modes, not bezier or arc. A typed angle no tangent of a short arc runs at is ignored.

## Box joint
- The starting number of fingers comes from the bodies' boxes in the world, so it is off for plates at a slant.

## Cut and sections
- A section's axis shows only while it is being picked; there is no way back to its own line except a new section.

## Measuring
- A drawing tool's snap onto a free-form body edge (a spline, say) is very close but not exact: it uses the circle through the mesh points next to it. Round edges come out exact to the view's number precision.
- While a long build runs, a picked point waits up to 1.5 s for the solid, then takes the mesh's point (the Distance measure shows it with ~).
- The middle of a bezier or other free-form edge is where the mesh has it, placed on the true curve: on it, but not exactly half its length.
- A circle is two half edges in the solid, so one click on a rim gives half its length; Shift Alt-click adds the other half.

## Interference and clearance
- "From 30°" comes from steps (hinges 3°, sliders 1 mm, at most 60), so the start can be up to a step late. The sweep: flat faces sliding are exact; curved bodies and hinges also stand at each step (3°, 1 mm, at most 60), so a wall thinner than a step could slip past a curved part only if that part is thinner than a step too, and a cut along a joint has ridges of hundredths of a mm. A long slider (over 60 mm) has bigger steps. Big curved files: not timed.
- Deleting a body that makes a linked cut removes the cut. A and B cutting each other is refused with the usual build error.
- Large documents on Everything can take a while, and the worker builds nothing meanwhile (Stop ends it between two tests; one long boolean or a slow grow still has to finish first). Not measured on big files.
- The list says hinge values in degrees and slider values in mm, not in the display unit.
- Coat: while faces are picked, the card says thickness 0.
- Assumed for the sphere's ways: three points give the smallest ball (three alone do not fix one), four the exact one. "Three planes and a centre or diameter": after the third plane, the pointer sets where its centre lies (snaps count) or a typed Ø sets the size. A sphere is plain numbers afterwards: it does not follow the points or planes. No Python command of its own yet: `cad.sphere` takes a centre and diameter. T and M do not reach into its Ø field yet.
- `await cad.check` keeps what the run did so far as its own undo step, because solids have to be built for it: a script with checks can be more than one undo step.

## Coat
- Excluding a flat face removes what grew out of it over the face's own box and a margin; where another part of the body rises right beside that face, its coat there can get cut too.
- Only flat faces can be excluded. Meshes cannot be coated.
- A coat as a new body has its own place: moving the body leaves it behind unless both move together. Reopened, its New body checkbox cannot be switched off and its Linked one does not show.

## Curves
- Moving a point holds tangents through arcs (`tangentsHeld`), with exceptions: an arc turned almost straight or doubling back loses it there, a chain ending back at the moved point cannot close smoothly, a bezier's handle turns and stops there, and dragging a bezier's handles does not reach an arc beyond. Tried through tests, not yet by hand.
- Offset of a bezier side is close, not exact. A side that an offset would turn inside out is not removed.
- The sketch shows a curved polygon's corner radius only on the extruded body, as with straight polygons.

## Versions
- Versions are kept per save, up to 50, autosave one every 5 minutes; a design never saved has none. They have no names and cannot be deleted one by one. A version shown replaces what is on screen, so its tool panels and selection reset.

## Terminal
- Picked .py files cannot be renamed from the list.
- A script's result arriving while a tool is in the middle of a drag or a drawing is not held back. Not tested what that does to the drag.

- `cad.measure` knows bodies as built when the run began: a shape changed in the same run is measured as it was. Its boxes ignore a group's turn when something moved in the run. It only gets its numbers if the run's text contains the word measure, so a helper function loaded from elsewhere would not.
- `cad.move` on a group without its own origin moves its bodies, not sketches that have no body.

## Imports
- One colour or one texture per part: several vertex colours become their average, see-through is ignored. Above 200 parts they merge by colour and texture, as bodies each would be too heavy. A texture is kept as the picture only: its tint, a SketchUp texture's own colour change (colorized) and transparency are not. 3MF textures and OBJ materials are not read. A GLB's texture is drawn into a PNG, so a JPEG one grows. A textured material on a body without texture coordinates (not imported) repeats every 12 mm. SketchUp material names are not read: textures are named after the file. Big textures make the design file big, as pictures do. An all-white file counts as having no colours. OBJ and STL stay one body.

## Speed
- Reading and meshing a 15 MB STEP file (7,948 faces, about 7.7 s per copy) takes the worker's memory up to 1.9 GB; a few times that size could hit the browser's WebAssembly limit. Not caused by keeping solids; the copy or the mesh step is where to look first.
- Rebuilding a body leaves some memory behind in the worker even when its shape is deleted; dropping the mesh first reduced this. Over very long sessions it could add up.
- Only joint animation on the lamp has been measured against the 50-60 fps goal. Dragging bodies, editing sketches and big STEP files have not.

## Tests
- The `monster` and `threaded` boolean tests hit the 300 s limit, so they say nothing about those two bodies. They need a longer limit or fewer combinations.
- `setPointerCapture` threw InvalidStateError in Playwright pulls, cause unknown; not seen by hand.
- The manual checklist's "Check these first" group in CHECKLIST.md has not been run.

## Assumed, change if wrong
Answers assumed where a request left a question open.

- Dialogs and panels close with one icon (`closeButton` in src/ui/icons.ts): Settings, Materials, Renders. × buttons on list rows and cards delete things and stay as they are.
- "Edit material…" beside the material list uses the materials icon, the same as the top bar's button.
- Clicking an image's list row again deselects it. Bodies and sketches in the lists still stay selected on a second click.
- An image's rotate button turns it right away with the pointer, as Rotate does for bodies; the Turn field stays typed from 0 each time, because images store no turn value of their own.
- Cross-browser is noted as a goal only; nothing about it is built yet.
- A tool body listed in another group than its body: moving that whole group moves the tool alone and so reshapes the cut, and moving a group holding only the body leaves the tool behind. Moving the body itself takes the tool along.
- A tool body in a group turned differently from its body's: going along with the body is not tested there.
- Deleting a tool body removes its cut too, also when it is listed elsewhere, since the cut is built from it. Keeping the cut would need a Flatten step (see CAD goals).
- Dragging a tool body right under its owner, or among that owner's other tool bodies, lists it under the owner again; anywhere else lists it there.
- Tab goes through on line / on edge / a point along it only before anything is drawn; while drawing Tab keeps its other uses (a size's other field, a line's angle), so the nearest wins there.
- G's guides run along the drawing plane's X and Y only, not the world's.
- The list's boolean colours reuse the joint's two colours: the body it cuts as "stays", tool bodies as "moves".
- A tool body's eye: off hides it until selected, on shows its red outlines at all times. Only tool bodies listed elsewhere have it; those under their body keep just the red icon.
- A joint's sweep shows in see-through orange for the bodies being checked. Interference and clearance are one tool: Clearance 0 is interference. A row's Cut A | Cut B | Ignore control shows on the row the pointer is on, or the part clicked in the view; Ignore lasts while the panel is open.

# Loose ends

Smaller things left open by finished work. Kept up to date with each change; bigger features are in STATUS.md's Planned list.

## Lines and polygons
- A point follows a parameter only through a side's typed length, angle or diameter; points clicked freely stay fixed, so what follows a changed side does not move along with it.
- A typed sweep angle of an arc is used once (its diameter stays). `cad.line` and `cad.polygon` take plain points, no side formulas.
- A turned polygon following a parameter turns around its new middle, so it can shift a little.

## Measuring
- A drawing tool's snap onto a free-form body edge (a spline, say) is very close but not exact: it uses the circle through the mesh points next to it. Round edges come out exact to the view's number precision.
- While a long build runs, a picked point waits up to 1.5 s for the solid, then takes the mesh's point (the Distance measure shows it with ~).
- The middle of a bezier or other free-form edge is where the mesh has it, placed on the true curve: on it, but not exactly half its length.
- A circle is two half edges in the solid, so one click on a rim gives half its length; Shift Alt-click adds the other half.

## Curves
- Tangency is held only by an arc's middle between two straight sides. Moving a point, or an arc next to a curved side, does not hold it.
- Offset of a bezier side is close, not exact. A side that an offset would turn inside out is not removed.
- The sketch shows a curved polygon's corner radius only on the extruded body, as with straight polygons.

## Terminal
- Picked .py files cannot be renamed from the list.
- A deleted example script comes back only with its Undo; there is no way yet to bring it back later, other than clearing the browser's data.
- A script's result arriving while a tool is in the middle of a drag or a drawing is not held back. Not tested what that does to the drag.

- `cad.measure` knows bodies as built when the run began: a shape changed in the same run is measured as it was. Its boxes ignore a group's turn when something moved in the run. It only gets its numbers if the run's text contains the word measure, so a helper function loaded from elsewhere would not.
- `cad.move` on a group without its own origin moves its bodies, not sketches that have no body.

## Imports
- 3MF and GLB arrive as one mesh body without colours; several parts in a file are not separated.

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

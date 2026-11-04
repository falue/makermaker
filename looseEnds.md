# Loose ends

Smaller things left open by finished work. Kept up to date with each change; bigger features are in STATUS.md's Planned list.

## Lines and polygons
- A point follows a parameter only through a side's typed length, angle or diameter; points clicked freely stay fixed, so what follows a changed side does not move along with it.

## Curves
- Sketch Offset and corner radius do not work on curved sides yet.
- An arc tangent at both ends only keeps its start tangent.
- Rule-based finishes ignore extruded arcs.
- Bezier handles take no typed values.
- Tangency to neighbours is not held when a point or an arc's end moves.

## Terminal
- A script's result arriving while a tool is in the middle of a drag or a drawing is not held back. Not tested what that does to the drag.

## Imports
- 3MF and GLB arrive as one mesh body without colours; several parts in a file are not separated.

## Speed
- Only joint animation on the lamp has been measured against the 50-60 fps goal. Dragging bodies, editing sketches and big STEP files have not.

## Tests
- The `monster` and `threaded` boolean tests hit the 300 s limit, so they say nothing about those two bodies. They need a longer limit or fewer combinations.
- `setPointerCapture` threw InvalidStateError in Playwright pulls, cause unknown; not seen by hand.
- The manual checklist's "Check these first" group in CHECKLIST.md has not been run.

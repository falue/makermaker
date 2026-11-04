# Loose ends

Smaller things left open by finished work. Kept up to date with each change; bigger features are in STATUS.md's Planned list.

## Lines and polygons
- A point follows a parameter only through a side's typed length, angle or diameter; points clicked freely stay fixed, so what follows a changed side does not move along with it.

## Curves
- Tangency is held only by an arc's middle between two straight sides. Moving a point, or an arc next to a curved side, does not hold it.
- Offset of a bezier side is close, not exact. A side that an offset would turn inside out is not removed.
- The sketch shows a curved polygon's corner radius only on the extruded body, as with straight polygons.

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

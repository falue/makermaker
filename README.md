# MAKERMAKER

> WIP!
>
> Attention: Completely AI vibe coded.

CAD in the browser for people who build things: props, fitted parts, boxes and brackets, cut on a laser or printed in 3D. Draw a shape, pull it up, round its edges, cut holes into it, and send it to the machine.

It runs on your computer, also offline, and keeps your designs in ordinary files you save wherever you like. No account, no cloud.

## What it can do

- **Draw and pull**: rectangles, circles, polygons, lines and spheres, drawn on the ground, on any flat face, on a sketch or on a green work plane (halfway between two faces, say), then pulled into solid bodies. Their faces can be pushed and pulled afterwards.
- **More ways to make solids**: revolve a profile around an axis, loft through shapes on several sketches, sweep a shape along a path, hollow a body into walls (shell), offset outlines, mirror shapes and bodies.
- **Real threads**: click a hole's or shaft's edge and get an ISO metric thread cut into it, ready to print.
- **Round, chamfer, cut and join**: fillets and chamfers stay editable; bodies cut, join or intersect each other and stay movable while they do.
- **Cut in two**: split a body along a plane (turned around any edge), a sketch line or shape, a ball or a cylinder; keep both halves or just one.
- **Type instead of fiddling**: every number can be a unit or a formula with named values (`2*ply + 10`); change `ply` once and everything that uses it follows. Names complete as you type.
- **Snap to what matters**: corners, centres, middles, crossings, evenly spaced points along any line, and guide lines that extend an edge across the whole view.
- **Move precisely**: drag along an axis, or press X, Y or Z (M: all three) and type a distance; rotate around any edge, line, circle or point; align parts to each other. Press T to take a distance from something you click, and calculate on with it (`T/2`).
- **Joints**: hinges and sliders between parts, played back with ease in and out, and you keep modelling while a lid stands half open.
- **Look inside**: section views along X, Y, Z and any face, on the fly.
- **Groups**: nest, fold and turn groups of parts with their own origin; sketches are sketch groups with nested sub-groups, opened by double-click like in Illustrator.
- **Import** with the import button or by dropping a file:
  - **STEP** (`.step`, `.stp`) becomes a real solid: round and chamfer its edges, cut or join it with other parts, sketch on its faces, export it. It has no history to edit, and its faces cannot be pushed or pulled yet.
  - **STL** and **OBJ** stay meshes: move, group, colour, section and render them; no cutting, joining or export yet. Tiny meshes (no unit in the file) are scaled up, the scale stays editable.
- **Export**: STEP for other CAD tools, STL for the 3D printer, SVG outlines for the laser.
- **Render**: snapshots and nicer path-traced renders of saved views, queued, downloaded automatically, and rendered again on demand when the model changed.

## Get started

Open MAKERMAKER in a Chromium-based browser (Chrome, Edge, Brave, Arc). Draw a rectangle with R, pull it up, click to finish. The bar at the bottom always says what the keys and clicks do right now; Settings → Hotkeys lists every key.

To run it yourself, see [STATUS.md](STATUS.md#develop).

MAKERMAKER is young: some parts are proofs of concept, see [STATUS.md](STATUS.md) for what works and what is planned.

## Why not Fusion 360?
Inconsistent tools, fragile semantics, poor interoperability/lock-in, and geometry editing that is much less direct than it ought to be, too much state/history management where no history is wiscalledhed for..
- No subscription, no account, no cloud: Your designs are files on your disk, and it works offline.
- Consistent user interfaces
- Less clicking: Tools stay on until ESC, works tool first or object first, values are typed in place without dialogs
- Select an object that is BEHIND the thing in front
- The view cube does not freak out.
- A render pipeline that actually works: Queued renders of saved views, automatic download, a history of results per view, and one click to render a view again with the model as it is now.
- Actual keyboard controls
- Hotkey editing: Soon!
- Smart and automatic exports for laser cutters, 3d printers
- Non-destructive chamfers and bevels. Because - chamfers are what seperates us from the animals.
- If a value is too big, assume the biggest working value
- Negative boolean objects!
- No user interface overlays the thing you want to change.

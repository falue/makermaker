# MAKERMAKER

CAD in the browser for people who build things: props, fitted parts, boxes and brackets, cut on a laser or printed in 3D. Draw a shape, pull it up, round its edges, cut holes into it, and send it to the machine.

It runs on your computer, also offline, and keeps your designs in ordinary files you save wherever you like. No account, no cloud.

## What it can do

- **Draw and pull**: rectangles, circles, polygons, lines and spheres, drawn on the ground, on any flat face or on a sketch, then pulled into solid bodies. Their faces can be pushed and pulled afterwards.
- **Round, chamfer, cut and join**: fillets and chamfers stay editable; bodies cut, join or intersect each other and stay movable while they do.
- **Type instead of fiddling**: every number can be a unit or a formula with named values (`2*ply + 10`); change `ply` once and everything that uses it follows. Names complete as you type.
- **Snap to what matters**: corners, centres, middles, crossings, evenly spaced points along any line, and guide lines that extend an edge across the whole view.
- **Move precisely**: drag along an axis, or press X, Y or Z and type a distance; the part shows where it goes before you confirm.
- **Look inside**: section views along X, Y, Z and any face, on the fly.
- **Groups**: nest, fold and turn groups of parts with their own origin.
- **Import**: STEP files as real solids, STL and OBJ as meshes.
- **Export**: STL for the 3D printer, SVG outlines for the laser.
- **Render**: snapshots and nicer path-traced renders of saved views, queued, downloaded automatically, and rendered again on demand when the model changed.

## Get started

Open MAKERMAKER in a Chromium-based browser (Chrome, Edge, Brave, Arc). Draw a rectangle with R, pull it up, click to finish. The bar at the bottom always says what the keys and clicks do right now; Settings → Hotkeys lists every key.

To run it yourself, see [STATUS.md](STATUS.md#develop).

MAKERMAKER is young: some parts are proofs of concept, see [STATUS.md](STATUS.md) for what works and what is planned.

## Why not Fusion 360?

- No subscription, no account, no cloud: your designs are files on your disk, and it works offline.
- The view cube does not freak out.
- Not so much clicking: tools stay on until Esc, work tool first or object first, values are typed in place without dialogs, and autosave writes the file a moment after each change.
- A render pipeline that actually works: queued renders of saved views, automatic download, a history of results per view, and one click to render a view again with the model as it is now.

# MAKERMAKER

> WIP!

> **NOTE**: ⚠ VIBE CODED ⚠

CAD in the browser for people who build things: props, fitted parts, boxes and brackets, cut on a laser or printed in 3D. Draw a shape, pull it up, round its edges, cut holes into it, and send it to the machine.

Try it: [fluescher.ch/makermaker](https://fluescher.ch/makermaker)

It runs on your computer, also offline, and keeps your designs in ordinary files you save wherever you like. No account, no cloud.

## What it can do

- **Draw and pull**: rectangles, circles, regular polygons, lines (free polygons, bezier curves, round arcs, all in one tool) and spheres, drawn on the ground, on any flat face, on a sketch or on a green work plane (halfway between two faces, say), then pulled into solid bodies. Their faces can be pushed and pulled afterwards.
- **More ways to make solids**: revolve a profile around an axis, loft through shapes on several sketches, sweep a shape along a path, bulge a face into a smooth dome or a shaft into a vase, hollow a body into walls (shell), offset outlines, mirror shapes and bodies.
- **Real threads**: click a hole's or shaft's edge and get an ISO metric thread cut into it, ready to print.
- **Round, chamfer, cut and join**: fillets and chamfers stay editable; bodies cut, join or intersect each other and stay movable while they do.
- **Repeat and fit**: patterns (grid, around an axis), linked copies that change together, box joints between two boards, a coat that thickens a body all round, draft angles on faces.
- **Cut in two**: split a body along a plane (turned around any edge), a sketch line or shape, a ball or a cylinder; keep both halves or just one.
- **Type instead of fiddling**: every number can be a unit or a formula with named values (`2*$ply + 10`); change `$ply` once and everything that uses it follows. Names complete as you type.
- **Snap to what matters**: corners, centres, middles, crossings, evenly spaced points along any line, and guide lines that extend an edge across the whole view.
- **Move precisely**: drag along an axis, or press X, Y or Z (M: all three) and type a distance; rotate around any edge, line, circle or point; align parts to each other. Press T to take a distance from something you click, and calculate on with it (`T/2`).
- **Joints**: hinges and sliders between parts, played back with ease in and out, and you keep modelling while a lid stands half open. Parts can also be entangled to move as one.
- **Check before you build**: interference and clearance between parts, also along a joint's way; measure distances, lengths and areas from the real geometry.
- **Look inside**: section views along X, Y, Z and any face, on the fly.
- **Groups**: nest, fold and turn groups of parts with their own origin; sketches are sketch groups with nested sub-groups, opened by double-click like in Illustrator.
- **Import** with the import button or by dropping a file:
  - **STEP** (`.step`, `.stp`) becomes a real solid: round and chamfer its edges, cut or join it with other parts, sketch on its faces, export it. It has no history to edit, and its faces cannot be pushed or pulled yet.
  - **Native CAD files** become STEP solids the same way: Fusion (`.f3d`, `.f3z`), SolidWorks, CATIA, Inventor, FreeCAD, Rhino, IGES, ACIS and more, read by [cadmpeg](https://github.com/cadmpeg/cadmpeg). Shapes, colours and components come across, sketches and history do not. The first such file loads a 72 MB reader.
  - **STL**, **OBJ**, **3MF**, **GLB** and **SketchUp (SKP)** stay meshes: move, group, colour, section and render them; no cutting, joining or export yet. Tiny meshes (no unit in the file) are scaled up, the scale stays editable.
- **Export**: STEP for other CAD tools, STL or 3MF for the 3D printer (each part checked first), SVG or DXF outlines for the laser (kerf allowed for); a sketch as SVG or DXF.
- **Render**: snapshots and nicer path-traced renders of saved views, queued, downloaded automatically, and rendered again on demand when the model changed. Materials, light and photo backgrounds.
- **Script it**: a Python terminal (with an editor and your script folder) drives the same commands as the buttons; Space opens a command box for every tool by name.
- **Keep track**: versions saved inside the file, autosave, extra views side by side, copy and paste between tabs.

## Get started

Open MAKERMAKER in a Chromium-based browser (Chrome, Edge, Brave, Arc). Draw a rectangle with R, pull it up, click to finish. The bar at the bottom always says what the keys and clicks do right now; Settings → Hotkeys lists every key.

To run it yourself, see [STATUS.md](STATUS.md#develop).

MAKERMAKER is young: some parts are proofs of concept, see [STATUS.md](STATUS.md) for what works and what is planned.

## Why not Fusion 360?
Inconsistent tools, fragile semantics, poor interoperability/lock-in, and geometry editing that is much less direct than it ought to be, too much state/history management where no history is wished for.
- No subscription, no account, no cloud: Your designs are files on your disk, and it works offline.
- Consistent user interfaces
- Less clicking: Tools stay on until ESC, works tool first or object first, values are typed in place without dialogs
- Select an object that is BEHIND the thing in front
- The view cube does not freak out.
- A render pipeline that actually works: Queued renders of saved views, automatic download, a history of results per view, and one click to render a view again with the model as it is now.
- Actual keyboard controls
- Every hotkey can be changed (Settings → Hotkeys)
- Smart and automatic exports for laser cutters, 3d printers
- Parametric fillets! Parametric chamfers! They are steps of their own, so you change them after the fact and still have the geometry under them. Because chamfers are what separates us from the animals.
- If a value is too big, assume the biggest working value
- Negative boolean objects!
- No user interface overlays the thing you want to change.

# Things to check by hand

Newest work first. Test files: `node scripts/make-test-lamp.mjs` writes testdata/desk-lamp.mmk; the sample (npm run dev) has the named test bodies. Failures go to [looseEnds.md](looseEnds.md); a passed item is marked `[x]` and stays where it is.

## For a guided (voice) QA session

1. One small test at a time, slowly, naming the tool, the mode and exactly where to click, press, drag or type; wait for the answer. "Repeat" repeats the same test with pauses; asked for the goal, explain it.
2. This list is the specification: do not invent behaviour or tests. An exploratory check is not a failure just because nothing changed. A request for new behaviour goes to looseEnds.md only, not here.
3. An item passes only when all of it was confirmed: mark it `[x]` in place. Partly confirmed: split it in place into an `[x]` line for what passed and a `[ ]` line for what is open. Obsolete (the tester says so): mark it `[x]` and end it with "(obsolete)".
4. A failure: leave the item `[ ]` with "(fails, see looseEnds)", add to looseEnds.md what was done, seen and expected (user-observed, not reproduced).
5. Write both files about every six tests, or when asked or stopping; say so only once written. Short replies: pass / fail in one sentence, then the next test.

## New since 2026-11-07 17:00

Loose ends fixed 2026-11-08:

- [ ] Distance measure on an Alt-picked round rim (also picked first): Ø and Circumference (part of a circle: Arc); Info shows Ø for it too
- [ ] Distance measure: areas in cm², volumes in cm³ in a mm document (as Info); a body's Info says Surface area (all its faces, not one face's Area)
- [ ] Distance measure on a selected sketch rectangle: L, W and Perimeter
- [ ] Revolve, Sweep and Loft picking a shape: a click inside a closed shape picks it too, not only its outline
- [ ] Rotate: Set bodies (beside the axis buttons): the turn so far goes back, clicks pick what turns (again: dropped), Enter turns those around the same axis
- [ ] A circle, rectangle or polygon started on an off-grid point (a body corner, say): its size grows in whole steps (1, 2, 3 mm), not 0.37, 1.37 …; snaps still win
- [ ] testdata/online_file.mmk (a sweep along a bezier): right after opening, a drawing tool follows the pointer fluidly, draws, Esc ends it
- [ ] Grey top-bar notes ("Imported …", "Saved …") go after 8 s; red ones after 5 s; one to click ("Click: Open … again") stays
- [ ] Zoom to Fit (F) after zooming far out or panning away: the model centred and framed, the view direction kept
- [ ] Switching the document between mm and inch leaves work planes the same size
- [ ] Section view with the sample's Glowing pin shown: dragging a section slider cuts the bodies (it used to throw and stop)
- [ ] Negative sizes, typed: H −40 at Z 0 → H 40, Z −40 (a body drawn on the ground); L or W −30 → 30 on the other side of the reference point (centre: as big, centred); one undo step each
- [ ] Pattern grid, Linked off: the originals and copies end up in one group "Grid" where the first original was, nothing moves; Linked on: no group

Selection first, then the tool:

- [x] Mirror with a group selected (its bodies), an Alt-picked face (the plane)
- [ ] Mirror with a whole sketch selected (its shapes), an Alt-picked edge (the line); an Alt-picked face alone: its body mirrored across it
- [x] Sweep: one open and one closed shape or sketch selected: sweeps at once (the open one the path); two closed: the first is the path
- [x] Measure with Alt-picked edges (a rim whole) or faces, a sketch's shapes (a circle's Ø and circumference, else the perimeter), bodies (L / W / H and volume) selected: values at once
- [ ] Revolve with only a line (a construction line too) selected: it is the axis, all the sketch's closed shapes turn, the panel at once; an Alt-picked edge as the axis
- [x] Rotate: an Alt-picked edge first is the axis (a round one: through its centre), turning starts at once
- [x] Pattern with a group selected (its bodies)
- [ ] Pattern with an Alt-picked edge: Around at once, that edge the axis
- [ ] Coat with a group or several bodies selected: each gets a coat; the panel sets thickness and corners for all (no faces, no New body)
- [ ] Coat with an Alt-picked face: its body, that face left out
- [ ] Offset with a whole sketch selected: all its shapes; Shell with Alt-picked faces: those left open
- [ ] Cut with a selected sketch, a work plane or an Alt-picked face: that is the cutter, the panel at once; groups count as their bodies
- [ ] Loft: two or more sketches selected, K: made at once, in the order selected

Groups, origins, view:

- [ ] Custom group origin picked in the view: orange axes where a click would put it, a face turns Z out of it; the contents stay where they are (also typed, also back to the parent's origin)
- [ ] A group selected or entered: grid, origin axes and view cube follow its origin; the camera rolls to it smoothly
- [ ] Sample "Turned group": inside it the view stands upright to it and orbits around its Z; cube sides, turn arrows and cube drags in its axes
- [ ] Inside a turned group: the move gizmo, drags and their steps, X / Y / Z fields, To object and point to point go along its axes
- [ ] A group with its own origin selected, New sketch: the sketch goes into it, on its base planes at its origin
- [ ] Origin axes keep their size on screen at any zoom
- [ ] Cog after Ortho | Persp: Grid, Origin and the visual style; the cog as tall as its neighbours
- [ ] Visual styles Shaded, Grey (dark neutral grey), Lines (each body hides only its own back edges), All lines; curved faces show their contours; lines 1.6 px
- [ ] Group view and sketch view follow the visual style: grey in Grey, faint thin edges in Lines and All lines
- [ ] Snapshots leave out work planes and their crossing lines
- [ ] Ground grid follows the zoom (1-2-5, every 5th stronger, the lines through 0 a little stronger); on the Domed plate zoomed far in away from the orbit point it stays
- [ ] An inch document: grid and drag steps in inches (down to 1/64"), then feet
- [ ] Perspective zoomed right onto a small part: nothing cut off; orthographic on a big scene: nothing cut off
- [ ] A sketch on a cube's edge, zoomed right in: its outlines lie on the face, not off it

Settings:

- [ ] Zoom, pan and orbit speed sliders: 0.1 to 8, snap to 1 near it, a reset each; they work in every view and for sideways scrolling
- [ ] General in two columns; Settings, Materials and Versions open a fixed distance from the top, no jump between chapters; titles in the text colour
- [ ] Light → 3D view tab: the preview is the 3D view itself in its visual style; light rows in aligned columns
- [ ] Section sliders: reset with the undo icon; invert with the two-arrow icon, both centred
- [ ] Every checkbox is a switch; Autosave a switch after the file name; dropdown chevrons set in from the edge

Left column:

- [ ] Three tabs (Objects, Aids, Parameters): icon and count centred on one line, the name on hover; a click in the view opens the right tab, a hover dots it
- [ ] Objects: a body's sketches fold out under it; Aids: free sketches, work planes, images
- [ ] The filter over each tab takes typing and narrows at once; Esc clears it
- [ ] All name boxes exactly as wide (booleans, joints, links, box joints)
- [ ] A click on an open group's row does not fold it; its arrow does
- [ ] Dragging a joint's or Entangle's mark onto a row lights the whole row
- [ ] Parameter rows: field, value and delete centred on one line; "Tool bodies" and "Fold all" on one line

Tools:

- [ ] Tool hints in the floating panel's last row, quiet, one line (all of it on hover); a tool without a panel: a hint-only panel whose × ends the tool as Esc; Mirror's Linked panel does not cover the hint
- [ ] Hints end in "[Enter] Finalize"; pick lists say "(a second click drops it)"
- [ ] A click on a work plane in the view selects it (in front of the body there); Tab / Shift Tab cycle bodies and work planes under the pointer, nearest first
- [ ] Line tool: the line being drawn snaps along its own sides, their middles, A / Shift A, crossings
- [ ] failed2.mmk: the circle with the spike extrudes as one solid; a line crossing itself closes two areas that extrude
- [ ] Draw a rectangle on a box's top and pull up: the label says Join, the box grows (one body); pull down: Cut, a pocket; a tap of Alt switches Join / Cut / New body (Cut only where the pull overlaps the box; the tag in the label its coloured icon and ⌥); Alt held still pulls both ways
- [ ] The same on a box's side face, and with Extrude (E) on a sketch on a face
- [ ] Click the pocket's wall: it lights orange, the hint names the step, Del removes the pocket
- [ ] History in the card: folded, opens with a selected step; an open step's card stands in its row (click the title: close); drag a row to reorder; × deletes
- [ ] Boolean a cylinder into a block, Fold it (card or History): it leaves the list, the hole stays; Unfold lists it again; Fold refused for a tool in a joint
- [ ] A rectangle's R, chain broken: four R fields where the corners lie; one too big rounds that corner as far as it goes, the others as typed
- [ ] Body card: "+ Fillets and chamfers…"; no corner R from its sketch shape there; a body from a shape with holes shows plain Dimensions
- [ ] Fillet or chamfer too big for some edges (Cut block, Frosted plate R 32): edges with room get the full size, the others as much as they take, held ones orange; Split off gives them their own step; no broken or outward rounding
- [ ] Fillet row: one centred line, edges All / Top / Bottom / Vertical / Picked, Bake as tall as the fields
- [ ] A huge fillet or a thread: "Creating geometry…" in the top bar after a moment
- [ ] Bulge tool on a bulge's face opens that bulge's panel, no second bulge
- [ ] Disc: Alt-click its bottom edge from above: it stays picked
- [ ] New bodies named after their tool: Loft n, Sweep n, Ball n, Bulge n; extrusions and revolves Body n
- [ ] Entangle: two or more selected, the tool: attached at once, a green note; none selected: click them, Enter; anchor where they meet; joints named "Entanglement n"; the icon reads well
- [ ] Coat card while faces are picked: the real thickness, "(hidden while faces are picked)"
- [ ] Box joint between plates at a slant: as many fingers as upright
- [ ] Thread panel: Modelled or Pilot (a shaft: Plain), last choice kept; a pilot hole at tap-drill size, the thread dashed; sizes end in Custom (only then Ø and Pitch)
- [ ] Thread tool on a thread's groove, pilot hole or shaft opens its panel; History rows of thread, bulge, draft and box joint open their panel
- [ ] Thread on a filleted body (Vertical edges, unbaked): builds quickly, no tiny dark fillets; a threaded cylinder cut by a ball builds
- [ ] Info panel: picked edges' length and Ø and faces' area without ~; says why when values come from triangles; no question-mark pointer; a square box
- [ ] Offset that makes a shape vanish (inside a small arc, say): the tool says so
- [ ] SVG and DXF import keep arcs and curves (a rounded rect, an ellipse, a spline); laser export keeps arcs (SVG arcs, DXF bulges), opens at true size in Illustrator / LightBurn
- [ ] Renders: Save to with the real folder picker and its permission prompts (tried headless only)
- [ ] Live render view (tried headless only)

## Check these first: never run in a browser

Only typechecked or tested at kernel level, or impossible for a test browser.

- [ ] Top bar: Export STEP right after Import, an arrow going out; terminal right after Autosave
- [ ] Selected shape: box handles only while the pointer is over its box
- [ ] Import a .3mf and a .glb: size right, units dialog
- [ ] Terminal: colours, `cad.` lists commands, Tab takes one, hints inside `cad.box(`; Enter runs at the prompt
- [ ] Endless loop: page stays free, Stop or Ctrl C ends it, Python starts over
- [ ] Terminal icon over the scripts closes and opens the prompt; the border to the scripts drags; width survives a reload
- [ ] Offset on a slot, a line with arcs, a bezier: outside, inside
- [ ] Arc tangent at both ends between straight sides: dragging its middle slides both ends along the sides
- [ ] Corner radius R on a curved polygon, extruded
- [ ] Fillet "Vertical edges" on a shape with tangent arcs: no fillet on the seams
- [ ] Click a bezier handle: type a length, Tab, an angle, Enter
- [ ] Run the "Sort by volume" example on the sample: a row along X, one zip of pictures, one undo
- [ ] Drop a .py file on the view from the Finder: the terminal opens with it
- [ ] Drop a folder on the view: the note says it is a folder and where to drop one
- [ ] Drop a .txt or .zip on the view; a broken .mmk; a broken .3mf: each note names the file and the reason
- [ ] Click a red note in the top bar, a card's error, a terminal error: the full text is in the clipboard
- [ ] Distance measure: Alt-click a round edge of a Ø50 cylinder: the whole rim, 157.0796, lit whole while hovering; a round face's area
- [ ] Distance measure: points on a round edge and a round face, a curved sketch line: L as expected; section and crossing lines show ~
- [ ] Info panel: ~ on measured values, none on position and turn; the info icon's tooltip; no icon on a rectangle sketch
- [ ] T on a round edge or face, in: a position field, drawing a circle, a pull, a move field: the value lands on the true curve
- [ ] Draw on a sketch circle or an arc, and from a round body edge on its plane: the point lies on the curve; a line crossing a circle snaps to the true crossing
- [ ] Open or drop a big file: the loader bar shows until it is built
- [ ] Image: click in the view selects, empty space deselects; list click selects, again deselects; ⌘-click adds; a body in front wins
- [ ] Body, sketch and plane rows: clicked again while alone selected, deselected (a sketch drawn in is left); a tool waiting for a pick still takes it
- [ ] Image: Alt on a corner resizes from the middle; the rotate icon turns it with the pointer, the orange arc, Shift steps, typed, Esc back
- [ ] Top bar: materials and light / dark swapped; beside the material list an icon, "Edit material…"; dialog's × shows; Plastic, light grey in the list with its picture; light preview teapot in it
- [ ] Drawing: G on a corner: X and Y guides through it stay; G again: they go; the pointer's note says so
- [ ] A and Shift A on a rectangle's side, a line, a circle, a body edge (in the plane and off it), also with a guide lying on it: dots, and "n points" at the pointer
- [ ] A and Shift A in the Distance measure and To object: anywhere on a line or edge, also on 1/2
- [ ] A with nothing to split: a note in the top bar
- [ ] Helper line on a real line: only "on line"; beyond the line: "on guide"
- [ ] Before drawing, where a sketch line lies on a body edge or at 1/2: Tab goes through them; while drawing Tab stays the other field
- [ ] Drag a tool body out of its boolean in the list, to the top and into a group: still hidden, red when selected, red icon in its row; moving the body takes it along and the cut stays; dragged back by the body it sits under it; undo
- [ ] A at a side's 1/2 with something else near (the origin, a corner): the side stays, "Split in 3", more A and Shift A go on working; corners still snap once the pointer moves
- [ ] A on a rounded body edge: dots along it, on the true curve; leave the line and come back: the dots and "Split in n" are there
- [ ] A tool body listed elsewhere: red icon and eye; eye on: red outlines all the time; eye off: only while selected
- [ ] Settings, Materials and Renders all close with the same icon
- [ ] Hover a body with booleans or a tool body in the list: the other side colours in the list and outlines in the view
- [ ] Versions: the clock-backwards button: list, click one shows it, Now back, Restore, Enter, Esc, undo after; a saved file with autosave gets a new one after 5 minutes
- [ ] 3MF and GLB with several parts: a group, names, colours; the size dialog scales all; one part: a plain body
- [ ] Interference Everything: Stop while it checks, then a new value checks again; close while checking
- [ ] Dragging a point on a rounded line or polygon: tangents stay, also two arcs in a row and a fillet's end sliding; a corner stays a corner
- [ ] A side with a formula on a polygon or line: change the parameter: what follows moves along, a rectangle stays one
- [ ] Coat a rounded block, exclude a flat side: no horns left
- [ ] Sphere: O, then Alt or O again cycles centre / two points / three / four / three planes with the note top left; points in space snap with names, on corners and faces, orange ball previews; three planes in a box corner: moves along, type a Ø, Enter; Backspace, Esc; next sphere keeps the mode
- [ ] Coat: the icon on a selected body, or clicked next: shown at once, a floating panel; thickness live; sharp and round; Select faces to exclude: a flat face stays, again: back; a curved one says so; Enter keeps, Esc drops; the card's ✎ opens it again
- [ ] Coat with what comes after: fillet, cut, move; sample's Coat cubes are 7 mm
- [ ] Interference and clearance on the sample's last row: Overlap A and B red with the rest see-through; Gap A and B clear at 0, red at 0.1 with "0.05 mm apart" and the green zone; Hinge arm hits "In the arm's way" at about 30°
- [ ] A joint at any position, playing or stopped: the orange space it goes through and the red in its way stay the same; a thin part in its way is found
- [ ] A joint's clash in the list: Cut A and Cut B beside Ignore; after either the part passes free through the whole move; the card says along the joint
- [ ] Coat, Select faces to exclude: the coat disappears, clicked faces orange, reopened: the earlier ones orange too; Done with faces or Esc: the coat back
- [ ] Cut with clearance on: the gap stays, its Clearance field in the cut's card; off: exactly the other body
- [ ] Python: `await cad.check(clearance=0.5)`, the example Check clearances; Stop while it runs
- [ ] Tabs of the right drawers on top of the joints when open, in place when closed; with the terminal open too
- [ ] Hover a red part: its tooltip; click: its row lights; Cut from A / B: the cut, the other body stays; Ignore; X-ray off; Esc and × close and everything looks normal again
- [ ] Tool bodies left out, their cuts count; a hidden body and a mesh: said in the panel
- [ ] Example scripts: listed above Choose a folder, also with a folder open; edit and rename stay after a reload
- [ ] Delete an example: Undo brings it back; deleted it stays gone after a reload
- [ ] A folder file named like an example: only the file shows
- [ ] Open a script: it fully covers the prompt, closing it brings the prompt back; its bar shows a run's last line and Stop
- [ ] R, C, N, L: the mode note pops up with "Change with … or Alt"; it goes when the tool ends; rebound keys show
- [ ] Curved shape: Mirror keeps its curves
- [ ] Curved shape: Copy / Paste, Duplicate keep their curves
- [ ] Curved shape: Rotate tool and the Turn ° field turn the curves with it
- [ ] Curved shape: resize by its box handles scales the curves
- [ ] Curved shape: X / Y / Z fields and arrow nudges move it whole
- [ ] Curved line or shape: save, reopen: curves and handles as they were
- [ ] Revolve a curved outline around a line
- [ ] Loft through a curved outline and a circle
- [ ] Sweep a circle along a line with a bezier and an arc
- [ ] Sweep with a curved closed profile
- [ ] Cut along a curved line: a smooth cut face; with an Offset: still follows the curve (in short pieces)
- [ ] Cut along a curved line: T to a point sets the offset
- [ ] Laser export (SVG, DXF) of a curved body: the outline is right
- [ ] STEP export of a curved body: real curves in another CAD
- [ ] Sketch Offset on a curved line says it does not take them; on curved plus straight: only the straight get one
- [ ] Sample: "Curved outline" sketch is there, extrudes, one smooth side per curve
- [ ] Your own shape from crossing bezier lines: pull it: no stripes, smooth sides
- [ ] A circle crossed by a line: pull one half: round, no facets
- [ ] Picked area of crossing curves with a hole inside it
- [ ] Change a line that closes a pulled area: the body follows, still smooth
- [ ] Real keyboards: `$` on US, UK, DE and CH
- [ ] Scripts: the real folder picker and a real folder in Finder; after a reload whether Chrome asks again (tested only with the browser's private folder)
- [ ] ⌘V with a file copied in Finder (a picture, an STL); a copied picture
- [ ] Sketch shape's turn handle shows the orange angle indicator
- [ ] Lamp with a section playing on a real graphics card; x-ray view (an object of a group active) playing
- [ ] Violet handles readable in the light theme
- [ ] Distance measure: axis lines in colour, as thin as the orange line; thicker on hover
- [ ] Typed labels: no gap between what is typed and the grey rest; axis letter in colour; the caret sits right

## Line tool

- [ ] No Polygon button, P does nothing; ⌘ no longer continues a line
- [ ] One-line mode in the middle of a line: draws the last side and ends it
- [ ] Backspace: after taking a point back, the next angle counts from the side before it
- [ ] Closed inside sketch mode: stays flat, the tool goes on
- [ ] Out and straight back with two points: refused with a hint, drawing goes on
- [ ] [B] on a line: the angle counts from it; rays with Shift; A / Shift A change their step
- [ ] Arc as the first side: start, end, bulge; type a diameter at the bulge
- [ ] Arc on from a line: one click each, tangent; arc on from an arc, on from a bezier
- [ ] Arc: type R, Tab, angle, Enter; R in the note, ∠ at the arc
- [ ] Arc: Shift: angle in steps; straight ahead: a straight side
- [ ] Arc icon: its line runs into the arc tangentially
- [ ] All four mode icons read well
- [ ] D while drawing a line: Distance measure, its Use goes into the length or diameter; Esc goes back to the line
- [ ] Mixed line (polygon, bezier, arc) closes into one area, pulls into one solid
- [ ] Construction lines (Q) with curves: dashed, never extruded

## Lines meeting and snapping

- [ ] Start a line on another's end: it snaps
- [ ] Two lines ending on each other's ends, curves included: one closed shape, pulls exactly
- [ ] One drawn the other way round: joined with its curve right
- [ ] A line ending on a curve's middle: snaps; the area pulls
- [ ] Hover a curve: its middle snaps, the pointer's note shows the lengths on both sides
- [ ] A / Shift A on a curve: more or fewer points, even by length
- [ ] Arc: its centre snaps ("arc centre")
- [ ] Two curves crossing: "crossing" snaps
- [ ] Hovering a curve gives no straight guide; a straight side does
- [ ] Tangent circle: curved sides are not offered as lines
- [ ] Info panel of a curved line: Length along the curve; of a closed one: Area

## Editing points, handles, arc centres

- [ ] Pointer tool, in the sketch: hover a line: its points and handles appear in violet, leaving it: gone
- [ ] A line tool on: none show
- [ ] Moving from the outline to a far handle: they stay while you reach it
- [ ] Works on a line that is not selected; selecting one still shows its orange box handles
- [ ] Drag a point: bezier handles come along, an arc beside it keeps its shape
- [ ] Drag a point near another shape's point: it snaps
- [ ] Drag a bezier handle at a smooth point: the other turns too, its length stays
- [ ] Double-click a point: smooth to sharp, handles free; again: smooth
- [ ] Double-click next to an arc: the arc stays an arc
- [ ] Double-click a line's end: nothing
- [ ] Double-click elsewhere on a shape still opens its sub-group
- [ ] Shift on a bezier handle: angle steps; Ctrl: fine step
- [ ] Arc handle on the arc drags its bulge
- [ ] Arc centre shows with two radii
- [ ] Arc after a line: centre moves only along the normal, stays tangent, the end and what follows move
- [ ] Arc before a tangent side only: the same from its end
- [ ] Arc tangent to nothing: square to its chord, both ends stay
- [ ] Line tool: type `$d*3` as a side's length, `$d` as an arc's diameter; change $d: the points follow; L / Ø fields show the formula
- [ ] Selected line or polygon with arcs: Ø in the side panel, typed and scrubbed, one undo step; several arcs: Ø 1, Ø 2 …
- [ ] Click the centre: it follows, type a diameter, Enter; or click to end; Esc puts it back
- [ ] Drag the centre: radius on the zoom's step, Ø label; undo is one step
- [ ] Polygon with Turn °: points edit right, Turn goes to 0, nothing jumps
- [ ] Corner radius field hidden on a curved polygon, shown on a straight one
- [ ] Rectangular polygon: corner handles are points now; edge handles still resize

## Parameters with $

- [ ] Default document: `$ply` listed, bodies using it build
- [ ] New parameter `thick = 12mm`: becomes `$thick`; `$depth = 2*$thick` works; placeholder `$name = expression`
- [ ] Names starting with any letter, d and t too, type normally there
- [ ] An existing name again: refused with a note
- [ ] A value with bare `ply`: red, tooltip says parameters start with $
- [ ] Old .mmk file: refused, naming the schema
- [ ] Side panel value: `$` shows the first name in grey, Tab writes it out with a space
- [ ] `sqrt(`, `max(`, `pi` still work
- [ ] In a value field: T and D fire when not in a name, including right after `5mm`; inside `$thick` they type
- [ ] Move fields: X / Y / Z inside `$xyz` type; otherwise switch field
- [ ] Rectangle W, H: grey rest, Tab accepts, Tab again switches side
- [ ] Circle Ø, regular polygon Ø and Sides by parameter
- [ ] Line length, arc diameter; pull depth and Back; T and D inside a name in a pull type, outside fire
- [ ] Extrude tool's pull the same
- [ ] A fillet dragged: type `$` in its label, Tab
- [ ] Move by dragging, resize by a handle: typed `$`, Tab
- [ ] Revolve angle, joint position, import Size fields, laser Kerf: grey completion
- [ ] Python: `cad.parameter("ply2", "4mm")` makes `$ply2`; `cad.box("$ply2", 10, 10)`
- [ ] Desk lamp: change `$base_d` and `$plinth_w`

## Distance measure

- [ ] Named Distance measure on its button and in hints
- [ ] D opens it anywhere; D again closes; Esc closes
- [ ] D in a value field: opens for that field; Use puts the value in
- [ ] Two points on all axes: X, Y, Z lines from the first to the second, orange straight line; buttons X Y Z L
- [ ] Two points on one plane: only those two axes; on one axis: the orange line, one button named by its axis
- [ ] Values always positive: shown, copied, used
- [ ] Hover a button: its line thickens; hover a line: its button gets an orange outline
- [ ] Pointer note over a line: "Click: Copy X" (waiting field: "Click: Use X")
- [ ] Press a line: copies, button says Copied ✓; waiting field: goes in, tool ends
- [ ] Near a line's corner, an edge's middle, a centre or its ends: a click takes the point instead
- [ ] Pointer becomes a hand over a line, normal again after it
- [ ] Alt-click an edge or face over a line: still picks those; totals with Shift Alt
- [ ] Measure a value while drawing a rectangle: the size takes it, typing goes on

## Python terminal and scripts

- [ ] Tab next to Joint animation (or alone if no joints); I and the top bar button open it too
- [ ] Open: across the view, Section view and Joint animation ride up on top; Esc closes, all back down
- [ ] Top edge drags the height, the others follow; limits at both ends
- [ ] Joint animation open beside it: its panel stands over its tab, nothing overlaps wrongly
- [ ] Columns 2:1; a window much narrower still works
- [ ] First open: "Loading Python…", then "cad is ready"; offline after one load
- [ ] `cad.box(80, 60, 40)`, `2 + 2`, a `for` block (Enter goes on, blank line runs), Tab completes, ↑ ↓ history, Ctrl L clears
- [ ] `help(cad.box)`, `cad.commands()`, `cad.selection()`
- [ ] A failing line changes nothing, says so; one run is one undo
- [ ] `cad.line(s, points=[[0,0],[30,0]], curves=[{"c1":[0,20],"c2":[30,20]}])`, `curves=[None, {"mid":[0,10]}]` on a polygon
- [ ] Letters typed here never trigger tools
- [ ] First open: "Choose a folder"; an empty folder gets two .py starters; the list shows what is in it
- [ ] A folder with .py files and other files or sub-folders: only the .py files listed
- [ ] Reload: same folder; if the browser asks: one click on "Open <name>" and they are back
- [ ] Folder button: another folder; the list changes, the editor closes
- [ ] Edit a .py in another editor, come back: the list and the open editor show it
- [ ] Add and delete a .py in Finder, come back: the list follows
- [ ] Rename and delete in the app: the file in Finder changes
- [ ] Cancel the folder picker: nothing changes
- [ ] Firefox or Safari: the list says it needs Chrome or Edge; the terminal itself works
- [ ] Click a row: its editor beside the terminal, cursor in it; the row outlined
- [ ] Typing reaches the file a moment after it stops; reload, still there
- [ ] Tab indents; Enter keeps the indent, more after `:`; Esc closes the drawer
- [ ] Play in the row, play in the editor, ⌘ / Ctrl Enter: one undo step
- [ ] Failing script: error in the terminal, nothing changed
- [ ] × in the editor closes it, the script stays
- [ ] + New script opens it; a second is "New script 2"
- [ ] Rename by double-click and by pencil; Enter, Esc, click away; a taken name gets a number; characters like / : ? become -
- [ ] A picked .py file renames on disk too (Chromium with `move`; else the terminal says it cannot)
- [ ] Delete: Undo in its place brings it back; deleting the open one closes its editor
- [ ] Download: a `<name>.py` with the text
- [ ] Upload button: several .py at once, a taken name gets a number, the last opens
- [ ] Drop .py files on the list: scripts, not an import or a design load; drop elsewhere still imports

## Speed

- [ ] Lamp: play a joint: fluid; Repeat on for a while
- [ ] Lamp with its section on: fluid; the caps and outlines follow the moving parts
- [ ] Lamp with the work plane: its green lines follow a body moving through it
- [ ] After playing: snapping to where bodies cross works
- [ ] Autosave on: playing on Repeat writes nothing; a single play saves once after it stops
- [ ] Big model: loading in lots, one redraw per lot; hover and selection outline stay quick
- [ ] Settings: Mesh detail 0.02 to 0.12 mm changes the mesh

## Angle control, panels, edge references

- [ ] Rotate, Cut Turn °, Work plane, Draft, Revolve, Pattern Angle and Turn: same orange arc and value at the part
- [ ] Turn button in those fields: pointer turns; click keeps, Esc puts back
- [ ] Cut and Work plane: picking an axis starts turning at once
- [ ] Shift, A / Shift A, Ctrl, digits and T work the same in all of them
- [ ] Body and group Rotation fields show the arc while in use
- [ ] Position and Rotation one aligned block; extrude card: Add / Cut buttons, aligned rows; link button
- [ ] Fillet a picked edge: change depth, width, length: it stays on its edge
- [ ] Delete what the edge was on: the card says how many are gone
- [ ] A curved picked edge after a notch splits it: found again
- [ ] Shell a loft whose outlines were picked top down
- [ ] Desk lamp: 25 bodies, no errors; drawer slide, arm hinge, head tilt play

## Bug fixes from the last list

- [ ] Measure tooltips say "Click: Copy"
- [ ] Image opacity and transparent key sliders drag, not clipped
- [ ] ⌘V: a copied picture, copied file, copied objects: each does its own thing
- [ ] Shell Wall: T and D; every length field in tool panels has the D button
- [ ] Light tabs (3D view, Rendering): teapot in metal preview; follow camera, camera light, standard light, haze, fog

## Images

- [ ] Selected image: drag on its plane, letting go opens X / Y / Z with the distance (Enter keeps, Esc puts it back); corner handles keep proportions
- [ ] Drag selected sketch shapes: the move fields open and follow the drag, Enter moves, a slanted sketch's shapes stay in its plane
- [ ] Move and Rotate open their fields, arrows nudge
- [ ] Enter skips calibrating; first point gets dashed guides, the second snaps to them
- [ ] ⌘V imports a picture at the pointer; images in nice renders

## Materials dialog

- [ ] List with teapot pictures, sections, search; In this file on top
- [ ] Slider between 3D view and render picture
- [ ] First slider move on a standard one makes "<name> copy"; a file's material changes everywhere
- [ ] Steel, Bronze, Brass, POM-C black there; MaterialX import
- [ ] STEP import: materials smooth unless the name says rough; acrylic clear

## Views and layout

- [ ] Section view and Joint animation drawers: titles low, Section view open at first, remembered
- [ ] View borders drag in all directions; four views a 2 x 2 grid; saved per browser
- [ ] View header: Ortho | Persp left, side, swap, close in the middle; read only note right, in italics
- [ ] Left column: lists reach the edge, scrollbars clear of the eyes
- [ ] Colour fields as pills, info box at the bottom of its column, hotkey buttons square
- [ ] Settings remember the chapter open and how far each is scrolled
- [ ] Drawing mode note below the breadcrumbs, 3 s
- [ ] Photo spheres: built-in ones listed, reverse order, 70° height same in view and render

## Drawing aids and small tools

- [ ] Tangent circle: dashed bisector, snaps like a guide, G keeps it; clicks not refused early
- [ ] Drawing tools and the section pick light a hovered work plane
- [ ] Draft: drag its body for the angle, angle snaps; off while Set axis picks; icon shows one side drafted
- [ ] Sample: a slanted work plane
- [ ] Selected body in a group shows through the rest; sections only touch what they cut

## Files

- [ ] STEP import: groups per product, named bodies per solid, colours, materials
- [ ] Closing or reloading with unsaved changes asks first
- [ ] Long texts once in blobs/ across versions: file stays small with many versions

## Materials, light, photo spheres

- [ ] Body: Material list → + New material; colour, Bumpy, See-through, Glow, Thickness apply at once
- [ ] Group material: bodies inside take it, a body's own beats it; several selected: one material for all
- [ ] Thickness differing: the red note on the card; Delete a material: bodies go back
- [ ] Settings → 3D view: sun and ambient sliders change the view live
- [ ] Photo sphere: + adds one, Turn spins it, orbit follows, ortho and persp both right; render shows the same photo
- [ ] Render card: Light and photo saved with that render, Render again uses them; save, reopen, still there

## Cut tool

- [ ] Turn ° plus Set axis: an edge, a sketch line, a circle (its centre) as the axis
- [ ] Set axis, then Esc: only the pick ends, the panel stays
- [ ] The chunk to be deleted shows red and see-through
- [ ] Delete A: what stays keeps the body's name and colour
- [ ] Delete B / Keep both
- [ ] Cut with a ball (click "Ball" after picking the body)
- [ ] Cut with a cylinder (click "Pin" after picking the body)
- [ ] Offset scrubbed by its label; T to a point (plane, line, ball, cylinder)
- [ ] Esc leaves the body as it was; ⌘Z after a kept cut

## Rotate (W)

- [ ] Tool first: W with nothing selected, click a body, then the axis
- [ ] Selection first: select, W, then the axis
- [ ] Nothing turns before the axis is clicked
- [ ] Axis on an edge, a sketch line, a circle or round edge, a corner (Z)
- [ ] Clicking the corner again: X, then Y
- [ ] Pointer turning: 1° steps, Shift angle steps, Ctrl minimum angle
- [ ] A / Shift A change the step; the grey ticks follow
- [ ] Typing digits goes into Turn °; scrubbing its label
- [ ] X / Y / Z keys and buttons
- [ ] T: two clicks (where it is, where it goes) put their angle into Turn °
- [ ] A group turns as one; a body with tool bodies takes them along
- [ ] In a sketch: shapes turn around the clicked point
- [ ] Enter / ✓ / click keeps it; Esc puts it back; ⌘Z
- [ ] Sketch shape selected: the blue rotate handle's line reaches to its centre dot

## Joints (J)

- [ ] Tool first: J, click the parent, click the moving objects, Enter, click the axis
- [ ] Selection first: select parent, ⌘-click the moving ones, J, click the axis
- [ ] Axis on an edge, a line, a circle, a corner
- [ ] The edit panel opens right after making it; Esc removes the new joint
- [ ] Hinge / Slider switch (the name follows if it was automatic)
- [ ] Min and Max: typed, scrubbed; each change shows the pose there
- [ ] T for Min / Max: the moving part points at the clicked point (no small offset)
- [ ] Speed × and Settings → Joint play time
- [ ] ⇄ Invert turns it the other way
- [ ] ▶ Play in the edit panel only shows it (where it is stays)
- [ ] Edit again: joint icon in the list, ✎ in the joints box, Edit on the card
- [ ] Delete (× on the card): the parts go back to where they are without it
- [ ] Joints box: rename in place, range in grey
- [ ] ▶ plays to the max and stays; at the max ▶ plays back to the min
- [ ] ❚❚ pauses, the pose stays (one undo step)
- [ ] Repeat: back and forth smoothly, no jump at the ends
- [ ] Slider and Now field follow the motion; changing either pauses it
- [ ] Hover the joint icon: list rows blue (stays) and orange (moves), outline in the view
- [ ] Drag a joint icon onto another object: it takes that place (parent: the axis stays put)
- [ ] Model on a half-open lid: move it, pull a sketch drawn on its face (the new body moves with it)
- [ ] Group the lid with something beside the box: the group becomes the moving part
- [ ] Sample: Hinge 1 (box and lid), Slider 1 (cabinet and drawer)
- [ ] A body in two joints: reported in the joints box
- [ ] Save, reopen: joints and their poses are back

## To object (T)

- [ ] Same icon and words on every To object button and in the pointer's note
- [ ] Pull a drawn shape: T, click, type `/2`, Enter
- [ ] Pull after Tab (Back): T goes into the back
- [ ] Pull picked areas and push / pull a face: T the same way
- [ ] Drawing a rectangle / circle: T sets the size being typed (off bodies: on the plane)
- [ ] Body position X / Y / Z in the panel: T puts the origin there
- [ ] Group origin (custom) X / Y / Z, section offset, sketch plane offset
- [ ] T in the middle of a parameter name stays a letter
- [ ] Esc while aiming ends only the aiming

## Pulls and drawing

- [ ] The pull's label reads H on the ground, L on a face facing X, W facing Y, Depth on a slanted face (also Extrude on a face)
- [ ] Two separate rectangles pulled together: two bodies; a plate with holes: one

## Left column

- [ ] The eye beside the filter on Objects and Aids hides all; again: the same pattern comes back
- [ ] Hidden list rows go grey

## Move

- [ ] Copy checkbox: the original stays whole, the copy moves, one undo step
- [ ] Copy of a body with a hole on its own face keeps the hole
- [ ] Linked checkbox (see Linked copies)

## Making solids

- [ ] Revolve (U): tool first (click shape outline) and selection first; axis a sketch line or body edge; angle scrubbed; "Revolve me" sample
- [ ] Loft (K): click "Loft base" then "Loft top", Enter; Ruled in the card
- [ ] Sweep: click the path ("Sweep path") first, then the profile ("Sweep profile")
- [ ] Editing the sketch shapes changes revolve, loft and sweep bodies

## Editing

- [ ] Align: two or more bodies, X / Y / Z min, middle, max; distribute with three; middle on first
- [ ] Align whole sketches and groups
- [ ] Offset in a sketch: shapes get outlines outside (negative: inside); lines move to their left
- [ ] Shell: click faces to leave open, Enter, wall thickness live
- [ ] Mirror shapes in a sketch across a line or edge
- [ ] Mirror bodies across a face; a chamfered body keeps its chamfer
- [ ] Pattern grid: counts, gap, Overall, turn per copy
- [ ] Pattern around: axis, count, angle, Turn copies
- [ ] Thread: click a shaft's round edge (Pin): M16 × 2 suggested, length through
- [ ] Thread in a hole (guessed as hole; switch in the card)
- [ ] Thread pitch and length edited in the card afterwards

## Linked copies

- [ ] Duplicate with Linked ticked: editing the copy's steps changes the source too
- [ ] Untick Linked during Duplicate: the copies become independent at once
- [ ] Copy-move, Mirror and Pattern with Linked
- [ ] The link mark in the list on source and copies
- [ ] Unlink in the copy's card
- [ ] Delete the source: the first copy keeps the steps, the others follow it
- [ ] A linked copy of a body with a boolean cut: cut the same way

## Work planes

- [ ] Plane on a face; on empty space (the base plane facing you)
- [ ] Offset with T, then `/2`: a plane halfway
- [ ] Drawing tools draw on it directly; Draw on it opens a sketch there
- [ ] Changing its offset moves sketches on it and their bodies
- [ ] Eye, rename, delete in the list and panel

## Export

- [ ] Export STEP: selected bodies (else all shown) as named, coloured parts; opens in another CAD tool

## Toolbars and grouping

- [ ] Left: sketch, shapes, sphere, plane, group, duplicate, delete; top: everything that edits
- [ ] In sketch mode: shapes left, Extrude / Mirror / Offset / Leave on top
- [ ] Menus (Boolean, Align) open below the top bar
- [ ] Two groups selected, Group: grouped, not ungrouped; one group: Ungroup

## Small things

- [ ] Sideways trackpad swipe does not go back in Chrome
- [ ] Range sliders show no blue outline when dragged or focused

## Extrude rework (5729d80)

- [ ] Nothing selected, E, plain click on a face: pulls at once
- [ ] Nothing selected, E, plain click inside a sketch shape (or on its outline): pulls at once
- [ ] E, Shift / ⌘-click several faces and areas (different sketches too), Enter: all pull by one distance
- [ ] Shift-click something picked again: drops it
- [ ] While picking, Shift-click a sketch in the list: adds all its areas
- [ ] E, plain click on a sketch in the list (nothing picked): pulls all its shapes
- [ ] Sketch selected (not in sketch mode), E: pulls all of it
- [ ] Shapes selected, E: pulls those
- [ ] Sketch mode, shapes selected, E: pulls those; none selected: view tilts, picking
- [ ] Alt-click a face (Shift: more), E: pulls them
- [ ] Flat view: turns angled only when the pull starts (outside sketch mode)
- [ ] Esc while pulling: faces back, picking again; Esc again stops
- [ ] One Cmd+Z undoes a whole mixed pull

## Batch c9d956c + Bulge

- [ ] E with a sketch selected / in sketch mode: its shapes picked (inner ones holes), Enter pulls
- [ ] E with faces Alt-picked first: picked, Enter pulls; Shift-click in the tool: waits for Enter
- [ ] Alt-click a face, Shift-Alt-click faces on other bodies: all picked (blue), E pulls them together
- [ ] Extrude: click a fillet or chamfer: its size drags
- [ ] To object: the centre of a cylinder's top snaps; sketch corners / middles snap; A / Shift A on a line while aiming
- [ ] Hover a sketch group in the list: its shapes orange in the view
- [ ] Sketch mode: the ✓ (leave) is green
- [ ] Rotate: Set axis / X / Y / Z switch, the used one lit, others greyed
- [ ] Section: overlapping separate bodies show a line between, each in its colour; the higher one in the list wins
- [ ] Bulge a flat face (Soft / Tent / Dome / Flat top), a dent (negative), the peak moved (X / Y / To object)
- [ ] Bulge a shaft (the Pin): a vase; a hole: narrows
- [ ] Bulge a sketch shape: a dome body of its own
- [ ] Bulge a face with a hole (the Plate): the hole stays open
- [ ] Line tool: a plain click on a circle is a plain point; Ctrl on it: the note says a tangent; Ctrl-click or right-click, move around: it stays tangent; click: the end
- [ ] Tangent on a short arc, a bezier side, a cylinder's round edge; Shift and a typed angle stay tangent
- [ ] Right-click a face: Look at this face (here) and in new view, both with icons
- [ ] Coat: New body: the body stays, a hollow skin around it in another colour; thickness and excluded faces live; off again: back on the body; Esc: gone
- [ ] Cut: several bodies selected, all cut; ✓: tool stays, all parts selected, cut again; a body not crossed stays whole; Esc ends it
- [ ] Waiting for a body (Cut with none selected, and other tools): the body under the pointer gets its orange outline
- [ ] Custom section: Turn ° slants it, Set axis picks what it turns around, ⇄ the other side of the same plane
- [ ] A two-point line selected or hovered: its two points and the blue middle mark, no box handles
- [ ] Cut, choosing a face: a red plane through the bodies while hovering; a ball or cylinder of another body: its surface
- [ ] A lit face shows over everything, the edges under it visible
- [ ] Coat panel: Thickness, corners, Select faces to exclude (n), New body; Linked appears with it, off first
- [ ] npm run build: starts empty; npm run dev: the test models
- [ ] Box joint: two plates as a T, also linked copies: slots and tabs; fingers about 3× the thickness; touching only: refused with a note
- [ ] Floating panels: the main value first, options after (thread: its size first)
- [ ] Coat: Linked off every time; clicking a checkbox's label shows no outline
- [x] Terminal in a light theme: colours readable
- [x] Choose .py files in the real dialog: they list, edits land in the file; after a reload a click allows them again
- [x] Drop a folder, .py files, and both on the list; a non-.py file gives a note
- [x] Bin on a picked file: off the list, the file stays, Undo brings it back
- [x] L again or Alt: polygon, bezier, arc, back to one line; Shift Alt: backwards; the note top left names each
- [x] Toolbar's line button again: next mode too; its tooltip says so
- [x] Switch mode in the middle of a line (Alt, L): the next side is in the new mode, the line goes on
- [x] Enter finishes open; Esc finishes open; double-click finishes open, no extra point
- [x] With one point: Enter or Esc keeps nothing
- [x] Esc with nothing being drawn ends the tool
- [x] First arc: Backspace takes back its end
- [x] Hover the start with three points: "start: a click closes it", it snaps; click closes
- [x] Closed outside sketch mode: pulling starts; click or Esc keeps it flat and goes into the sketch
- [x] Type a length, Tab, an angle, Enter: the point lands exactly; length and angle labels
- [x] Bezier: plain clicks make a smooth curve through them; the point before bends as the pointer moves
- [x] Bezier: press and drag pulls mirrored handles; shown in orange while pulling
- [x] Bezier: Shift while pulling: the handle in angle steps; Ctrl: fine
- [x] Bezier after a line or arc: starts along it
- [x] Bezier closed on its start: smooth through it; press and drag on the start pulls it there
- [x] Alt during a handle drag does not switch the mode

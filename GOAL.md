# Browser CAD for workshop fabrication

Requirements and implementation outline · 30 October 2026 · decisions added 31 October 2026

Status: planning document. No application has been implemented or benchmarked. Project name is MAKERMAKER. Core architecture decisions are recorded under "Decisions"; remaining open points are listed under "Open questions".

name sugestions:
- makerCAD (but used already by [this](https://github.com/marcuswu/makercad))
- MAKERMAKER (WINS!)

## Purpose

Build a precise, approachable modeling tool for props, fitted parts, and workshop fabrication. Build our own application on an existing geometry kernel (Replicad/OpenCascade) and renderer (three.js), with our own document model and local design files. Reuse pieces from existing browser CAD applications (e.g. ToubkalCAD) where they fit. Take inspiration from Plasticity's efficient interactions while designing around the workflows below.

## Decisions (31 October 2026)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Edge/face references | Rule-based references by default (e.g. "all outer vertical edges", "top edges of profile Y"). Clicked edges/faces as fallback, re-matched after recompute. Ambiguous or lost references are reported, never guessed. On failure: keep the last valid geometry, warn, and offer an explicit one-click "bake" to a non-editable result. |
| 2 | Part core | Each part is a parametric recipe (sketch → extrude → cut → fillet …), recomputed on change, history hidden by default. Direct face edits are supported on both native and imported parts. On a native part, dragging a face first modifies the feature that owns it (extrusion depth, hole diameter, fillet radius …); only when no parameter can express the edit does it become a face-edit step referencing faces under rule 1. On an imported STEP part, which has no feature history, the same interaction is a real B-rep face edit. |
| 3 | Sketching | Parametric primitives first (rectangle, rounded rectangle, circle, slot …) plus simple polyline/arc drawing with numeric entry. No constraint solver at MVP. |
| 4 | Native file | Single self-contained ZIP file. Version history is stored deliberately inside it as JSON snapshots on save plus named checkpoints, capped/compacted. The fine-grained undo stack stays in memory and is not saved. |
| 5 | Browser | Chromium-only MVP (File System Access for save-in-place and safe saves). File access sits behind a small interface so a desktop wrapper (Tauri/Electron) can replace it later. |
| 6 | Imported meshes | Reference objects: display, transform, snap, measure, section views, export. No mesh booleans or mesh-to-solid conversion. |
| 7 | Parameters | General expressions with named parameters and references (e.g. `width = 2 * ply + 10`). Material thickness is one referenceable value; changing a material updates linked geometry. |
| 8 | Instancing | Linked instances: a part definition plus placements; editing one updates all. "Make unique" detaches an instance. Groups have their own transforms and can be instanced too. |
| 9 | Foundation | Start from scratch on Replicad/OpenCascade + three.js. Harvest individual pieces from ToubkalCAD (or others) only where they fit our model; no fork. |
| 10 | Visualization | Screenshots, turntable and dolly clips with "okay-ish" renders. Real-time three.js (PBR, HDRI lighting, shadows) first. Stretch goal: nice renderings via Mitsuba 3 through a local helper process (Mitsuba runs natively, not in the browser). Video via frame-by-frame encoding (WebCodecs). |
| 11 | Value input | Every numeric field accepts a plain number (current units), a number with an explicit unit that may differ from the design's units (`3in`, `12.5mm`), and simple or complex expressions with or without references (`(80 - 2*ply) / 3`). The entered text is kept, so expressions stay live. |
| 12 | Units | Display units can be switched on the fly; default mm. Values are stored in one canonical unit internally; switching units never changes geometry. |
| 13 | Materials and appearance | Optional and lightweight. A material has a name, thickness, color, and appearance (opacity etc.). Appearances also exist independently of materials. An object can have a material, an appearance, both, or neither. Materials can be assigned retroactively (e.g. all 3 mm parts). Low priority compared to modeling and export. |
| 14 | Sketch placement | Sketches attach to faces and follow them. The face reference follows decision 1; a lost face is reported, never guessed. |
| 15 | Laser export | Select one or more objects in the model browser or the 3D viewer, click "Export laser". Objects without parallel flat sides are refused with a message. Every other object is projected along the normal of its biggest flat face, and the projected outline (outer contour plus holes) is exported as SVG. Section views do not produce exportable outlines. |
| 16 | Fillet order | Fillets/chamfers always stay the last layer. A face edit made after filleting is inserted before the fillet layer, and the fillet is recomputed on the edited shape. |
| 17 | Quad view | One viewport or four synchronized top/front/side/perspective viewports. Every view is fully editable (select, draw, drag, edit) at MVP; changes appear live in all views. |

## Output priorities

1. **Laser cutting:** select one or more objects and export accurately sized outlines (decision 15). SVG is the first target, usable in Illustrator; DXF is desirable. Preserve circles and curves where supported rather than exporting display triangles (exact curves come from solids; meshes can only yield polylines). Write SVG with physical units (`width="…mm"`, viewBox in mm), never bare px. Native Adobe Illustrator format is not required initially. Verify 1:1 scale. Material thickness can drive extrusion depth through expressions (decision 7); automatic fabrication layouts and thickness-driven joint generation require separate scoping.
2. **3D printing:** export solid objects as STL initially; consider 3MF later. Control tessellation quality and communicate export problems.
3. **Visualization:** basic materials, lighting, and recognizable scale references or environments so people can understand object size. Screenshot, turntable, and dolly clip export with okay-ish render quality (decision 10).
4. **Paper drawings:** printable views with scale, dimensions, and page layout.

## Operating principles

- Browser application, usable from a hosted website or a local server. Modeling calculations run on the user's computer. Hosting must not imply uploading designs.
- MVP targets Chromium-based desktop browsers only. Other browsers are not supported at MVP.
- Fully offline operation once the application and its required assets have been installed or cached; explicitly test offline startup and use. No account, cloud project system, or remote geometry service required.
- Ordinary local design files: open/import or drag a file into the application, edit, and save it in place via File System Access, with an open/download fallback.
- All file access goes through one small interface (open, save, backup) so a desktop wrapper can provide native filesystem access later.
- No internal cloud-style file browser. The operating system manages folders and projects.
- Local files and offline behavior are requirements; Finder double-click integration and a desktop wrapper are deferred but planned for.

## Modeling behavior

Each part is a parametric recipe with hidden history (decision 2). Direct manipulation is the default experience: dragging handles and faces in the viewport edits the recipe's parameters where a parameter exists (e.g. dragging an extrusion's cap face changes its depth), and appends a direct face edit step where none does. Editable dimensions and modifiers remain available without forcing the user to navigate a long history tree.

- Parametric sketch primitives (rectangle, rounded rectangle, circle, slot …) and basic polyline/arc geometry with numeric entry; extrusion, hole cuts, basic solid booleans, direct face edits, and transforms. No sketch constraint solver at MVP.
- Multiple independently selectable parts, each with its own local origin and associated sketches. Sketches attach to faces and follow them (decision 14).
- Groups with their own transforms.
- Linked instances of parts and groups: one definition, several placements; edits propagate to all instances; "make unique" detaches one.
- Preserve meaningful primitives: a rounded rectangle retains width, height, and corner radius.
- Every numeric value can be a number, a number with a unit, or an expression referencing named parameters, other dimensions, or material thickness (decisions 7, 11). Display units switch on the fly, default mm (decision 12).
- Non-destructive edge finishing is a must-have: retain the underlying shape and allow fillet radius or chamfer depth to be changed or disabled later. Make original geometry available as a reference when needed.
- Editable fillets/chamfers always form the final finishing layer (decision 16). This is not permission to silently bake them into the base shape; baking happens only as an explicit user action.
- References to edges and faces are rule-based by default, with clicked selections as fallback (decision 1). Stable references after arbitrary topology-changing edits remain a major technical risk. Unsupported or ambiguous references must be reported rather than reassigned silently; a failed recompute keeps the last valid geometry.
- Imported STEP solids have no recipe; direct face edits are their main editing path.
- Optional relationships between parts are a later goal; do not make every operation depend on a global constraint system.

## Interaction and workspace

- Consistent selection rules across commands. Accept valid preselection and allow command-first selection; do not silently discard compatible selections.
- Tools retain their explicitly selected purpose. Invalid target types receive clear feedback instead of silently switching to another command.
- Unified import entry point with consistent behavior across formats, while exposing format-specific options where needed.
- Fast, configurable keyboard shortcuts and direct numeric entry. Minimize modal dialogs and repeated confirmation clicks.
- Explore a single edge-finishing interaction with explicit rounded/chamfered modes and directional dragging, inspired by Plasticity. Provide visible mode/value feedback and numeric input.
- Quick selection of obscured objects, for example through cycling or a pick list.
- Modular workspace supporting one viewport or synchronized top/front/side/perspective quadrants. Drawing in a view uses an explicit, understandable work plane, with changes visible in other views.
- Separate model/part organization, optional history, object properties/dimensions, and view settings. Do not mix everything into one expanding tree.
- Hide history by default without deleting the data needed for editability. Support useful visibility controls for parts and sketches without requiring hundreds of manual toggles.
- Important: X/Y/Z section views on the fly, also on custom planes, for solids and meshes. Sections are for viewing only, not laser export.

## Geometry strategy

Build our own application on Replicad/OpenCascade for geometry and three.js for rendering (decision 9). Do not fork an existing CAD application. Inspect ToubkalCAD and similar projects for reusable pieces (kernel integration, picking, selection, rendering helpers) and adopt them only where they fit our document model; check each piece's license before reuse.

Use one existing geometry kernel initially. Do not write a new general-purpose CAD kernel. Keep kernel calls behind a focused adapter and keep application intent outside opaque kernel objects. Future kernel replacement is a goal, not a promise of automatic compatibility: topology, tolerances, edge identities, and available operations differ.

Architecture direction: the document is plain, immutable data (recipe, parameters, references, instances). Geometry is computed from it in a worker with per-step caching. Undo/redo works on document snapshots.

References:

- Replicad: https://github.com/sgenoud/replicad
- OpenCascade.js: https://github.com/donalffons/opencascade.js
- three.js: https://github.com/mrdoob/three.js
- Mitsuba 3 (stretch goal, nice renderings): https://github.com/mitsuba-renderer/mitsuba3
- ToubkalCAD (source of reusable pieces): https://github.com/ToubkalCAD/ToubkalCAD
- FreeCAD, an established desktop reference: https://github.com/FreeCAD/FreeCAD

## Native design files

Use our own documented, versioned document schema.

Packaging: a single ZIP archive containing JSON document data and supporting assets. Final extension is undecided. Store units, stable application IDs, part definitions, instances and transforms, sketch definitions, parameters, materials, modifier relationships, and references. Kernel geometry and display meshes may be stored as caches or imported source geometry; they must not replace editable intent where it exists.

Version history lives inside the ZIP: a JSON snapshot of the document on each save plus named checkpoints, with a cap or compaction so the file does not grow without bound. Caches are excluded from history. The fine-grained undo stack stays in memory and is not saved.

Define schema versions and migrations early. Save/reopen must preserve dimensions, part placement, modifiers, and relevant settings. Do not serialize transient UI state or the undo stack. Plan recovery from interrupted saves and preserve the last good file.

STEP is an interchange route for precise geometry, SVG/DXF for fabrication outlines, and STL/3MF for meshes. Do not promise recovery of the original parametric recipe from these exports. Imported solids and meshes must be identified as such rather than presented as fully editable native features.

## Import and interchange compatibility

Compatibility is a product requirement, not a claim that these importers are implemented. Use the same open/drag-and-drop flow for supported formats.

| Format | Required direction | Purpose and limits | Stage |
| --- | --- | --- | --- |
| STEP (.step, .stp) | Import and export | Precise CAD solids/surfaces; preserve units, separate parts, placements, and available names/colors where supported. Does not recover original sketches, constraints, or feature history. | MVP |
| STL (.stl) | Import and export | Mesh exchange and printing, including binary and ASCII input. Ask for units when necessary; no standard material/texture support. | MVP |
| glTF 2.0 / GLB (.gltf, .glb) | Import and export | Preferred visual interchange for meshes, hierarchy, transforms, UV coordinates, PBR materials, and textures. Prefer self-contained GLB with embedded resources for easy local transfer. These remain meshes, not precise CAD solids. | Required visualization milestone |
| OBJ with MTL and texture images | Import; export later if useful | Common legacy textured-mesh exchange. Accept related files together or in a ZIP; support a documented material subset and report missing resources. | Follow-up compatibility |
| 3MF (.3mf) | Import and export | Unit-aware print-oriented mesh packaging; support and document the chosen color/material extensions rather than promising every slicer-specific feature. | Follow-up compatibility |
| SVG / DXF | Import and export | 2D curves and fabrication drawings; SVG export first. State supported entities and verify units and scale on import. | SVG export MVP; remaining coverage staged |

For visual interchange, preserve supported materials and textures through native save/reopen, including imported assets. Keep resources inside the local design package so a moved file is not dependent on paths on the original computer. Handle external glTF/OBJ resources through explicit local file selection; do not require a network fetch. Report unsupported extensions or appearance changes rather than silently discarding them.

Appearances (color, opacity, textures) exist independently; a material (name, thickness, color, appearance) may use one (decision 13). Importing an appearance must not assign a material or fabrication thickness automatically. Imported meshes are reference objects (decision 6): mesh editing, mesh booleans, conversion to solids, animation, rigs, and lossless compatibility with every originating application are not implied by format support.

## Stages and scope

### 0. Foundation spike

Set up Replicad/OpenCascade + three.js in a worker-based skeleton that runs offline in Chromium. Prove: sketch primitive → extrude → cut → rule-based fillet → change a base dimension → fillet still lands correctly; one direct face edit survives an upstream change or reports a lost reference; save/reopen of the document JSON. Inspect ToubkalCAD for reusable pieces and audit licenses of everything adopted. Record results.

### 1. Fabrication proof of concept

Draw a dimensioned plate, extrude it, cut holes, move a second part, and export a selected planar outline at verified 1:1 scale. Save/reopen the design. Prove an editable finishing modifier on a simple part.

### 2. Focused workshop MVP

- Dependable sketch snapping, numeric dimensions, selection, transforms, and basic solid operations.
- Parametric sketch primitives; direct face edits within documented limits.
- Multiple parts with local origins and associated sketches; linked instances.
- Value input with units and expressions everywhere; named parameters; on-the-fly unit switching.
- Sketches attached to faces.
- Editable final-layer fillets/chamfers within documented limits.
- Local native save/open (single ZIP with version history), offline operation, undo/redo, and useful failure messages.
- Accurate SVG laser export of selected objects, STEP solid import/export, and STL mesh import/export.
- Section views on X/Y/Z and custom planes.
- Consistent shortcuts and separated model/properties/history/view controls.
- Quad view: one viewport or four synchronized top/front/side/perspective viewports, all fully editable (decision 17).

### Visualization milestone (directly after MVP)

Materials and HDRI lighting, scale references, screenshot export, turntable and dolly clip export; stretch goal: Mitsuba 3 renders via a local helper process; GLB import/export.

### Later releases

Broader direct editing; robust modifier references through more edits; relationships between parts; sketch constraint solver if needed; printable drawings; richer laser preparation; desktop wrapper; additional interchange formats and browser/platform coverage.

Expose operations through a shared command layer so mouse, shortcuts, and potential future automation can use the same behavior. Python/LLM integration is not an MVP deliverable.

## Performance and sample files

Two representative workloads are required; neither is a guaranteed supported maximum before measurement:

| Sample | Requested file | What it tests |
| --- | --- | --- |
| Detailed mesh with 1,000,000+ triangles | Original unsimplified STL or another available mesh format | Parse time, RAM, viewport performance, picking, transforms, sectioning, mesh export |
| Roughly 20 interlocking detailed parts | STEP export of the complete assembly from Fusion | Precise-geometry import, part placement, face/edge selection, supported solid edits, export |
| Optional reference project | Fusion F3D archive, or F3Z for externally referenced designs where applicable | Inspect source construction in Fusion; not a commitment to import Fusion history |
| Textured visual reference | Self-contained GLB, plus an optional OBJ/MTL/texture bundle | Materials, UVs, textures, hierarchy, resource packaging, and native save/reopen |
| Laser reference | A representative SVG/DXF and known physical dimensions | Curve handling, units, holes, outline closure, and export scale |

Keep the originals. For each sample provide a short task description, any known slow operation, expected dimensions/units, and the computer/browser used. Verify exported STEP includes the intended parts and placements. No face-count inventory is required.

STL does not define a reliable physical unit convention: record the intended unit separately. A mesh benchmark does not prove precise-solid editing performance. Do not convert a million triangles into a million CAD faces as the default import path. Advanced mesh repair, mesh booleans, and mesh-to-solid reconstruction need separate scope.

Record opening time, peak memory where measurable, orbit/pan and selection responsiveness, edit/recompute time, save/reopen behavior, and export results. Establish numerical budgets on the target computer after the first measurements rather than inventing guarantees now.

Run geometry work away from the UI thread; avoid unnecessary copies, share geometry between linked instances, bound caches/undo memory/version history, and allow controllable display tessellation. Four views should share model data. Browser memory and kernel build constraints must be measured with realistic files.

## Acceptance checks

1. A dimensioned plate with circular holes exports to SVG at the correct physical dimensions and opens at the intended scale in the target laser workflow.
2. Change a base dimension and a finishing radius, disable/re-enable the modifier, save, reopen, and confirm the same editable result.
3. Select and transform independent parts without unexpected tool changes or lost compatible selections.
4. Undo/redo a representative edit sequence without corrupting document state.
5. Open the app offline after preparation; create, reopen, and export designs without an account or network geometry service.
6. Complete both representative performance workloads and publish measured results and limitations.
7. STEP round-trip preserves test-part dimensions and placement; STL imports at the explicitly chosen scale.
8. At the visualization milestone, a textured GLB imports, survives native save/reopen, and exports with the supported appearance and hierarchy intact.
9. Invalid geometry operations preserve the last valid model and explain the failure; ambiguous references are never silently redirected.
10. Changing a material's thickness updates extrusions that reference it; editing one linked instance updates all of them, and "make unique" detaches one.
11. A direct face edit on a native part survives an upstream dimension change, or reports a lost reference without changing the geometry.
12. Selecting several objects and exporting laser outlines refuses objects without parallel flat sides with a message and exports all others projected along their biggest flat face at correct scale.
13. At the visualization milestone, a turntable clip and a dolly clip export as video files with scale reference visible.
14. Entering `3in`, `2*ply + 1`, or a reference to another dimension in any numeric field gives the correct result; switching display units does not change geometry; save/reopen keeps the expressions.

## Effort

Earlier planning estimate: several weeks for a narrow prototype and approximately 3–6 months full-time for a dependable focused MVP with an experienced developer and AI assistance. This is not a delivery promise. Learning CAD internals, editable topology (especially direct face edits on recipes), and performance may substantially change it; the broader vision can be a year-plus project.

## Open questions

Deferred, ask again later:

1. **Laser export rule details (decision 15):** must the biggest flat face itself have a parallel opposite face, or is any parallel pair enough? Are imported meshes eligible (polyline output) or always refused?
2. **Laser export of several objects:** one SVG with all outlines (as positioned in the model, or laid out without overlap) or one SVG per object?
3. **Mitsuba helper process:** how it is installed and started, and whether the in-browser path tracer (three-gpu-pathtracer) stays as a fallback.

Decide after first measurements or usability trials:

4. Precise modifier limits, native file extension, measured performance budgets, and whether part definitions can be shared across files.

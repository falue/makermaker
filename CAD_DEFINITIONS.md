# CAD terminology and object model

This vocabulary keeps the model simple: sketches, bodies, and groups form the model tree. Drawings describe paper output. Features, materials, attachments, and joints are accessed through focused controls rather than becoming competing organizational hierarchies.

## Core definitions

| Term | Definition |
| --- | --- |
| **Sketch** | Editable 2D geometry on a plane, optionally attached to a face. Shapes retain their meaning: a rectangle stays a rectangle until explicitly converted. |
| **Body** | A 3D object: a manufactured item, purchased item, reference mesh, or cutting shape. Solid and mesh bodies share the same vocabulary, but may support different operations. |
| **Group** | A container for bodies, sketches, and other groups. Used to organize, position, duplicate, select, and hide its contents together. |
| **Drawing** | A technical drawing intended for printing on paper or exporting as a printable document, such as PDF. Contains sheets with scaled model views, dimensions, annotations, and optionally sections and detail views. A drawing is not a sketch. |
| **Feature** | An editable operation that creates or changes geometry, such as extrusion, hole, fillet, chamfer, or shell. Features belong to a body's construction information; they are not additional physical objects. |
| **Material** | A named definition combining material thickness and appearance. Thickness may be unspecified for materials that do not have a fixed sheet thickness. |
| **Joint** | A mechanical relationship between bodies or groups defining their relative position and permitted motion. Examples: fixed, hinge, and slider. |
| **Object** | A general word for something selectable, not an additional object type or container. |

**Part**, **assembly**, and **subassembly** are descriptive words, not separate object types. A body can represent a part. A group can represent an assembly. A group inside another group can represent a subassembly.

## Sketches and drawings

- A sketch defines geometry used for modeling or fabrication.
- A drawing presents a model for human readers on paper.
- Drawing dimensions describe model geometry; changing an annotation must not silently change the model.
- Drawing views should reference the model and update when it changes. Broken references must be identified rather than silently reassigned.
- Paper scale and model size are separate: a view at 1:2 does not resize the model.
- Laser export is a separate output workflow: selected profiles or flat faces export at accurate physical size, independently of paper drawing layouts.

## Negative bodies

A negative body is an ordinary body whose role is set to **cut**. It subtracts its volume from explicitly selected target bodies while retaining its editable geometry and placement.

For example, a cylinder can cut an adjustable hole through a lid and enclosure. Its diameter, depth, and position remain editable. One cutter may target several bodies.

- Negative bodies are normally hidden and excluded from physical geometry exports. Their resulting cuts remain included.
- An editing mode reveals cutters for selection and modification.
- Visibility and operation state are separate: hiding a cutter does not disable its cut. Use an explicit **disable cut** control.
- Moving another body into a cutter does not automatically add it as a target.
- A cutter that stops intersecting a target retains that relationship and reports that it currently removes nothing.
- Simple hole features should use the same underlying cutting mechanism rather than a conflicting representation. Specialized holes may add parameters such as countersink or thread specification.
- Cut order must be defined where operations depend on one another. Circular dependencies are prohibited.

## Ownership and attachment

Ownership answers **where an object belongs**. Attachment answers **which reference it follows**.

A body may own sketches and negative bodies. A group may own bodies, sketches, and nested groups. Each object has one owner; it may reference several other objects as cutting targets or construction references.

An attachment can reference a face, plane, axis, or point. For example:

- A sketch attached to a lid face follows that face as the lid changes.
- A cutter owned by the lid moves with the lid and may still target both the lid and enclosure.
- An unattached sketch uses its own explicit plane and placement.

Moving a parent moves its contents. References must not cause the same transform to be applied twice. Reparenting should preserve world placement by default; attachment or joint conflicts must be resolved explicitly.

If a referenced face disappears, mark the attachment as unresolved and offer reassignment. Do not silently choose a different face. Where supported, allow references to underlying geometry before finishing features such as fillets and chamfers.

## Features and editable geometry

Features preserve intent rather than baking every change into anonymous faces.

Examples include an extrusion depth, a hole diameter, a shell thickness, a fillet radius, or a chamfer distance. A box can retain its original dimensions while its edge treatments remain independently editable or disabled.

Feature controls normally appear when inspecting a body. Construction history remains available on request and separate from the organizational model tree.

Selecting and dragging native geometry should update its meaningful parameters where possible. Operations that cannot preserve that meaning must make the conversion or additional operation explicit.

## Groups and joints

Grouping creates a hierarchy and a common placement; it does not automatically define a mechanical joint.

- A **hinge joint** permits rotation about an axis, optionally with limits.
- A **slider joint** permits translation along an axis, optionally with limits.
- Joints may connect bodies or groups, allowing a mechanism to be organized as nested groups.
- Group movement places the mechanism as a whole; joint motion changes the relative placement of its connected members.
- Conflicting or redundant joints must be reported. The app must not silently distort bodies to satisfy them.
- Attachment is for construction references; a joint describes the mechanical relationship between modeled items.

## Materials

A material combines a name, thickness, and appearance—for example, “Birch plywood, 4 mm” with its visual finish.

- A body can use a material directly. A group may supply a default for its contents, with explicit body assignments taking precedence.
- Geometry follows material thickness only where a feature explicitly uses that thickness parameter.
- Changing appearance alone never resizes geometry.
- A material thickness mismatch should be visible rather than silently corrected.
- Display appearance does not by itself specify fabrication tolerances or laser kerf compensation.

## Duplication and imported geometry

**Duplicate linked** shares the underlying design while allowing independent placement. **Duplicate independent** creates a separately editable design. These are duplication modes, not additional visible object types.

Linked copies must have predictable behavior for materials, features, attachments, and joints. External cutting targets and joint partners must not silently transfer to unrelated objects when duplicating; preserve internal references within the copied selection and explicitly resolve external ones.

Imported meshes remain bodies, but are not automatically converted to editable CAD solids. The interface must show supported operations and any required conversion. Disconnected geometry may be imported as separate bodies or retained together when that matches the source; it must not introduce another user-facing type.

## Interaction principles

1. Draw and model without creating containers first. A sketch can be extruded directly into a body.
2. Use groups only when organization or shared movement is useful.
3. Keep features and construction history separate from the main organizational tree.
4. Preserve explicit references, cutting targets, and editable parameters when saving and reopening.
5. Report unresolved references, invalid operations, and conflicting joints clearly; never silently change their meaning.

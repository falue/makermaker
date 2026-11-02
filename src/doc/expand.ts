import type { Frame } from './frames';
import type { Resolved } from './resolve';
import type { BooleanFeature, BuildIn, Feature, MeshFeature, Sketch, SketchPlacement } from './types';

/**
 * A feature as the kernel builds it: an own extrusion as it is, a linked one with its sketch's plane and chosen
 * shapes. A sketch on a face (or a fixed plane) uses that frame (`faceOf`, in this body's coordinates; undefined
 * while the face's body is not built yet: then null, try again later); on this body's own end face it follows the
 * feature directly. A string says why it cannot be built.
 */
export function toBuild(
  feature: Resolved<Exclude<Feature, BooleanFeature | MeshFeature>>,
  body: string,
  sketches: Map<string, Resolved<Sketch>>,
  faceOf: (placement: Exclude<Resolved<SketchPlacement>, { kind: 'base' }>) => Frame | undefined,
  cutterFrame: (sketch: Resolved<Sketch>) => Frame | undefined = () => undefined,
): Resolved<BuildIn> | string | null {
  if (feature.type === 'split') {
    // a sketch shape cuts where the sketch is in the world (`cutterFrame`: its plane in this body's coordinates)
    const c = feature.cutter;
    if (c.kind !== 'shape') return feature;
    const sketch = sketches.get(c.sketch);
    const profile = sketch?.shapes.find((s) => s.id === c.shape);
    if (!sketch || !profile) return 'its cutting shape was deleted';
    const frame = cutterFrame(sketch);
    if (!frame) return null;
    return { ...feature, cutter: { kind: 'frame', frame, profile, offset: c.offset } };
  }
  if (feature.type !== 'extrude') return feature;
  const { source, ...rest } = feature;
  if (source.kind === 'own') return { ...rest, plane: source.plane, profiles: source.profiles, areas: source.areas };
  const sketch = sketches.get(source.sketch);
  if (!sketch) return 'its sketch was deleted';
  const found = source.shapes.map((id) => sketch.shapes.find((s) => s.id === id));
  if (!found.length || found.some((s) => !s)) return 'a shape of its sketch was deleted';
  // construction lines never extrude, open lines only where they close areas picked (else also when a shape became one later)
  const lined = source.areas?.some((a) => a.at);
  const profiles = found.filter((s) => !s!.construction && (lined || s!.kind !== 'line'));
  if (!profiles.length) return 'its shapes are all construction or open lines';
  const p = sketch.plane;
  const plane = p.kind === 'base' ? p : p.kind === 'cap' && p.body === body ? ({ kind: 'cap', feature: p.feature } as const) : faceOf(p);
  if (!plane) return null;
  return { ...rest, plane: 'kind' in plane ? plane : { kind: 'frame', ...plane }, profiles: profiles as Resolved<Sketch>['shapes'], areas: source.areas };
}

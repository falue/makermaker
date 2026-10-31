import type { Frame } from './frames';
import type { Resolved } from './resolve';
import type { BuildIn, Feature, Sketch } from './types';

/**
 * A feature as the kernel builds it: an own extrusion as it is, a linked one with its sketch's plane and chosen
 * shapes. A sketch on another body's face uses that face's frame (`faceOf`, in this body's coordinates; undefined
 * while that body is not built yet: then null, try again later). A string says why it cannot be built.
 */
export function toBuild(
  feature: Resolved<Feature>,
  body: string,
  sketches: Map<string, Resolved<Sketch>>,
  faceOf: (body: string, feature: string) => Frame | undefined,
): Resolved<BuildIn> | string | null {
  if (feature.type !== 'extrude') return feature;
  const { source, ...rest } = feature;
  if (source.kind === 'own') return { ...rest, plane: source.plane, profiles: source.profiles, areas: source.areas };
  const sketch = sketches.get(source.sketch);
  if (!sketch) return 'its sketch was deleted';
  const profiles = source.shapes.map((id) => sketch.shapes.find((s) => s.id === id));
  if (!profiles.length || profiles.some((s) => !s)) return 'a shape of its sketch was deleted';
  const p = sketch.plane;
  const plane = p.kind === 'base' ? p : p.body === body ? ({ kind: 'cap', feature: p.feature } as const) : faceOf(p.body, p.feature);
  if (!plane) return null;
  return { ...rest, plane: 'kind' in plane ? plane : { kind: 'frame', ...plane }, profiles: profiles as Resolved<Sketch>['shapes'], areas: source.areas };
}

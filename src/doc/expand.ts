import type { Resolved } from './resolve';
import type { BuildIn, Sketch, Feature } from './types';

/**
 * A feature as the kernel builds it: an own extrusion as it is, a linked one with its sketch's plane and chosen shapes.
 * A string says why it cannot be built (sketch or shape deleted, sketch on another body's face).
 */
export function toBuild(feature: Resolved<Feature>, body: string, sketches: Map<string, Resolved<Sketch>>): Resolved<BuildIn> | string {
  if (feature.type !== 'extrude') return feature;
  const { source, ...rest } = feature;
  if (source.kind === 'own') return { ...rest, plane: source.plane, profiles: source.profiles, areas: source.areas };
  const sketch = sketches.get(source.sketch);
  if (!sketch) return 'its sketch was deleted';
  const p = sketch.plane;
  if (p.kind === 'cap' && p.body !== body) return 'its sketch lies on another body';
  const profiles = source.shapes.map((id) => sketch.shapes.find((s) => s.id === id));
  if (!profiles.length || profiles.some((s) => !s)) return 'a shape of its sketch was deleted';
  return { ...rest, plane: p.kind === 'base' ? p : { kind: 'cap', feature: p.feature }, profiles: profiles as Resolved<Sketch>['shapes'], areas: source.areas };
}

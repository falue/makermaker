import type { Resolved } from './resolve';
import type { BuildIn, Sketch, Step } from './types';

/**
 * A step as the kernel builds it: an own extrusion as it is, a linked one with its sketch's plane and chosen shapes.
 * A string says why it cannot be built (sketch or shape deleted, sketch on another part's face).
 */
export function toBuild(step: Resolved<Step>, part: string, sketches: Map<string, Resolved<Sketch>>): Resolved<BuildIn> | string {
  if (step.type !== 'extrude') return step;
  const { source, ...rest } = step;
  if (source.kind === 'own') return { ...rest, plane: source.plane, profiles: source.profiles };
  const sketch = sketches.get(source.sketch);
  if (!sketch) return 'its sketch was deleted';
  const p = sketch.plane;
  if (p.kind === 'cap' && p.part !== part) return 'its sketch lies on another part';
  const profiles = source.shapes.map((id) => sketch.shapes.find((s) => s.id === id));
  if (!profiles.length || profiles.some((s) => !s)) return 'a shape of its sketch was deleted';
  return { ...rest, plane: p.kind === 'base' ? p : { kind: 'cap', step: p.step }, profiles: profiles as Resolved<Sketch>['shapes'] };
}

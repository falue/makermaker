import type { BuildFeature } from './build';

/** Steps' texts, once per step (linked copies share their source's steps). */
const known = new WeakMap<BuildFeature, string>();
const keyOf = (f: BuildFeature): string => {
  let key = known.get(f);
  if (key === undefined) {
    // a STEP file's text left out (megabytes; it never changes); a boolean's or finger joint's other body's steps each once too
    const { features, ...rest } = f as BuildFeature & { features?: BuildFeature[] };
    key = JSON.stringify(f.type === 'step' ? { ...f, data: undefined } : rest) + (features ? `[${stepsKey(features)}]` : '');
    known.set(f, key);
  }
  return key;
};

/** A body's steps as text, to compare. */
export const stepsKey = (features: BuildFeature[]) => features.map(keyOf).join('\n');

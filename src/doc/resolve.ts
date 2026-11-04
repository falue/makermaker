import { evalLength, evalQuantity, type Lookup, type Quantity } from './expr';
import type { Doc, Expr } from './types';

export type Resolved<T> = T extends Expr ? number : T extends object ? { [K in keyof T]: Resolved<T[K]> } : T;

const isExpr = (o: unknown): o is Expr =>
  typeof o === 'object' && o !== null && typeof (o as Expr).e === 'string' && typeof (o as Expr).u === 'string';

/** Resolves parameter names, detecting unknown names and cycles. */
export function paramLookup(params: Doc['params']): Lookup {
  const cache = new Map<string, Quantity>();
  const active = new Set<string>();
  const lookup: Lookup = (name) => {
    const hit = cache.get(name);
    if (hit) return hit;
    if (!Object.hasOwn(params, name)) throw new Error(`unknown name "${name}"`);
    if (active.has(name)) throw new Error(`"${name}" refers to itself`);
    active.add(name);
    try {
      const q = evalQuantity(params[name], lookup);
      cache.set(name, q);
      return q;
    } finally {
      active.delete(name);
    }
  };
  return lookup;
}

/** Fields that are plain numbers, not lengths: turns (degrees) and counts. */
export const UNITLESS = ['rot', 'sides', 'rx', 'ry', 'rz', 'scale', 'deg'];

function evalNumber(x: Expr, lookup: Lookup) {
  const q = evalQuantity(x, lookup);
  if (q.dim) throw new Error('this value has no unit');
  return q.v;
}

/** Replaces every Expr in `obj` by its length in mm (UNITLESS fields: plain numbers); errors are keyed by dotted path. */
export function resolve<T>(obj: T, lookup: Lookup, path: string, errors: Map<string, string>): Resolved<T> {
  if (isExpr(obj)) {
    try {
      return (UNITLESS.includes(path.slice(path.lastIndexOf('.') + 1)) ? evalNumber(obj, lookup) : evalLength(obj, lookup)) as Resolved<T>;
    } catch (err) {
      errors.set(path, (err as Error).message);
      return NaN as Resolved<T>;
    }
  }
  if (Array.isArray(obj)) return obj.map((v, i) => resolve(v, lookup, `${path}.${i}`, errors)) as Resolved<T>;
  if (typeof obj === 'object' && obj !== null)
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, resolve(v, lookup, `${path}.${k}`, errors)]),
    ) as Resolved<T>;
  return obj as Resolved<T>;
}

/** Immutable update at a dotted path. */
export function setIn<T>(obj: T, path: string[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  const cur = (obj as Record<string, unknown>)[k];
  const next = setIn(cur, rest, value);
  if (next === cur) return obj;
  return (Array.isArray(obj) ? Object.assign([...obj], { [k]: next }) : { ...obj, [k]: next }) as T;
}

export function getIn(obj: unknown, path: string[]): unknown {
  return path.reduce((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

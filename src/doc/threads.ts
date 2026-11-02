/**
 * Thread sizes: nominal (major) diameter and pitch in mm. Metric coarse and fine from ISO 261 / ISO 262; Unified
 * coarse (UNC) and fine (UNF) from ASME B1.1, converted from inches and threads per inch. Both share the ISO basic
 * profile (60° flanks, see ISO 68-1).
 */
export type ThreadSize = { name: string; d: number; pitch: number; system: 'metric' | 'imperial' };

const metric = (d: number, pitch: number, fine = false): ThreadSize => ({ name: `M${d}${fine ? ` × ${pitch}` : ''}`, d, pitch, system: 'metric' });
const unified = (name: string, inch: number, tpi: number): ThreadSize => ({ name, d: inch * 25.4, pitch: 25.4 / tpi, system: 'imperial' });

export const THREADS: ThreadSize[] = [
  ...([[1.6, 0.35], [2, 0.4], [2.5, 0.45], [3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [18, 2.5], [20, 2.5], [22, 2.5], [24, 3], [27, 3], [30, 3.5], [36, 4]] as const).map(([d, p]) => metric(d, p)),
  ...([[8, 1], [10, 1.25], [10, 1], [12, 1.5], [12, 1.25], [14, 1.5], [16, 1.5], [18, 1.5], [20, 1.5], [22, 1.5], [24, 2]] as const).map(([d, p]) => metric(d, p, true)),
  ...([['#2-56 UNC', 0.086, 56], ['#4-40 UNC', 0.112, 40], ['#6-32 UNC', 0.138, 32], ['#8-32 UNC', 0.164, 32], ['#10-24 UNC', 0.19, 24], ['1/4-20 UNC', 0.25, 20], ['5/16-18 UNC', 0.3125, 18], ['3/8-16 UNC', 0.375, 16], ['7/16-14 UNC', 0.4375, 14], ['1/2-13 UNC', 0.5, 13], ['5/8-11 UNC', 0.625, 11], ['3/4-10 UNC', 0.75, 10], ['7/8-9 UNC', 0.875, 9], ['1-8 UNC', 1, 8]] as const).map(([n, d, t]) => unified(n, d, t)),
  ...([['#10-32 UNF', 0.19, 32], ['1/4-28 UNF', 0.25, 28], ['5/16-24 UNF', 0.3125, 24], ['3/8-24 UNF', 0.375, 24], ['7/16-20 UNF', 0.4375, 20], ['1/2-20 UNF', 0.5, 20], ['5/8-18 UNF', 0.625, 18], ['3/4-16 UNF', 0.75, 16], ['7/8-14 UNF', 0.875, 14], ['1-12 UNF', 1, 12]] as const).map(([n, d, t]) => unified(n, d, t)),
];

/** The basic thread depth of a pitch (5/8 of the fundamental triangle's height H = 0.866 P), ISO 68-1. */
export const threadDepth = (pitch: number) => 0.625 * 0.8660254 * pitch;

/** The size that fits a round surface of diameter `d`: a shaft by its major diameter, a hole by its minor one (tap drill). */
export function fitting(d: number, inside: boolean, system: ThreadSize['system']): ThreadSize {
  const of = THREADS.filter((t) => t.system === system);
  const size = (t: ThreadSize) => (inside ? t.d - 2 * threadDepth(t.pitch) : t.d);
  // coarse first: among equally near sizes the first listed wins
  return of.reduce((best, t) => (Math.abs(size(t) - d) < Math.abs(size(best) - d) - 1e-9 ? t : best));
}

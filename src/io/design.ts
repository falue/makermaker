import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Doc, Expr, Part, SketchPlane, Step } from '../doc/types';

export const EXTENSION = '.mmk';

export interface Version {
  savedAt: string;
  doc: Doc;
}

type V1Step =
  | { id: string; type: 'extrude'; profile: { kind: 'rect'; w: Expr; h: Expr; r: Expr } | { kind: 'circle'; d: Expr }; depth: Expr }
  | { id: string; type: 'hole'; x: Expr; y: Expr; d: Expr }
  | Extract<Step, { type: 'finish' }>;

/** v1: one base extrusion on XY plus through-holes. */
function fromV1(doc: { params: Doc['params']; units: Doc['units']; parts: (Omit<Part, 'steps'> & { steps: V1Step[] })[] }): Doc {
  const zero = (u: Expr['u']): Expr => ({ e: '0', u });
  const ground: SketchPlane = { kind: 'base', axis: 'xy', offset: zero('mm') };
  const parts = doc.parts.map((part) => ({
    ...part,
    steps: part.steps.map((s): Step => {
      if (s.type === 'extrude')
        return {
          id: s.id,
          type: 'extrude',
          plane: ground,
          profiles: [{ id: `${s.id}p`, x: zero('mm'), y: zero('mm'), ...s.profile }],
          depth: s.depth,
          mode: 'add',
          through: false,
        };
      if (s.type === 'hole')
        return {
          id: s.id,
          type: 'extrude',
          plane: ground,
          profiles: [{ id: `${s.id}p`, kind: 'circle', x: s.x, y: s.y, d: s.d }],
          depth: zero('mm'),
          mode: 'cut',
          through: true,
        };
      return s;
    }),
  }));
  return { schema: 2, units: doc.units, params: doc.params, parts };
}

export function migrate(raw: unknown): Doc {
  const doc = raw as { schema?: number };
  if (doc?.schema === 1) return fromV1(raw as Parameters<typeof fromV1>[0]);
  if (doc?.schema !== 2) throw new Error(`unsupported document schema: ${doc?.schema}`);
  return raw as Doc;
}

/** ZIP with document.json plus one history snapshot per save. */
export function pack(doc: Doc, versions: Version[]): Uint8Array {
  const files: Record<string, Uint8Array> = { 'document.json': strToU8(JSON.stringify(doc, null, 2)) };
  for (const v of versions) files[`history/${v.savedAt}.json`] = strToU8(JSON.stringify(v.doc));
  return zipSync(files);
}

export function unpack(bytes: Uint8Array): { doc: Doc; versions: Version[] } {
  const files = unzipSync(bytes);
  const read = (name: string) => migrate(JSON.parse(strFromU8(files[name])));
  if (!files['document.json']) throw new Error('not a design file: document.json missing');
  const versions = Object.keys(files)
    .filter((k) => k.startsWith('history/'))
    .sort()
    .map((k) => ({ savedAt: k.slice('history/'.length, -'.json'.length), doc: read(k) }));
  return { doc: read('document.json'), versions };
}

/** Appends `doc` as a new version unless it equals the latest one; keeps the newest `limit`. */
export function addVersion(versions: Version[], doc: Doc, limit = 50): Version[] {
  const last = versions.at(-1);
  if (last && JSON.stringify(last.doc) === JSON.stringify(doc)) return versions;
  const savedAt = new Date().toISOString().replace(/[:.]/g, '-');
  return [...versions, { savedAt, doc }].slice(-limit);
}

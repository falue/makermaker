import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Doc } from '../doc/types';

export const EXTENSION = '.mmk';

export interface Version {
  savedAt: string;
  doc: Doc;
}

/** Only the current schema opens: the app is not released yet, so old files are not converted. */
export function migrate(raw: unknown): Doc {
  const schema = (raw as { schema?: number })?.schema;
  if (schema !== 19) throw new Error(`This file uses document schema ${schema}; this version only opens schema 19`);
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

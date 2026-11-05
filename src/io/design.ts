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
  if (schema !== 32) throw new Error(`This file uses document schema ${schema}; this version only opens schema 32`);
  return raw as Doc;
}

/**
 * ZIP with document.json, one history snapshot per save, and blobs/: long texts (imported files, pictures), each stored
 * once however many versions hold it; `{ $blob: name }` stands in for them. `longFrom`: how long is long, in characters.
 */
export function pack(doc: Doc, versions: Version[], longFrom = 1024): Uint8Array {
  const blobs = new Map<string, string>();
  const json = (d: Doc, indent?: number) =>
    JSON.stringify(
      d,
      (_, v) => {
        if (typeof v !== 'string' || v.length < longFrom) return v;
        if (!blobs.has(v)) blobs.set(v, String(blobs.size));
        return { $blob: blobs.get(v) };
      },
      indent,
    );
  const files: Record<string, Uint8Array> = { 'document.json': strToU8(json(doc, 2)) };
  for (const v of versions) files[`history/${v.savedAt}.json`] = strToU8(json(v.doc));
  for (const [text, name] of blobs) files[`blobs/${name}`] = strToU8(text);
  return zipSync(files);
}

export function unpack(bytes: Uint8Array): { doc: Doc; versions: Version[] } {
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('this is not a MAKERMAKER design, or it is damaged');
  }
  // one string per blob: versions in memory share them too
  const blobs = new Map<string, string>();
  const blob = (name: string) => {
    if (!blobs.has(name)) {
      const file = files[`blobs/${name}`];
      if (!file) throw new Error(`damaged design file: blobs/${name} missing`);
      blobs.set(name, strFromU8(file));
    }
    return blobs.get(name)!;
  };
  const read = (name: string) => migrate(JSON.parse(strFromU8(files[name]), (_, v) => (typeof v?.$blob === 'string' ? blob(v.$blob) : v)));
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

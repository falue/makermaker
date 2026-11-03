import { unzipSync, zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { sampleDoc } from '../doc/sample';
import { addVersion, pack, unpack } from './design';

describe('design file', () => {
  it('round-trips the document and its history', () => {
    const doc = sampleDoc();
    const versions = addVersion(addVersion([], doc), doc);
    expect(versions).toHaveLength(1);
    const back = unpack(pack(doc, versions));
    expect(back.doc).toEqual(doc);
    expect(back.versions).toEqual(versions);
  });

  // a body holding an imported file of `text`
  const base = sampleDoc();
  const withFile = (text: string, name = 'A') => {
    const doc = base;
    const body = { ...doc.bodies[0], name, features: [{ id: 'f', type: 'step' as const, source: 'x.step', data: text }] };
    return { ...doc, bodies: [body, ...doc.bodies.slice(1)] };
  };
  const long = (seed: number) => Array.from({ length: 4000 }, (_, i) => (i * seed) % 7919).join(',');

  it('stores a long text once, however many versions hold it', () => {
    const text = long(31);
    const versions = Array.from({ length: 20 }, (_, i) => ({ savedAt: `t${String(i).padStart(2, '0')}`, doc: withFile(text, `v${i}`) }));
    const files = unzipSync(pack(withFile(text), versions));
    expect(Object.keys(files).filter((k) => k.startsWith('blobs/'))).toHaveLength(1);
    const back = unpack(pack(withFile(text), versions));
    expect(back.doc).toEqual(withFile(text));
    expect(back.versions).toEqual(versions);
  });

  it('keeps an older file text a version still uses', () => {
    const [old, now] = [long(31), long(37)];
    const bytes = pack(withFile(now), [{ savedAt: 't', doc: withFile(old) }]);
    expect(Object.keys(unzipSync(bytes)).filter((k) => k.startsWith('blobs/'))).toHaveLength(2);
    const back = unpack(bytes);
    expect(back.doc).toEqual(withFile(now));
    expect(back.versions[0].doc).toEqual(withFile(old));
  });

  it('opens a file without blobs, and names a missing one', () => {
    const doc = sampleDoc();
    expect(unpack(zipSync({ 'document.json': strToU8(JSON.stringify(doc)) })).doc).toEqual(doc);
    const broken = JSON.stringify(withFile(long(31))).replace(/"data":"[^"]*"/, '"data":{"$blob":"9"}');
    expect(() => unpack(zipSync({ 'document.json': strToU8(broken) }))).toThrow('blobs/9');
  });

  it('rejects unknown schemas', () => {
    expect(() => unpack(pack({ ...sampleDoc(), schema: 9 as 27 }, []))).toThrow('schema');
  });

});

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

  it('rejects unknown schemas', () => {
    expect(() => unpack(pack({ ...sampleDoc(), schema: 9 as 22 }, []))).toThrow('schema');
  });

});

import { describe, expect, it } from 'vitest';
import { sampleDoc } from '../doc/sample';
import { addVersion, migrate, pack, unpack } from './design';

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
    expect(() => unpack(pack({ ...sampleDoc(), schema: 4 as 3 }, []))).toThrow('schema');
  });

  it('migrates v1 base extrusions and holes to own extrusions', () => {
    const mm = (e: string) => ({ e, u: 'mm' as const });
    const v1 = {
      schema: 1,
      units: 'mm',
      params: {},
      parts: [
        {
          id: 'p',
          name: 'Plate',
          position: [mm('0'), mm('0'), mm('0')],
          steps: [
            { id: 'b', type: 'extrude', profile: { kind: 'rect', w: mm('100'), h: mm('60'), r: mm('0') }, depth: mm('4') },
            { id: 'h', type: 'hole', x: mm('10'), y: mm('5'), d: mm('3') },
          ],
        },
      ],
    };
    const doc = migrate(v1);
    const [base, hole] = doc.parts[0].steps;
    expect(doc.schema).toBe(3);
    expect(base).toMatchObject({ type: 'extrude', mode: 'add', depth: mm('4'), source: { kind: 'own', profiles: [{ kind: 'rect', w: mm('100'), rot: mm('0') }] } });
    expect(hole).toMatchObject({ type: 'extrude', mode: 'cut', through: true, source: { kind: 'own', profiles: [{ kind: 'circle', x: mm('10'), d: mm('3') }] } });
  });
});

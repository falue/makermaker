import { describe, expect, it } from 'vitest';
import { displayText, evalLength, inName } from './expr';
import { paramLookup } from './resolve';
import type { Expr, Unit } from './types';

const ex = (e: string, u: Unit = 'mm'): Expr => ({ e, u });
const params = paramLookup({ $ply: ex('4mm'), $count: ex('3'), $loop: ex('$loop + 1'), $a: ex('$b'), $b: ex('$a') });
const len = (e: string, u: Unit = 'mm') => evalLength(ex(e, u), params);

describe('evalLength', () => {
  it('takes plain numbers in the entry unit', () => {
    expect(len('10')).toBe(10);
    expect(len('2', 'in')).toBeCloseTo(50.8);
  });

  it('accepts explicit units that differ from the entry unit', () => {
    expect(len('3in')).toBeCloseTo(76.2);
    expect(len('1 cm + 5mm', 'in')).toBeCloseTo(15);
  });

  it('evaluates expressions with references', () => {
    expect(len('2 * $ply + 10')).toBe(18);
    expect(len('(80 - 2*$ply) / $count')).toBe(24);
    expect(len('-$ply^1 + max(1cm, 5)')).toBe(6);
    expect(len('sqrt($ply * $ply)')).toBe(4);
  });

  it('reports errors', () => {
    expect(() => len('$ply * $ply')).toThrow('not a length');
    expect(() => len('$nope')).toThrow('unknown name');
    expect(() => len('ply')).toThrow('parameters start with $');
    expect(() => len('$loop')).toThrow('refers to itself');
    expect(() => len('$a')).toThrow('refers to itself');
    expect(() => len('1 +')).toThrow('unexpected end');
    expect(() => len('2 )')).toThrow('unexpected ")"');
    expect(() => len('1/0')).toThrow('division by zero');
    expect(() => len('')).toThrow('empty');
  });
});

describe('inName', () => {
  it('a letter goes on with a name or word', () => {
    for (const t of ['$', '$p', '$t1', '2*$ply', 'sqr', 'f']) expect(inName(t)).toBe(true);
  });
  it('else it is a command, also right after a unit', () => {
    for (const t of ['', '5', '5mm', '2 * ', '3in', '$ply + ']) expect(inName(t)).toBe(false);
  });
});

describe('displayText', () => {
  it('converts plain numbers and keeps expressions', () => {
    expect(displayText(ex('25.4'), 'in')).toBe('1');
    expect(displayText(ex('2*ply'), 'in')).toBe('2*ply');
    expect(displayText(ex('10'), 'mm')).toBe('10');
  });
});

describe('resolve', () => {
  it('keeps rotations in degrees, unconverted', async () => {
    const { resolve } = await import('./resolve');
    const errors = new Map<string, string>();
    const out = resolve({ rot: ex('45', 'in'), w: ex('1', 'in') }, params, 'p', errors);
    expect(out).toEqual({ rot: 45, w: 25.4 });
    resolve({ rot: ex('3mm') }, params, 'q', errors);
    expect(errors.get('q.rot')).toMatch('no unit');
  });
});

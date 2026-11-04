import type { Expr, Unit } from './types';

export const UNITS: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/** `v` is in mm^dim; dim 0 is a plain number. */
export interface Quantity {
  v: number;
  dim: number;
}

export type Lookup = (name: string) => Quantity;

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const re = /\s*(?:((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)|(\$?[A-Za-z_]\w*)|(\S))/iy;
  const out: Token[] = [];
  for (let m; re.lastIndex < src.length && (m = re.exec(src)); ) {
    if (m[1]) out.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2]) out.push({ t: 'id', v: m[2] });
    else if (m[3]) out.push({ t: 'op', v: m[3] });
  }
  return out;
}

/**
 * Whether what comes before the caret is a name or word being typed, so a letter key goes on with it (a parameter's
 * `$name`, a function) instead of being a command; a unit just typed (`5mm`) is done.
 */
export function inName(before: string) {
  const word = /\$\w*$|[A-Za-z_]\w*$/.exec(before)?.[0];
  return !!word && !(word in UNITS);
}

/** Evaluates `+ - * / ^ ( )`, units (`3in`), parameters (`$name`) and sqrt/abs/min/max. Plain numbers stay unitless. */
export function evalQuantity({ e, u }: Expr, lookup: Lookup): Quantity {
  const toks = tokenize(e);
  if (!toks.length) throw new Error('empty');
  const f = UNITS[u];
  let i = 0;
  const op = (c: string) => (toks[i]?.t === 'op' && toks[i].v === c ? (i++, true) : false);

  // Adding a plain number to a length treats it as entered in unit u.
  const same = (a: Quantity, b: Quantity): [Quantity, Quantity] => {
    if (a.dim === b.dim) return [a, b];
    if (a.dim === 0) return [{ v: a.v * f ** b.dim, dim: b.dim }, b];
    if (b.dim === 0) return [a, { v: b.v * f ** a.dim, dim: a.dim }];
    throw new Error('unit mismatch');
  };

  const call = (name: string, args: Quantity[]): Quantity => {
    const [a] = args;
    switch (name) {
      case 'sqrt':
        return { v: Math.sqrt(a.v), dim: a.dim / 2 };
      case 'abs':
        return { v: Math.abs(a.v), dim: a.dim };
      case 'min':
      case 'max':
        return args.reduce((x, y) => {
          const [p, q] = same(x, y);
          return { v: Math[name](p.v, q.v), dim: p.dim };
        });
    }
    throw new Error(`unknown function "${name}"`);
  };

  const atom = (): Quantity => {
    const t = toks[i++];
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') {
      const n = toks[i];
      if (n?.t === 'id' && n.v in UNITS) return i++, { v: t.v * UNITS[n.v as Unit], dim: 1 };
      return { v: t.v, dim: 0 };
    }
    if (t.t === 'id') {
      if (op('(')) {
        const args = [sum()];
        while (op(',')) args.push(sum());
        if (!op(')')) throw new Error('expected ")"');
        return call(t.v, args);
      }
      if (t.v === 'pi') return { v: Math.PI, dim: 0 };
      if (!t.v.startsWith('$')) throw new Error(`unknown "${t.v}": parameters start with $`);
      return lookup(t.v);
    }
    if (t.v === '(') {
      const a = sum();
      if (!op(')')) throw new Error('expected ")"');
      return a;
    }
    throw new Error(`unexpected "${t.v}"`);
  };

  const power = (): Quantity => {
    const a = atom();
    if (!op('^')) return a;
    const b = unary();
    if (b.dim) throw new Error('exponent must be unitless');
    return { v: a.v ** b.v, dim: a.dim * b.v };
  };

  const unary = (): Quantity => {
    if (op('-')) {
      const a = unary();
      return { v: -a.v, dim: a.dim };
    }
    return op('+') ? unary() : power();
  };

  const product = (): Quantity => {
    let a = unary();
    for (;;) {
      if (op('*')) {
        const b = unary();
        a = { v: a.v * b.v, dim: a.dim + b.dim };
      } else if (op('/')) {
        const b = unary();
        if (b.v === 0) throw new Error('division by zero');
        a = { v: a.v / b.v, dim: a.dim - b.dim };
      } else return a;
    }
  };

  const sum = (): Quantity => {
    let a = product();
    for (;;) {
      const sign = op('+') ? 1 : op('-') ? -1 : 0;
      if (!sign) return a;
      const [p, q] = same(a, product());
      a = { v: p.v + sign * q.v, dim: p.dim };
    }
  };

  const result = sum();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
  if (!Number.isFinite(result.v)) throw new Error('not a finite number');
  return result;
}

/** Length in mm; a unitless result is taken in unit `x.u`. */
export function evalLength(x: Expr, lookup: Lookup): number {
  const q = evalQuantity(x, lookup);
  if (q.dim === 0) return q.v * UNITS[x.u];
  if (q.dim !== 1) throw new Error('not a length');
  return q.v;
}

const PLAIN = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

export const fmt = (n: number) => String(+n.toFixed(4));

/** Plain numbers are shown converted to `unit`; expressions are shown as typed. */
export function displayText(x: Expr, unit: Unit): string {
  return PLAIN.test(x.e) && x.u !== unit ? fmt((+x.e * UNITS[x.u]) / UNITS[unit]) : x.e;
}

export const isPlain = (text: string) => PLAIN.test(text);

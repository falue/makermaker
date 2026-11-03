import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { ex, newId } from '../doc/sample';
import type { Body, Feature, Group, Material } from '../doc/types';

/** A solid or surface body of a STEP file, as a small STEP file of its own (in the coordinates of its product). */
export interface StepPart {
  /** Its record in the file: the same in every occurrence of its product. */
  key: number;
  name: string;
  data: string;
  /** Its colour (#rrggbb): its own, else what most of its faces have; `appearance`: that colour's name in the file. */
  color: string | null;
  appearance: string | null;
  /** 0–1 if the file says how see-through it is. */
  translucency: number | null;
}

/** A product where it is used: its place in its parent (mm), its own bodies, and the products in it. */
export interface StepNode {
  name: string;
  matrix: Matrix4;
  parts: StepPart[];
  children: StepNode[];
}

const SOLIDS = new Set(['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'FACETED_BREP', 'SHELL_BASED_SURFACE_MODEL']);
const NAMED_COLOURS: Record<string, string> = { red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00', magenta: '#ff00ff', cyan: '#00ffff', black: '#000000', white: '#ffffff' };
const SI_PREFIX: Record<string, number> = { MILLI: 1e-3, CENTI: 1e-2, DECI: 0.1, KILO: 1e3, MICRO: 1e-6 };

/** A STEP string's text: `''`, `\X\HH` (Latin-1), `\X2\HHHH…\X0\` (UTF-16). */
export function stepText(raw: string) {
  return raw
    .replace(/''/g, "'")
    .replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/g, (_, hex: string) => String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16))))
    .replace(/\\X\\([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** The records of the DATA section by id; strings may hold anything, comments are skipped. */
function records(text: string) {
  const out = new Map<number, string>();
  let i = text.indexOf('DATA;');
  if (i < 0) return out;
  i += 5;
  while ((i = text.indexOf('#', i)) >= 0) {
    const eq = text.indexOf('=', i);
    if (eq < 0) break;
    const id = Number(text.slice(i + 1, eq));
    let j = eq + 1;
    for (let quoted = false; j < text.length; j++) {
      const c = text[j];
      if (c === "'") quoted = !quoted;
      else if (!quoted && c === ';') break;
      else if (!quoted && c === '/' && text[j + 1] === '*') j = text.indexOf('*/', j);
    }
    if (Number.isFinite(id)) out.set(id, text.slice(eq + 1, j).replace(/\s*[\r\n]+\s*/g, '').trim());
    i = j;
  }
  return out;
}

const typeOf = (record = '') => /^\(?\s*([A-Z_0-9]+)/.exec(record)?.[1] ?? '';
/** A record without its strings (they may hold `#` and commas). */
const plain = (record = '') => record.replace(/'(?:[^']|'')*'/g, "''");
const refs = (record = '') => [...plain(record).matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
const numbers = (record = '') => (/\(([^()]*)\)\s*\)\s*$/.exec(plain(record))?.[1] ?? '').split(',').map(parseFloat);
const strings = (record = '') => [...record.matchAll(/'((?:[^']|'')*)'/g)].map((m) => stepText(m[1]));

/** The tree of a STEP file; null if it holds something this cannot place (the file then stays one body). */
export function readStep(text: string): StepNode | null {
  const all = records(text);
  const get = (id: number) => all.get(id) ?? '';
  const byType = (test: (type: string) => boolean) => [...all].filter(([, r]) => test(typeOf(r)));
  const nauos = byType((t) => t === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE');
  const links = new Map<number, number[]>(); // shape representations that are the same thing
  const link = (a: number, b: number) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };
  const placements = new Map<number, number>(); // occurrence to the relationship placing it
  for (const [, r] of all) {
    if (!r.includes('REPRESENTATION_RELATIONSHIP') && !r.startsWith('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION')) continue;
    if (typeOf(r) === 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION') {
      const [relation, shape] = refs(r);
      const occurrence = refs(get(shape))[0];
      placements.set(occurrence, relation);
    } else if (!r.includes('WITH_TRANSFORMATION')) {
      const [a, b] = refs(r);
      link(a, b);
    }
  }
  const representations = new Map<number, number[]>(); // product definition to its representations
  for (const [, r] of byType((t) => t === 'SHAPE_DEFINITION_REPRESENTATION')) {
    const [shape, rep] = refs(r);
    const def = refs(get(shape))[0];
    if (!typeOf(get(def)).startsWith('PRODUCT_DEFINITION')) continue;
    representations.set(def, [...(representations.get(def) ?? []), rep]);
  }
  /** All representations of a product definition, those only linked to them too. */
  const repsOf = (def: number) => {
    const out = new Set<number>(representations.get(def));
    for (const rep of out) for (const other of links.get(rep) ?? []) out.add(other);
    return [...out];
  };
  /** A length in the unit of `context` to mm. */
  const lengthUnit = (id: number): number => {
    const r = get(id);
    const si = /SI_UNIT\(\s*(?:\.([A-Z]+)\.|\$)\s*,\s*\.METRE\./.exec(r);
    if (si) return 1000 * (si[1] ? (SI_PREFIX[si[1]] ?? 1) : 1);
    const measure = refs(r)[0];
    if (r.includes('CONVERSION_BASED_UNIT') && measure !== undefined) {
      const m = get(measure);
      return (parseFloat(/\(\s*([-\d.eE+]+)\s*\)/.exec(plain(m))?.[1] ?? '1') || 1) * lengthUnit(refs(m)[0]);
    }
    return 1;
  };
  const mmOf = (rep: number) => {
    const units = refs(/GLOBAL_UNIT_ASSIGNED_CONTEXT\(\(([^)]*)\)\)/.exec(get(refs(get(rep)).at(-1)!))?.[1]);
    const length = units.find((u) => get(u).includes('LENGTH_UNIT'));
    return length === undefined ? 1 : lengthUnit(length);
  };
  const axis = (id: number, mm: number) => {
    const args = (/\((.*)\)\s*$/.exec(plain(get(id)))?.[1] ?? '').split(',');
    const ref = (k: number) => (args[k]?.includes('#') ? numbers(get(Number(args[k].replace(/\D/g, '')))) : null);
    const z = new Vector3(...((ref(2) ?? [0, 0, 1]) as [number, number, number])).normalize();
    const x = new Vector3(...((ref(3) ?? [1, 0, 0]) as [number, number, number]));
    x.addScaledVector(z, -x.dot(z)).normalize();
    const at = new Vector3(...((ref(1) ?? [0, 0, 0]) as [number, number, number])).multiplyScalar(mm);
    return new Matrix4().makeBasis(x, new Vector3().crossVectors(z, x), z).setPosition(at);
  };
  /** Where an occurrence of `child` sits in its parent; null: unknown or mirrored. */
  const placeOf = (occurrence: number, child: number) => {
    const relation = get(placements.get(occurrence) ?? -1);
    const reps = /REPRESENTATION_RELATIONSHIP\([^#]*#(\d+)\s*,\s*#(\d+)/.exec(plain(relation));
    const items = /WITH_TRANSFORMATION\(\s*#(\d+)/.exec(plain(relation));
    if (!reps || !items || !typeOf(get(+items[1])).startsWith('ITEM_DEFINED_TRANSFORMATION')) return null;
    const mm = mmOf(+reps[1]);
    const [from, to] = refs(get(+items[1])).map((a) => axis(a, mm));
    const m = to.clone().multiply(from.clone().invert());
    if (!repsOf(child).includes(+reps[1])) m.invert(); // the file's parent came first
    return m.determinant() > 0 ? m : null;
  };
  // colours and how see-through, by what they are on
  const styles = new Map<number, { color: string | null; name: string | null; translucency: number | null }>();
  for (const [, r] of byType((t) => t === 'STYLED_ITEM')) {
    const list = refs(r);
    const style = { color: null as string | null, name: null as string | null, translucency: null as number | null };
    const open = list.slice(0, -1);
    for (const seen = new Set(open); open.length; ) {
      const record = get(open.pop()!);
      const type = typeOf(record);
      if (type === 'COLOUR_RGB' && !style.color) {
        const [red, green, blue] = (/\(\s*''\s*,(.*)\)\s*$/.exec(plain(record))?.[1] ?? '').split(',').map(parseFloat);
        style.color = `#${[red, green, blue].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
        style.name = strings(record)[0] || null;
      } else if (type === 'DRAUGHTING_PRE_DEFINED_COLOUR' && !style.color) style.color = NAMED_COLOURS[strings(record)[0]] ?? null;
      else if (type === 'SURFACE_STYLE_TRANSPARENT') style.translucency = parseFloat(/\(\s*([-\d.eE+]+)/.exec(record)?.[1] ?? '0');
      for (const next of refs(record)) if (!seen.has(next)) seen.add(next), open.push(next);
    }
    if (style.color || style.translucency !== null) styles.set(list.at(-1)!, style);
  }
  const closure = (start: number[]) => {
    const out = new Set(start);
    for (const id of out) for (const next of refs(get(id))) out.add(next);
    return out;
  };
  const header = text.slice(0, text.indexOf('DATA;'));
  const lastId = [...all.keys()].reduce((a, b) => Math.max(a, b), 0);
  /** `item` of a product as a STEP file of its own, with its product and the units of `rep`. */
  const partOf = (item: number, def: number, rep: number): StepPart => {
    const context = refs(get(rep)).at(-1)!;
    const own = closure([item]);
    const needed = new Set([...own, ...closure([def, context])]);
    const lines = [...needed].sort((a, b) => a - b).map((id) => `#${id}=${get(id)};`);
    lines.push(`#${lastId + 1}=SHAPE_REPRESENTATION('',(#${item}),#${context});`, `#${lastId + 2}=PRODUCT_DEFINITION_SHAPE('',$,#${def});`, `#${lastId + 3}=SHAPE_DEFINITION_REPRESENTATION(#${lastId + 2},#${lastId + 1});`);
    let look = styles.get(item);
    if (!look?.color) {
      const counts = new Map<string, number>();
      for (const id of own) {
        const s = styles.get(id);
        if (s?.color) counts.set(s.color, (counts.get(s.color) ?? 0) + 1);
      }
      const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      look = [...own].flatMap((id) => styles.get(id) ?? []).find((s) => s.color === common) ?? look;
    }
    return { key: item, name: strings(get(item))[0] || '', data: `${header}DATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`, color: look?.color ?? null, appearance: look?.name ?? null, translucency: look?.translucency ?? null };
  };
  const partsCache = new Map<number, StepPart[]>();
  /** The bodies of a product definition; null: one holds what this cannot read. */
  const partsOf = (def: number) => {
    const cached = partsCache.get(def);
    if (cached) return cached;
    const parts: StepPart[] = [];
    for (const rep of repsOf(def))
      for (const item of (/\(\(?.*?,\s*\(([^()]*)\)/.exec(plain(get(rep)))?.[1] ?? '').matchAll(/#(\d+)/g)) {
        const id = Number(item[1]);
        if (typeOf(get(id)) === 'MAPPED_ITEM') return null;
        if (SOLIDS.has(typeOf(get(id)))) parts.push(partOf(id, def, rep));
      }
    partsCache.set(def, parts);
    return parts;
  };
  const productName = (def: number) => {
    const product = get(refs(get(refs(get(def))[0]))[0]);
    const [id, name] = strings(product);
    return name || id || 'Part';
  };
  /** A product's node; null: something in it cannot be placed. */
  const nodeOf = (def: number, matrix: Matrix4, path: number[]): StepNode | null => {
    const parts = partsOf(def);
    if (!parts) return null;
    const children: StepNode[] = [];
    for (const [id, r] of nauos) {
      const [parent, child] = refs(r);
      if (parent !== def) continue;
      const place = placeOf(id, child);
      if (!place || path.includes(child)) return null;
      const node = nodeOf(child, place, [...path, child]);
      if (!node) return null;
      if (node.parts.length || node.children.length) children.push(node);
    }
    return { name: productName(def), matrix, parts, children };
  };
  const used = new Set(nauos.map(([, r]) => refs(r)[1]));
  const roots = [...representations.keys()].filter((def) => !used.has(def)).map((def) => nodeOf(def, new Matrix4(), [def]));
  if (!roots.length || roots.some((r) => !r)) return null;
  return roots.length === 1 ? roots[0] : { name: '', matrix: new Matrix4(), parts: [], children: roots as StepNode[] };
}

/** What an appearance's name says about its look (STEP files seldom say more than a colour). */
function lookFromName(name: string): Pick<Material, 'bump' | 'translucency'> {
  const n = name.toLowerCase();
  return { translucency: /glass|clear|transparent/.test(n) ? 0.85 : /frosted/.test(n) ? 0.5 : 0, bump: /rough|fabric/.test(n) ? 0.6 : /brushed|satin/.test(n) ? 0.3 : 0.15 };
}

/** Names that only repeat a colour. */
const plainColour = (name: string | null) => !name || /^(colou?r|opaque\(.*\))$/i.test(name.trim());

/**
 * The tree as objects: a group per product where it is used, placed like it, a body per solid (a product used again:
 * linked copies), a material per named appearance (`materials`: those of the document, reused by name and colour).
 * `body`: a new body in a group. `folded`: the groups below the top one.
 */
export function stepObjects(root: StepNode, file: string, materials: Material[], body: (features: Feature[], group: string) => Body) {
  const out = { bodies: [] as Body[], groups: [] as Group[], materials: [] as Material[], folded: [] as string[], root: '' };
  const firsts = new Map<number, string>(); // a part's first body
  const materialOf = (p: StepPart) => {
    if (plainColour(p.appearance) && p.translucency === null) return undefined;
    const name = plainColour(p.appearance) ? `See-through ${p.color}` : p.appearance!;
    const same = (m: Material) => m.name === name && m.color === (p.color ?? '#d8c3a0');
    const found = [...materials, ...out.materials].find(same);
    if (found) return found.id;
    const m: Material = { id: newId(), name, color: p.color ?? '#d8c3a0', glow: '#ffffff', glowStrength: 0, thickness: ex(''), ...lookFromName(name) };
    if (p.translucency !== null) m.translucency = p.translucency;
    out.materials.push(m);
    return m.id;
  };
  const walk = (node: StepNode, parent: string | null, siblings: Map<string, number>) => {
    const id = newId();
    const count = (siblings.get(node.name) ?? 0) + 1;
    siblings.set(node.name, count);
    const name = (node.name || file.replace(/\.[^.]*$/, '')) + (count > 1 ? ` ${count}` : '');
    const at = new Vector3();
    const turn = new Quaternion();
    node.matrix.decompose(at, turn, new Vector3());
    const e = new Euler().setFromQuaternion(turn, 'ZYX');
    const rounded = (v: number) => ex(+v.toFixed(6));
    const degrees = (v: number) => rounded((v * 180) / Math.PI);
    const placed = node.matrix.equals(new Matrix4());
    out.groups.push({ id, name, parent, visible: true, origin: placed ? { kind: 'parent' } : { kind: 'custom', position: [rounded(at.x), rounded(at.y), rounded(at.z)], rotation: { rx: degrees(e.x), ry: degrees(e.y), rz: degrees(e.z) } } });
    if (parent) out.folded.push(id);
    else out.root = id;
    for (const p of node.parts) {
      const first = firsts.get(p.key);
      const made = body(first ? [] : [{ id: newId(), type: 'step', source: file, data: p.data }], id);
      const material = materialOf(p);
      out.bodies.push({ ...made, name: p.name || name, color: p.color ?? made.color, ...(first ? { link: first } : {}), ...(material ? { material } : {}) });
      if (!first) firsts.set(p.key, out.bodies.at(-1)!.id);
    }
    const names = new Map<string, number>();
    for (const child of node.children) walk(child, id, names);
  };
  walk(root, null, new Map());
  return out;
}

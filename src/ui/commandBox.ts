import { closeButton } from './icons';

/** What the command box offers: its name (typed to find it), what it does, its keys, its icon (svg), how it runs. */
export type Command = { name: string; hint: string; keys?: string; icon?: string; run: () => void };

/** Edits (insert, delete, change, swap two neighbours) that turn `a` into `b`. */
function edits(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + +(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * How well `q` (lower case) finds `c`, lower is better; null: not at all. A single letter that is its key first; its name or a word of it starting with `q`,
 * the name holding it, a word starting with it give or take a typo (two from 6 letters), or (3 letters on) its hint holding it.
 */
export function score(q: string, c: Pick<Command, 'name' | 'hint' | 'keys'>): number | null {
  if (q.length === 1 && c.keys?.split(' ').includes(q.toUpperCase())) return -1; // its key, as pressed without the box
  const name = c.name.toLowerCase();
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (name.startsWith(q)) return 0;
  if (words.some((w) => w.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  if (q.length >= 3) {
    const typos = Math.min(...[name, ...words].flatMap((w) => [-1, 0, 1].map((k) => edits(q, w.slice(0, q.length + k)))));
    if (typos <= (q.length >= 6 ? 2 : 1)) return 2 + typos;
    if (c.hint.toLowerCase().includes(q)) return 5;
  }
  return null;
}

/**
 * Opens the command box: type a command's name (typos allowed), Enter or a click runs the one chosen (↑ / ↓ choose),
 * Esc or a click elsewhere closes it. `commands`: what there is now.
 */
export function openCommandBox(commands: Command[]) {
  document.querySelector('.command-box')?.remove();
  const box = Object.assign(document.createElement('div'), { className: 'command-box' });
  const field = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'Type a command, Enter runs it', spellcheck: false });
  const list = Object.assign(document.createElement('div'), { className: 'command-list' });
  let shown: Command[] = [];
  let at = 0;
  const close = () => (box.remove(), removeEventListener('pointerdown', outside, true));
  const outside = (e: PointerEvent) => !box.contains(e.target as Node) && close();
  const run = (c?: Command) => c && (close(), c.run());
  const show = () => {
    const q = field.value.trim().toLowerCase();
    shown = q
      ? commands
          .map((c) => ({ c, s: score(q, c) }))
          .filter((x): x is { c: Command; s: number } => x.s !== null)
          .sort((u, v) => u.s - v.s || u.c.name.length - v.c.name.length)
          .map((x) => x.c)
      : commands;
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.replaceChildren(
      ...shown.map((c, i) => {
        const row = Object.assign(document.createElement('button'), { className: `command${i === at ? ' on' : ''}`, onclick: () => run(c), onmouseenter: () => ((at = i), mark()) });
        const icon = Object.assign(document.createElement('span'), { className: 'command-icon', innerHTML: c.icon ?? '' });
        const name = Object.assign(document.createElement('span'), { className: 'command-name', textContent: c.name });
        const hint = Object.assign(document.createElement('span'), { className: 'command-hint', textContent: c.hint });
        row.append(icon, name, hint, ...(c.keys ? [Object.assign(document.createElement('kbd'), { textContent: c.keys })] : []));
        return row;
      }),
    );
    if (!shown.length) list.append(Object.assign(document.createElement('div'), { className: 'command-none', textContent: 'No command by that name' }));
  };
  const mark = () => [...list.children].forEach((r, i) => r.classList.toggle('on', i === at));
  field.oninput = () => ((at = 0), show());
  field.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      at = (at + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      mark();
      list.children[at]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') run(shown[at]);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const head = Object.assign(document.createElement('div'), { className: 'command-head' });
  head.append(field, closeButton('Close (Esc)', close));
  box.append(head, list);
  document.body.append(box);
  addEventListener('pointerdown', outside, true);
  show();
  field.focus();
}

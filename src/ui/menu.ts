import { pressed } from './keys';

/** One entry of a right-click menu: what it says, what a click does, a tip. */
export type MenuItem = { label: string; run: () => void; title?: string };

let open: (() => void) | null = null;

/** A right-click menu at screen point (x, y): a click on an entry runs it; a click elsewhere, Esc or scrolling closes it. */
export function contextMenu(x: number, y: number, items: MenuItem[]) {
  open?.();
  const box = Object.assign(document.createElement('div'), { className: 'context-menu' });
  box.append(...items.map((it) => Object.assign(document.createElement('button'), { textContent: it.label, title: it.title ?? '', onclick: () => (close(), it.run()) })));
  document.body.append(box);
  // inside the window
  const r = box.getBoundingClientRect();
  Object.assign(box.style, { left: `${Math.min(x, innerWidth - r.width - 4)}px`, top: `${Math.min(y, innerHeight - r.height - 4)}px` });
  const away = (e: Event) => !box.contains(e.target as Node) && close();
  const esc = (e: KeyboardEvent) => pressed(e, 'cancel') && (e.stopImmediatePropagation(), close());
  const close = () => {
    box.remove();
    removeEventListener('pointerdown', away, true);
    removeEventListener('wheel', away, true);
    removeEventListener('keydown', esc, true);
    open = null;
  };
  addEventListener('pointerdown', away, true);
  addEventListener('wheel', away, true);
  addEventListener('keydown', esc, true);
  open = close;
}

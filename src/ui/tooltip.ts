import { icon } from './icons';

/**
 * Hover help (from incase): any element with a title or data-tip shows a styled tooltip after `delay` ms; hidden
 * while a button is held. Titles move into data-tip on first hover, so the browser's own tooltip never shows.
 * `cursorTip` shows a note that follows the pointer at once (e.g. what a key does now).
 */
export function installTooltips(delay = 500, within?: () => DOMRect) {
  const tip = Object.assign(document.createElement('div'), { className: 'tooltip', hidden: true });
  const follow = Object.assign(document.createElement('div'), { className: 'tooltip follow', hidden: true });
  document.body.append(tip, follow);
  let target: Element | null = null;
  let timer = 0;
  let pointer = { x: 0, y: 0 };

  const place = (el: HTMLElement) => {
    const { offsetWidth: w, offsetHeight: h } = el;
    // the pointer's note stays inside `within` while the pointer is in it, else in the window
    const area = el === follow ? within?.() : undefined;
    const inside = area && pointer.x >= area.left && pointer.x <= area.right && pointer.y >= area.top && pointer.y <= area.bottom;
    const [l, t, r, b] = inside ? [area.left, area.top, area.right, area.bottom] : [0, 0, innerWidth, innerHeight];
    el.style.left = `${Math.max(l + 8, Math.min(pointer.x + 14, r - w - 8))}px`;
    el.style.top = `${Math.max(t + 8, pointer.y + 18 + h > b ? pointer.y - h - 10 : pointer.y + 18)}px`;
  };
  /** A toolbar button's help sits by the button: right of it, centred (left toolbar), or below it, left-aligned (edit bar). */
  const byButton = () => {
    const bar = target?.closest('#toolbar, #editbar');
    if (!bar || !target) return false;
    const r = target.getBoundingClientRect();
    const side = bar.id === 'toolbar';
    tip.style.left = `${side ? r.right + 12 : r.left}px`;
    tip.style.top = `${side ? r.top + r.height / 2 - tip.offsetHeight / 2 : r.bottom + 10}px`;
    return true;
  };
  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.hidden = true;
  };

  // before the view's own handlers: a tool asking where the note is gets it at the new pointer
  addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (!follow.hidden) place(follow);
    const over = e.buttons ? null : (e.target as Element).closest?.('[data-tip], [title]');
    if (over?.hasAttribute('title')) {
      over.setAttribute('data-tip', over.getAttribute('title')!);
      over.removeAttribute('title');
    }
    if (over !== target) {
      hide();
      target = over ?? null;
      if (target)
        timer = window.setTimeout(() => {
          tip.textContent = target!.getAttribute('data-tip');
          tip.hidden = !tip.textContent;
          if (!byButton()) place(tip);
        }, delay);
    } else if (!tip.hidden && !byButton()) place(tip);
  }, true);
  addEventListener('pointerdown', hide);
  document.documentElement.addEventListener('pointerleave', hide);

  return {
    /** A note next to the pointer that follows it (null: hides it). */
    cursorTip(text: string | null) {
      // a line about To object starts with its icon, as the To object buttons do
      follow.replaceChildren(
        ...(text ?? '').split('\n').map((line) => {
          const row = document.createElement('div');
          if (/to object/i.test(line)) row.innerHTML = icon('target');
          row.append(line);
          return row;
        }),
      );
      follow.hidden = !text;
      if (text) place(follow);
    },
    /** Where the pointer's note is (viewport px), if shown. */
    cursorTipRect: () => (follow.hidden ? null : follow.getBoundingClientRect()),
  };
}

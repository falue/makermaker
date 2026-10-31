/**
 * Hover help (from incase): any element with a title or data-tip shows a styled tooltip after `delay` ms; hidden
 * while a button is held. Titles move into data-tip on first hover, so the browser's own tooltip never shows.
 * `cursorTip` shows a note that follows the pointer at once (e.g. what a key does now).
 */
export function installTooltips(delay = 500) {
  const tip = Object.assign(document.createElement('div'), { className: 'tooltip', hidden: true });
  const follow = Object.assign(document.createElement('div'), { className: 'tooltip follow', hidden: true });
  document.body.append(tip, follow);
  let target: Element | null = null;
  let timer = 0;
  let pointer = { x: 0, y: 0 };

  const place = (el: HTMLElement) => {
    const { offsetWidth: w, offsetHeight: h } = el;
    el.style.left = `${Math.min(pointer.x + 14, innerWidth - w - 8)}px`;
    el.style.top = `${pointer.y + 18 + h > innerHeight ? pointer.y - h - 10 : pointer.y + 18}px`;
  };
  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.hidden = true;
  };

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
          place(tip);
        }, delay);
    } else if (!tip.hidden) place(tip);
  });
  addEventListener('pointerdown', hide);
  document.documentElement.addEventListener('pointerleave', hide);

  return {
    /** A note next to the pointer that follows it (null: hides it). */
    cursorTip(text: string | null) {
      follow.textContent = text ?? '';
      follow.hidden = !text;
      if (text) place(follow);
    },
  };
}

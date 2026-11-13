
import { axisHtml } from './axes';
import { caretHtml } from './complete';

/**
 * A tooltip's text as HTML, the footer's way: `[Key]` a key and `**words**` stressed (both white), X / Y / Z in their
 * axis' colours; line by line: `# ` its title, `- ` a point of a list, an empty line a gap, others as they are. The
 * first line's lead before ": " (a tool's name, "Move (M): …") white as a title.
 */
export function tipHtml(text: string) {
  const inline = (t: string) =>
    axisHtml(t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      .replace(/\[(.+?)\]/g, '<kbd>$1</kbd>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const lead = (line: string) => {
    const m = /^([^:]{1,40}): /.exec(line);
    return m ? `<b>${inline(m[1])}:</b> ${inline(line.slice(m[0].length))}` : inline(line);
  };
  return text
    .split('\n')
    .map((line, i) => (line.startsWith('# ') ? `<div class="tip-title">${inline(line.slice(2))}</div>` : line.startsWith('- ') ? `<div class="tip-point">${inline(line.slice(2))}</div>` : line ? `<div>${i ? inline(line) : lead(line)}</div>` : '<div class="tip-gap"></div>'))
    .join('');
}

/**
 * Hover help (from incase): any element with a title or data-tip shows a styled tooltip (see `tipHtml`) after `delay` ms; hidden
 * while a button is held. Titles move into data-tip on first hover, so the browser's own tooltip never shows.
 * `cursorTip` shows a note that follows the pointer at once (e.g. what a key does now).
 */
export function installTooltips(delay = 500, within?: () => DOMRect, note: (text: string | null) => void = () => {}) {
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
          const text = target!.getAttribute('data-tip') ?? '';
          tip.innerHTML = tipHtml(text);
          tip.hidden = !text;
          if (!byButton()) place(tip);
        }, delay);
    } else if (!tip.hidden && !byButton()) place(tip);
  }, true);
  addEventListener('pointerdown', hide);
  document.documentElement.addEventListener('pointerleave', hide);

  return {
    /** A note next to the pointer that follows it, one line each (null: hides it); `more` (other keys) goes to `note`. */
    cursorTip(text: string | null, more: string | null = null) {
      note(more);
      const lines = (text ?? '').split('\n').filter(Boolean);
      follow.replaceChildren(...lines.map((line) => Object.assign(document.createElement('div'), { innerHTML: caretHtml(line) })));
      follow.hidden = !lines.length;
      if (lines.length) place(follow);
    },
    /** Where the pointer's note is (viewport px), if shown. */
    cursorTipRect: () => (follow.hidden ? null : follow.getBoundingClientRect()),
  };
}

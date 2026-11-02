/**
 * Parameter names completed in value fields (inputs with `data-complete`): the rest of the first name that starts with
 * the word before the caret shows in grey after it, Tab writes it out with a space. Not after a digit (`50m`: a unit).
 * The field's value holds only what was typed.
 */
export function installCompletion(names: () => string[]) {
  const ghost = Object.assign(document.createElement('div'), { className: 'completion', hidden: true });
  document.body.append(ghost);
  const measure = document.createElement('canvas').getContext('2d')!;
  let field: HTMLInputElement | null = null;
  let rest = '';

  const hide = () => {
    rest = '';
    ghost.hidden = true;
  };
  const update = (el: EventTarget | null) => {
    hide();
    if (!(el instanceof HTMLInputElement) || el.dataset.complete === undefined) return;
    field = el;
    const end = el.value.length;
    if (el.selectionStart !== end || el.selectionEnd !== end) return;
    const m = /(^|[^\w.])([A-Za-z_]\w*)$/.exec(el.value);
    const name = m && names().find((n) => n.startsWith(m[2]) && n !== m[2]);
    if (!name) return;
    rest = name.slice(m[2].length);
    // right after the typed text, in the field's font
    const css = getComputedStyle(el);
    measure.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const r = el.getBoundingClientRect();
    const left = r.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft) + measure.measureText(el.value).width - el.scrollLeft;
    if (left > r.right - parseFloat(css.paddingRight)) return;
    Object.assign(ghost, { textContent: rest, hidden: false });
    Object.assign(ghost.style, { left: `${left}px`, top: `${r.top}px`, height: `${r.height}px`, font: measure.font });
  };

  document.addEventListener('input', (e) => update(e.target));
  document.addEventListener('focusin', (e) => update(e.target));
  document.addEventListener('keyup', (e) => e.key.startsWith('Arrow') && update(e.target));
  document.addEventListener('focusout', hide);
  addEventListener('scroll', hide, true);
  document.addEventListener(
    'keydown',
    (e) => {
      const el = field;
      if (e.key !== 'Tab' || e.shiftKey || !rest || !el || e.target !== el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      el.setRangeText(`${rest} `, el.value.length, el.value.length, 'end'); // a space: ready for what follows
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { capture: true },
  );
}

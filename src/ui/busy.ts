/**
 * A long job's dialog: a live preview (`show`), a progress bar, Cancel. While open nothing else takes clicks or keys.
 * "Run in background" closes it and leaves a chip in the top bar: its text opens the dialog again, × cancels.
 */
export function busy(title: string) {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Node[]) => {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  };
  const state = { cancelled: false, background: false };
  const fill = make('div', { className: 'fill' });
  const percent = make('div', { className: 'percent', textContent: '0 %' });
  const preview = make('div', { className: 'preview' });
  const cancel = () => (state.cancelled = true);
  const box = make(
    'div',
    { className: 'box' },
    make('h2', { textContent: title }),
    preview,
    make('div', { className: 'track' }, fill),
    percent,
    make('div', { className: 'buttons' }, make('button', { textContent: 'Run in background (slow)', onclick: () => open(false) }), make('button', { textContent: 'Cancel', onclick: cancel })),
  );
  const dialog = make('div', { className: 'busy' }, box);
  const label = make('button', { className: 'label', title: 'Show the render', onclick: () => open(true) });
  const chip = make('div', { className: 'busy-chip' }, label, make('button', { className: 'icon', textContent: '×', title: 'Cancel the render', onclick: cancel }));
  const keys = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') cancel();
  };
  const open = (on: boolean) => {
    state.background = !on;
    if (on) {
      chip.remove();
      document.body.append(dialog);
      addEventListener('keydown', keys, { capture: true });
    } else {
      dialog.remove();
      document.body.append(chip);
      removeEventListener('keydown', keys, { capture: true });
    }
  };
  open(true);
  return {
    get cancelled() {
      return state.cancelled;
    },
    /** In the background: the job should go slower so the app stays usable. */
    get background() {
      return state.background;
    },
    /** What the preview shows (the render's own canvas). */
    show(el: HTMLElement) {
      preview.replaceChildren(el);
    },
    /** Progress 0..1. */
    set(done: number) {
      const text = `${Math.floor(done * 100)} %`;
      fill.style.width = `${done * 100}%`;
      percent.textContent = text;
      label.textContent = `${title}: ${text}`;
    },
    done() {
      open(true);
      removeEventListener('keydown', keys, { capture: true });
      dialog.remove();
    },
  };
}

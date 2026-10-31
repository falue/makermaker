/**
 * A big progress bar over the whole window while something long runs: nothing else takes clicks or keys until
 * `done`. Cancel (or Esc) sets `cancelled`.
 */
export function busy(title: string) {
  const fill = Object.assign(document.createElement('div'), { className: 'fill' });
  const percent = Object.assign(document.createElement('div'), { className: 'percent', textContent: '0 %' });
  const state = { cancelled: false };
  const cancel = Object.assign(document.createElement('button'), { textContent: 'Cancel', onclick: () => (state.cancelled = true) });
  const track = Object.assign(document.createElement('div'), { className: 'track' });
  track.append(fill);
  const box = Object.assign(document.createElement('div'), { className: 'box' });
  box.append(Object.assign(document.createElement('h2'), { textContent: title }), track, percent, cancel);
  const el = Object.assign(document.createElement('div'), { className: 'busy' });
  el.append(box);
  document.body.append(el);
  const keys = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') state.cancelled = true;
  };
  addEventListener('keydown', keys, { capture: true });
  return {
    get cancelled() {
      return state.cancelled;
    },
    /** Progress 0..1. */
    set(done: number) {
      fill.style.width = `${done * 100}%`;
      percent.textContent = `${Math.floor(done * 100)} %`;
    },
    done() {
      removeEventListener('keydown', keys, { capture: true });
      el.remove();
    },
  };
}

import { closeButton } from './icons';
import { pressed } from './keys';

/**
 * A question in a dialog in the middle of the page (as Settings): `title`, `text`, a button per answer (the last one
 * first in line: Enter takes it). Resolves with the answer's index; Esc, × or a click beside it: null.
 */
export function ask(title: string, text: string, answers: string[]): Promise<number | null> {
  return new Promise((done) => {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
      const el = Object.assign(document.createElement(tag), props);
      el.append(...children);
      return el;
    };
    const end = (answer: number | null) => {
      dialog.remove();
      removeEventListener('keydown', keys, { capture: true });
      done(answer);
    };
    const keys = (e: KeyboardEvent) => {
      if (!pressed(e, 'confirm') && !pressed(e, 'cancel')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      end(pressed(e, 'confirm') ? answers.length - 1 : null);
    };
    const buttons = answers.map((label, i) => make('button', { textContent: label, className: i === answers.length - 1 ? 'primary' : '', onclick: () => end(i) }));
    const dialog = make(
      'div',
      { className: 'settings ask', onclick: (e: MouseEvent) => e.target === dialog && end(null) },
      make('div', { className: 'box' }, make('div', { className: 'head' }, make('h2', {}, title), closeButton('Close (Esc)', () => end(null))), make('p', {}, text), make('div', { className: 'answers' }, ...buttons)),
    );
    addEventListener('keydown', keys, { capture: true });
    document.body.append(dialog);
    buttons.at(-1)?.focus();
  });
}

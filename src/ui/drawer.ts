import { icon } from './icons';

/** A drawer at the bottom of the view: only its blue title shows; a click slides `body` up (remembered per browser). */
export function drawer(title: string, side: 'left' | 'right', body: HTMLElement, open = false) {
  const key = `makermaker.drawer.${title}`;
  const el = Object.assign(document.createElement('div'), { className: `drawer ${side}` });
  const tab = Object.assign(document.createElement('button'), { className: 'drawer-tab', innerHTML: `${icon('chevron')}<span>${title}</span>`, title: `Show or hide ${title}` });
  const show = (on: boolean) => {
    el.classList.toggle('open', on);
    body.inert = !on;
  };
  tab.onclick = () => {
    const on = !el.classList.contains('open');
    show(on);
    localStorage.setItem(key, on ? 'open' : 'closed');
  };
  const saved = localStorage.getItem(key);
  show(saved ? saved === 'open' : open);
  el.append(tab, body);
  return el;
}

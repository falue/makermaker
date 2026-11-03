import { icon } from './icons';

/** A drawer at the bottom of the view: only its blue title shows; a click slides `body` up (remembered per browser). */
export function drawer(title: string, side: 'left' | 'right', body: HTMLElement) {
  const key = `makermaker.drawer.${title}`;
  const el = Object.assign(document.createElement('div'), { className: `drawer ${side}` });
  const tab = Object.assign(document.createElement('button'), { className: 'drawer-tab', innerHTML: `${icon('chevron')}<span>${title}</span>`, title: `Show or hide ${title}` });
  const show = (open: boolean) => {
    el.classList.toggle('open', open);
    body.inert = !open;
  };
  tab.onclick = () => {
    const open = !el.classList.contains('open');
    show(open);
    localStorage.setItem(key, open ? 'open' : 'closed');
  };
  show(localStorage.getItem(key) === 'open');
  el.append(tab, body);
  return el;
}

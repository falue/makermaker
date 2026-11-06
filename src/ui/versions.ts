import { closeButton } from './icons';
import { pressed } from './keys';

/** One picture of a render: when it was made, whether path traced, its picture (loaded when it comes into sight). */
export type Picture = { at: Date; nice: boolean; url(): Promise<string> };

/**
 * A render's versions in a dialog, newest first: a 2-column gallery that loads more while it scrolls. A click shows
 * one large with Download (`save`); Esc or × goes back from there, else closes it (`closed`: done with the pictures).
 */
export function openVersions(title: string, versions: Picture[], save: (v: Picture) => void, closed: () => void, page = 10) {
  const make = (tag: string, props: object = {}, ...children: (Node | string)[]) => {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  };
  const when = (v: Picture) => `${v.nice ? 'Rendered' : 'Snapshot'} ${v.at.toLocaleString()}`;
  const gallery = make('div', { className: 'gallery' });
  const body = make('div', { className: 'versions-body' }, gallery);
  const more = make('div', { className: 'more' });
  let shown = 0;
  const next = () => {
    for (const v of versions.slice(shown, (shown += page))) {
      const img = make('img', { alt: when(v) }) as HTMLImageElement;
      void v.url().then((src) => (img.src = src));
      gallery.append(make('figure', { title: 'Click: show it large', onclick: () => large(v, img.src) }, img, make('figcaption', {}, when(v))));
    }
    more.hidden = shown >= versions.length;
  };
  // the end of the list in sight: the next page
  const watch = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && shown < versions.length && next(), { root: body });
  let open: HTMLElement | null = null;
  const large = (v: Picture, src: string) => {
    open = make('div', { className: 'large' }, make('img', { src, alt: when(v) }), make('div', { className: 'row' }, make('span', { className: 'hint' }, when(v)), make('button', { textContent: 'Download', onclick: () => save(v) }), make('button', { textContent: 'Back', onclick: back })));
    body.replaceWith(open);
  };
  const back = () => (open?.replaceWith(body), (open = null));
  const close = () => {
    watch.disconnect();
    removeEventListener('keydown', esc, { capture: true });
    dialog.remove();
    closed();
  };
  const esc = (e: KeyboardEvent) => pressed(e, 'cancel') && (e.stopImmediatePropagation(), open ? back() : close());
  const dialog = make(
    'div',
    { className: 'settings versions', onclick: (e: MouseEvent) => e.target === dialog && close() },
    make('div', { className: 'box' }, make('div', { className: 'head' }, make('h2', {}, title), closeButton('Close (Esc)', close)), versions.length ? body : make('p', { className: 'hint' }, 'No pictures of it yet.')),
  );
  gallery.after(more);
  next();
  watch.observe(more);
  addEventListener('keydown', esc, { capture: true });
  document.body.append(dialog);
}

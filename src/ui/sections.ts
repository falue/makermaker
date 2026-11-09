import type { Axis } from '../viewer/viewer';
import { drawer } from './drawer';
import { icon } from './icons';

/**
 * Section panel (a drawer at the bottom left of the 3D view), as in incase: per axis a two-handle slider for the shown range,
 * reset and invert (show only what is outside the handles); double-click a slider to reset it. Below: custom
 * sections (rows rendered into #custom-sections by the panels) and a button that starts a new one.
 * Cuts are world positions (mm, ±Infinity: open): they stay where they are when bodies change; the sliders span the
 * bodies and the cuts (`bounds`). No `add`: no custom sections (an extra view's panel); `start`: the cuts it starts with.
 */
export function sectionControls(host: HTMLElement, set: (axis: Axis, from: number, to: number, inverted: boolean) => void, add?: () => void, start?: { sections: Record<Axis, [number, number]>; inverted: Record<Axis, boolean> }) {
  const spans: ((box: { min: Record<Axis, number>; max: Record<Axis, number> }) => void)[] = [];
  const panel = Object.assign(document.createElement('div'), { className: 'sections' });
  const tips: Record<Axis, [string, string]> = {
    x: ['Show only a slice left to right', 'Drag the handles to cut the 3D view left / right · double-click to reset'],
    y: ['Show only a slice front to back', 'Drag the handles to cut the 3D view front / back · double-click to reset'],
    z: ['Show only a slice bottom to top', 'Drag the handles to cut the 3D view bottom / top · double-click to reset'],
  };
  for (const axis of ['x', 'y', 'z'] as const) {
    const range = (value: number) => Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1000', value: String(value) });
    const from = range(0);
    const to = range(1000);
    const slider = Object.assign(document.createElement('span'), { className: 'dual', title: tips[axis][1] });
    slider.append(from, to);
    const button = (text: string, title: string, onclick: () => void) => Object.assign(document.createElement('button'), { className: 'icon', textContent: text, title, onclick });
    let cut: [number, number] = start ? [...start.sections[axis]] : [-Infinity, Infinity];
    let span: [number, number] = [0, 1]; // mm the slider spans
    const value = (mm: number) => (Number.isFinite(mm) ? Math.round(((mm - span[0]) / (span[1] - span[0] || 1)) * 1000) : mm < 0 ? 0 : 1000);
    const show = () => {
      [from.value, to.value] = cut.map((mm) => String(value(mm)));
      // nothing lies outside the whole range: invert is off there, but remembered for when a handle moves in
      invert.disabled = !cut.some(Number.isFinite);
      const inverted = !invert.disabled && invert.classList.contains('active');
      slider.classList.toggle('inverted', inverted);
      slider.style.setProperty('--from', String(from.valueAsNumber / 1000));
      slider.style.setProperty('--to', String(to.valueAsNumber / 1000));
      return inverted;
    };
    const update = (moved?: HTMLInputElement) => {
      // handles may not cross: the moved one stops at the other
      if (from.valueAsNumber > to.valueAsNumber) moved!.value = (moved === from ? to : from).value;
      // only the moved handle changes its cut; at the ends of the slider it is open
      if (moved) {
        const v = moved.valueAsNumber;
        cut[moved === from ? 0 : 1] = v === 0 ? -Infinity : v === 1000 ? Infinity : span[0] + (v / 1000) * (span[1] - span[0]);
      }
      set(axis, ...cut, show());
    };
    spans.push((box) => {
      if (!Number.isFinite(box.min[axis])) return;
      span = [Math.min(box.min[axis], ...cut.filter(Number.isFinite)), Math.max(box.max[axis], ...cut.filter(Number.isFinite))];
      show();
    });
    const reset = () => {
      cut = [-Infinity, Infinity];
      invert.classList.remove('active');
      update();
    };
    const invert = Object.assign(button('', 'Invert: show only what is outside the handles', () => {
      invert.classList.toggle('active');
      update();
    }), { innerHTML: icon('swap') });
    invert.disabled = true;
    invert.classList.toggle('active', !!start?.inverted[axis]);
    from.oninput = () => update(from);
    to.oninput = () => update(to);
    // a click on the track moves the nearest handle there (the inputs only take clicks on their handles)
    slider.onpointerdown = (e) => {
      if (e.target !== slider) return;
      const r = slider.getBoundingClientRect();
      const v = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left - 7) / (r.width - 14))) * 1000);
      const near = Math.abs(v - from.valueAsNumber) < Math.abs(v - to.valueAsNumber) || v < from.valueAsNumber ? from : to;
      near.value = String(v);
      update(near);
    };
    slider.ondblclick = reset;
    const tools = document.createElement('span');
    tools.append(Object.assign(button('', 'Click: Show the whole range again', reset), { innerHTML: icon('undo') }), invert);
    panel.append(Object.assign(document.createElement('span'), { textContent: axis.toUpperCase(), title: tips[axis][0], className: `axis-${axis}` }), tools, slider);
  }
  const more = Object.assign(document.createElement('button'), { textContent: '+ Section', title: 'A section parallel to a face you click: slanted planes too', onclick: add });
  if (add) panel.append(Object.assign(document.createElement('div'), { id: 'custom-sections' }), more);
  host.append(drawer('Section view', 'left', panel, true));
  return {
    /** While a face is being picked the button says what to do. */
    picking(on: boolean) {
      more.textContent = on ? 'Click any face or plane' : '+ Section';
      more.classList.toggle('on', on);
    },
    /** The bodies' bounding box changed: the sliders span it (and the cuts). */
    bounds: (box: { min: Record<Axis, number>; max: Record<Axis, number> }) => spans.forEach((f) => f(box)),
  };
}

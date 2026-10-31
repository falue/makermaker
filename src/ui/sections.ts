import type { Axis } from '../viewer/viewer';

/**
 * Section panel (bottom left of the 3D view), as in incase: per axis a two-handle slider for the shown range,
 * reset and invert (show only what is outside the handles); double-click a slider to reset it. Below: custom
 * sections (rows rendered into #custom-sections by the panels) and a button that starts a new one.
 */
export function sectionControls(host: HTMLElement, set: (axis: Axis, from: number, to: number, inverted: boolean) => void, add: () => void) {
  const panel = Object.assign(document.createElement('div'), { className: 'overlay bottom-left sections' });
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
    const update = (moved?: HTMLInputElement) => {
      // handles may not cross: the moved one stops at the other
      if (from.valueAsNumber > to.valueAsNumber) moved!.value = (moved === from ? to : from).value;
      // nothing lies outside the whole range: invert is off there, but remembered for when a handle moves in
      invert.disabled = from.valueAsNumber === 0 && to.valueAsNumber === 1000;
      const inverted = !invert.disabled && invert.classList.contains('active');
      slider.classList.toggle('inverted', inverted);
      set(axis, from.valueAsNumber / 1000, to.valueAsNumber / 1000, inverted);
      slider.style.setProperty('--from', String(from.valueAsNumber / 1000));
      slider.style.setProperty('--to', String(to.valueAsNumber / 1000));
    };
    const reset = () => {
      from.value = '0';
      to.value = '1000';
      invert.classList.remove('active');
      update();
    };
    const invert = button('⇄', 'Invert: show only what is outside the handles', () => {
      invert.classList.toggle('active');
      update();
    });
    invert.disabled = true;
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
    tools.append(button('↺', 'Show the whole range again', reset), invert);
    panel.append(Object.assign(document.createElement('span'), { textContent: axis.toUpperCase(), title: tips[axis][0] }), tools, slider);
  }
  const custom = Object.assign(document.createElement('div'), { id: 'custom-sections' });
  const more = Object.assign(document.createElement('button'), { textContent: '+ Section', title: 'A section parallel to a face you click: slanted planes too', onclick: add });
  panel.append(custom, more);
  host.append(panel);
}

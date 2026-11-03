import type { Light } from '../doc/types';

/**
 * Sun and ambient light as rows of sliders and colour fields; each change goes to `change` (`live`: not the first of
 * a drag). The rows are not rebuilt by themselves: that would drop a slider in mid-drag.
 */
export function lightRows(light: Light, change: (next: Light, live: boolean) => void): HTMLElement[] {
  let now = light;
  const set = (patch: Partial<Light>, live: boolean) => change((now = { ...now, ...patch }), live);
  const row = (label: string, ...children: HTMLElement[]) => {
    const el = document.createElement('div');
    el.className = 'row light';
    el.append(Object.assign(document.createElement('span'), { textContent: label }), ...children);
    return el;
  };
  const slider = (key: 'sunHeight' | 'sunAround' | 'sun' | 'ambient', min: number, max: number, step: number, title: string) => {
    const el = Object.assign(document.createElement('input'), { type: 'range', min: String(min), max: String(max), step: String(step), value: String(light[key]), title });
    let live = false;
    el.oninput = () => (set({ [key]: +el.value }, live), (live = true));
    el.onchange = () => (live = false);
    return el;
  };
  const colour = (key: 'sunColor' | 'ambientColor', title: string) => {
    const el = Object.assign(document.createElement('input'), { type: 'color', value: light[key], title, className: 'color' });
    el.onchange = () => set({ [key]: el.value }, false);
    return el;
  };
  return [
    row('Sun', slider('sun', 0, 8, 0.05, 'How strong the sun is'), colour('sunColor', 'Colour of the sun')),
    row('Height', slider('sunHeight', -90, 90, 1, 'The sun above the horizon, degrees')),
    row('Around', slider('sunAround', -180, 180, 1, 'The sun around Z, degrees')),
    row('Ambient', slider('ambient', 0, 8, 0.05, 'How strong the light from all around is'), colour('ambientColor', 'Colour of the light from all around')),
  ];
}

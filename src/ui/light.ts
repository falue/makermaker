import type { Light } from '../doc/types';

/**
 * A light as rows of sliders, colour fields and checks; each change goes to `change` (`live`: not the first of a drag;
 * `layout`: other rows change too, so the caller draws them anew). Not rebuilt by itself: that would drop a slider in mid-drag.
 */
export function lightRows(light: Light, change: (next: Light, live: boolean, layout?: boolean) => void): HTMLElement[] {
  let now = light;
  const set = (patch: Partial<Light>, live: boolean, layout = false) => change((now = { ...now, ...patch }), live, layout);
  const row = (label: string, ...children: HTMLElement[]) => {
    const el = document.createElement('div');
    el.className = 'row light';
    el.append(Object.assign(document.createElement('span'), { textContent: label }), ...children);
    return el;
  };
  const slider = (key: 'sunHeight' | 'sunAround' | 'sun' | 'ambient' | 'cameraLight', min: number, max: number, step: number, title: string, disabled = false) => {
    const el = Object.assign(document.createElement('input'), { type: 'range', min: String(min), max: String(max), step: String(step), value: String(light[key]), title, disabled });
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
  const check = (key: 'followCamera' | 'cameraOn', text: string, title: string) => {
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: light[key] });
    box.onchange = () => set({ [key]: box.checked }, false, true);
    const label = Object.assign(document.createElement('label'), { className: 'check', title });
    label.append(box, text);
    return label;
  };
  return [
    row('Sun', slider('sun', 0, 8, 0.05, 'How strong the sun is'), colour('sunColor', 'Colour of the sun')),
    row('Height', slider('sunHeight', -90, 90, 1, 'The sun above the horizon, degrees')),
    row('Around', slider('sunAround', -180, 180, 1, 'The sun around Z, degrees', light.followCamera), check('followCamera', 'Follows camera', 'The sun stays behind the camera, 45° to its side, wherever you look from')),
    row('Ambient', slider('ambient', 0, 8, 0.05, 'How strong the light from all around is'), colour('ambientColor', 'Colour of the light from all around')),
    row('Camera', check('cameraOn', 'Camera emits light', 'A light from where you look: for models hard to see'), slider('cameraLight', 0, 8, 0.05, 'How strong the light from the camera is', !light.cameraOn)),
  ];
}

import { newId } from '../doc/sample';
import type { Material } from '../doc/types';
import { plainLook } from '../doc/materials';

/** Materials as a MaterialX file (standard_surface); what it cannot say goes in `makermaker_` attributes. */
export function toMtlx(materials: Material[]) {
  const attr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rgb = (hex: string) => [1, 3, 5].map((i) => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).join(', ');
  const nodes = materials.flatMap((m, i) => {
    const node = `m${i}_${m.name.replace(/[^A-Za-z0-9]+/g, '_')}`;
    const input = (name: string, type: string, value: string | number) => `    <input name="${name}" type="${type}" value="${value}" />`;
    return [
      `  <standard_surface name="${node}" type="surfaceshader" makermaker_name="${attr(m.name)}" makermaker_bump="${m.bump}"${m.raster ? ` makermaker_raster="${m.raster}"` : ''}>`,
      input('base_color', 'color3', rgb(m.color)),
      input('metalness', 'float', m.reflection),
      input('specular_roughness', 'float', +Math.min(1, m.bump * 2).toFixed(4)),
      input('transmission', 'float', m.translucency),
      input('emission', 'float', m.glowStrength),
      input('emission_color', 'color3', rgb(m.glow)),
      '  </standard_surface>',
      `  <surfacematerial name="${node}_material" type="material">`,
      `    <input name="surfaceshader" type="surfaceshader" nodename="${node}" />`,
      '  </surfacematerial>',
    ];
  });
  return `<?xml version="1.0"?>\n<materialx version="1.38" colorspace="srgb_texture">\n${nodes.join('\n')}\n</materialx>\n`;
}

/** The materials of a MaterialX file; only standard_surface shaders are read, a file with none throws. */
export function fromMtlx(text: string): Material[] {
  const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const hex = (value: string | undefined, fallback: string) => {
    const parts = value?.split(',').map(parseFloat);
    if (parts?.length !== 3 || parts.some(Number.isNaN)) return fallback;
    return `#${parts.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
  };
  const shaders = [...text.matchAll(/<standard_surface\b([^>]*?)(?:\/>|>([\s\S]*?)<\/standard_surface>)/g)];
  if (!shaders.length) throw new Error('No materials in this file: it has no standard_surface');
  return shaders.map(([, attrs, body = '']) => {
    const attribute = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
    const inputs = new Map([...body.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
      const [name, value] = ['name', 'value'].map((k) => new RegExp(`\\b${k}="([^"]*)"`).exec(tag)?.[1]);
      return name && value !== undefined ? [[name, value] as const] : [];
    }));
    const number = (name: string, fallback: number) => {
      const v = parseFloat(inputs.get(name) ?? '');
      return Number.isNaN(v) ? fallback : Math.min(1, Math.max(0, v));
    };
    const raster = attribute('makermaker_raster');
    const bump = parseFloat(attribute('makermaker_bump') ?? '');
    return {
      ...plainLook(hex(inputs.get('base_color'), '#cccccc')),
      id: newId(),
      name: unescape(attribute('makermaker_name') ?? attribute('name') ?? 'Material'),
      bump: Number.isNaN(bump) ? number('specular_roughness', 0.7) / 2 : bump,
      reflection: number('metalness', 0),
      translucency: number('transmission', 0),
      glow: hex(inputs.get('emission_color'), '#ffffff'),
      glowStrength: number('emission', 0),
      ...(raster === 'metric' || raster === 'imperial' ? { raster } : {}),
    } satisfies Material;
  });
}

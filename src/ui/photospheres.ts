const files = import.meta.glob<string>('./photospheres/*.png', { query: '?url', import: 'default', eager: true });

/** The photo spheres that come with the app: in every document, not saved in any. */
export const BUILT_IN_PHOTOS = Object.entries(files)
  .filter(([path]) => !path.endsWith('_thumb.png'))
  .map(([path, data]) => {
    const file = path.slice('./photospheres/'.length, -'.png'.length);
    const name = file.replaceAll('_', ' ');
    return { id: `built-in:${file}`, name: name[0].toUpperCase() + name.slice(1), data, thumb: files[`./photospheres/${file}_thumb.png`] };
  });

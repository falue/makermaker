import { expect, it } from 'vitest';
import { tipHtml } from './tooltip';

it('formats a tooltip as the footer: title, lines, points, keys, stressed words, axes, gaps', () => {
  expect(tipHtml('# Move\nAlong X: [Tab] next\n\n- **Paper** 1 % <a & b>')).toBe(
    '<div class="tip-title">Move</div><div>Along <span class="axis-x">X</span>: <kbd>Tab</kbd> next</div><div class="tip-gap"></div><div class="tip-point"><b>Paper</b> 1 % &lt;a &amp; b&gt;</div>',
  );
  // a plain one stays one line
  expect(tipHtml('Click: Copy')).toBe('<div>Click: Copy</div>');
});

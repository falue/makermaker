import { expect, it } from 'vitest';
import { tipHtml } from './tooltip';

it('formats a tooltip as the footer: title, lines, points, keys, stressed words, axes, gaps', () => {
  expect(tipHtml('# Move\nAlong X: [Tab] next\n\n- **Paper** 1 % <a & b>')).toBe(
    '<div class="tip-title">Move</div><div>Along <span class="axis-x">X</span>: <kbd>Tab</kbd> next</div><div class="tip-gap"></div><div class="tip-point"><b>Paper</b> 1 % &lt;a &amp; b&gt;</div>',
  );
  // a tool's name before ": " white, on the first line only
  expect(tipHtml('Move (M): type distances\nThen: Enter')).toBe('<div><b>Move (M):</b> type distances</div><div>Then: Enter</div>');
  // a name alone (one short line) white; a longer line without a name as it is
  expect(tipHtml('Undo (⌘Z)')).toBe('<div><b>Undo (⌘Z)</b></div>');
  expect(tipHtml('The most a face may stretch flat, cut into gores past it')).toBe('<div>The most a face may stretch flat, cut into gores past it</div>');
});

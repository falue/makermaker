import { expect, it } from 'vitest';
import { score } from './commandBox';

const c = (name: string, hint = '') => ({ name, hint });

it('finds by the start of the name or a word, then inside it', () => {
  expect(score('ext', c('Extrude'))).toBe(0);
  expect(score('ske', c('New sketch'))).toBe(1);
  expect(score('trud', c('Extrude'))).toBe(2);
  expect(score('zzz', c('Extrude'))).toBeNull();
});

it('allows a typo (two from 6 letters), and finds by the hint from 3 letters', () => {
  expect(score('extrdue', c('Extrude'))).not.toBeNull();
  expect(score('skecth', c('New sketch'))).not.toBeNull();
  expect(score('mvoe', c('Move'))).not.toBeNull();
  expect(score('two', c('Cut', 'the bodies in two'))).toBe(5);
  expect(score('tw', c('Cut', 'the bodies in two'))).toBeNull();
});

it('a single letter puts the command with that key first', () => {
  expect(score('e', { name: 'Extrude', hint: '', keys: 'E' })).toBe(-1);
  expect(score('d', { name: 'Duplicate', hint: '', keys: '⌘D' })).toBe(0); // ⌘D is not D
  expect(score('e', { name: 'Export', hint: '' })).toBe(0);
});

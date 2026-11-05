import ACHIEVEMENTS from './rocket.json';
import { icon } from './icons';

/**
 * Rocket clicker: a little game at the bottom of the toolbar. Each click counts one, kept in this browser whatever
 * file is open; reaching an achievement's `at` (rocket.json) shows its text, and its `icon`, if any, from then on.
 */
const STORE = 'makermaker.rocket';
let count = 0;
try {
  count = Number(localStorage.getItem(STORE)) || 0;
} catch {
  // no storage: it counts this session only
}

const looks = () => ACHIEVEMENTS.filter((a) => 'icon' in a && a.at <= count).at(-1)?.icon ?? 'rocket';

/** The button and its counter above it (seen from the first click), built anew with each toolbar. */
export function rocket(notify: (message: string) => void) {
  // no tooltip: what it does is the surprise
  const button = Object.assign(document.createElement('button'), { className: 'tool', innerHTML: icon(looks()) });
  // its place kept before the first click, so the button never moves
  const counter = Object.assign(document.createElement('span'), { className: 'counter', textContent: String(count) });
  counter.style.visibility = count ? '' : 'hidden';
  button.onclick = () => {
    count++;
    try {
      localStorage.setItem(STORE, String(count));
    } catch {
      // kept for this session only
    }
    const won = ACHIEVEMENTS.find((a) => a.at === count);
    if (won) notify(won.text);
    button.innerHTML = icon(looks());
    counter.textContent = String(count);
    counter.style.visibility = '';
    counter.classList.remove('plop');
    void counter.offsetWidth; // restarts the animation
    counter.classList.add('plop');
  };
  const box = Object.assign(document.createElement('div'), { className: 'rocket' });
  box.append(counter, button);
  return box;
}

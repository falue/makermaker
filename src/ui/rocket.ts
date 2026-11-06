import ACHIEVEMENTS from './rocket.json';
import { icon } from './icons';

/**
 * Rocket clicker: a little game at the bottom of the toolbar. Each click counts one, kept in this browser whatever
 * file is open; reaching an achievement's `at` (rocket.json) shows its text, and its `icon`, if any, from then on.
 * Liftoff flies the rocket around the screen, stars pass behind it until it is home, mission complete fires fireworks.
 * With ?rocket in the address, each click jumps to the next icon instead, counting nothing.
 */
const STORE = 'makermaker.rocket';
const TEST = new URLSearchParams(location.search).has('rocket');
const STAGES = ACHIEVEMENTS.filter((a) => 'icon' in a);
const stage = (name: string) => STAGES.find((a) => a.icon === name)!.at;
const LIFTOFF = stage('liftoff');
const HOME = stage('missionComplete');
let count = 0;
let flying = false;
try {
  if (!TEST) count = Number(localStorage.getItem(STORE)) || 0;
} catch {
  // no storage: it counts this session only
}

const looks = () => STAGES.filter((a) => a.at <= count).at(-1)?.icon ?? 'rocket';

/** The button and its counter above it (seen from the first click), built anew with each toolbar. */
export function rocket(notify: (message: string) => void) {
  // no tooltip: what it does is the surprise
  const button = Object.assign(document.createElement('button'), { className: 'tool' });
  const show = () => {
    button.innerHTML = icon(looks());
    button.classList.toggle('space', count >= LIFTOFF && count < HOME);
    button.classList.toggle('flying', flying);
  };
  show();
  // its place kept before the first click, so the button never moves
  const counter = Object.assign(document.createElement('span'), { className: 'counter', textContent: String(count) });
  counter.style.visibility = count ? '' : 'hidden';
  button.onclick = () => {
    if (TEST) count = STAGES.find((a) => a.at > count)?.at ?? 0;
    else {
      count++;
      try {
        localStorage.setItem(STORE, String(count));
      } catch {
        // kept for this session only
      }
    }
    // before the message, which builds the toolbar anew
    if (count === LIFTOFF && !flying) fly();
    const won = ACHIEVEMENTS.find((a) => a.at === count);
    if (won) notify(won.text);
    if (count === HOME) fireworks();
    show();
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

/** Liftoff: the rocket darts about like a balloon let go, leaves at the top and comes down into its button again. */
function fly(roam = 3, speed = 650) {
  // the toolbar, and with it the button, is built anew on each message
  const home = () => {
    const r = document.querySelector('#toolbar .rocket .tool')!.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const el = Object.assign(document.createElement('div'), { className: 'rocket-flight', innerHTML: icon('liftoff') });
  document.body.append(el);
  flying = true;
  let [x, y] = home();
  let [a, wobble, t, puff] = [-Math.PI / 2, 0, 0, 0];
  let last = performance.now();
  const place = (turn: number) => (el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${turn}rad)`);
  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    // roams around the middle at first, then heads for the top
    const [tx, ty] = t < roam ? [innerWidth / 2, innerHeight / 2] : [x, -500];
    const off = Math.atan2(ty - y, tx - x) - a;
    wobble = Math.max(-9, Math.min(9, (wobble + (Math.random() - 0.5) * 80 * dt) * 0.97));
    a += (Math.atan2(Math.sin(off), Math.cos(off)) * 3 + wobble) * dt;
    // speeds up as it goes, as a balloon let go
    const v = speed * Math.min(1, 0.2 + t);
    x += Math.cos(a) * v * dt;
    y += Math.sin(a) * v * dt;
    place(a + Math.PI / 2);
    if ((puff += dt) > 0.04) {
      puff = 0;
      const p = Object.assign(document.createElement('div'), { className: 'rocket-puff' });
      p.style.transform = `translate(${x - Math.cos(a) * 18}px, ${y - Math.sin(a) * 18}px)`;
      p.onanimationend = () => p.remove();
      document.body.append(p);
    }
    if ((t > roam && y < -60) || t > roam + 5) land();
    else requestAnimationFrame(step);
  };
  // down from above the button, settling into it
  const land = () => {
    const [hx, hy] = home();
    el.animate(
      [
        { transform: `translate(${hx}px, -60px) translate(-50%, -50%)` },
        { transform: `translate(${hx}px, ${hy}px) translate(-50%, -50%)` },
      ],
      { duration: 1600, easing: 'cubic-bezier(.2,.7,.3,1)' },
    ).onfinish = () => {
      el.remove();
      flying = false;
      document.querySelector('#toolbar .rocket .flying')?.classList.remove('flying');
    };
  };
  requestAnimationFrame(step);
}

/** Mission complete: shells rise from the bottom and burst all over the screen for a few seconds. */
function fireworks(shells = 9, seconds = 4) {
  const canvas = Object.assign(document.createElement('canvas'), { className: 'fireworks' });
  const dpr = devicePixelRatio;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.append(canvas);
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  type Spark = { x: number; y: number; vx: number; vy: number; hue: number; life: number; shell?: number };
  const sparks: Spark[] = Array.from({ length: shells }, (_, i) => ({
    x: innerWidth * (0.15 + Math.random() * 0.7),
    y: innerHeight,
    vx: (Math.random() - 0.5) * 60,
    vy: -innerHeight * (0.9 + Math.random() * 0.25),
    hue: Math.random() * 360,
    life: 1,
    shell: (i * (seconds - 1.5)) / shells, // its launch time
  }));
  let last = performance.now();
  let t = 0;
  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    // fades what was drawn, leaving short trails
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(0, 0, innerWidth, innerHeight);
    g.globalCompositeOperation = 'lighter';
    for (const s of [...sparks]) {
      if (s.shell !== undefined && s.shell > t) continue;
      s.vy += (s.shell !== undefined ? innerHeight * 0.9 : 120) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // a shell bursts at its top
      if (s.shell !== undefined && s.vy >= 0) {
        sparks.splice(sparks.indexOf(s), 1);
        for (let i = 0; i < 70; i++) {
          const [d, v] = [Math.random() * Math.PI * 2, 60 + Math.random() * 220];
          sparks.push({ x: s.x, y: s.y, vx: Math.cos(d) * v, vy: Math.sin(d) * v, hue: s.hue + Math.random() * 40, life: 1 });
        }
        continue;
      }
      if (s.shell === undefined && (s.life -= dt / 1.6) <= 0) {
        sparks.splice(sparks.indexOf(s), 1);
        continue;
      }
      g.fillStyle = `hsla(${s.hue}, 100%, 65%, ${s.life})`;
      g.beginPath();
      g.arc(s.x, s.y, s.shell !== undefined ? 2 : 1.8, 0, Math.PI * 2);
      g.fill();
    }
    if (sparks.length) requestAnimationFrame(step);
    else canvas.remove();
  };
  requestAnimationFrame(step);
}

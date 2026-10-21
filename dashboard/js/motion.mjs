/* ─────────────────────────────────────────────────────────────────────────────
   Monaitor — motion helpers (all respect prefers-reduced-motion)
   ───────────────────────────────────────────────────────────────────────────── */

const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => mq.matches;

const easeOut = (t) => 1 - (1 - t) ** 3;

/** Animate a numeric readout from its current value to `to`. */
export function countUp(el, to, { format = (v) => String(Math.round(v)), duration = 900 } = {}) {
  const from = Number.isFinite(el._val) ? el._val : 0;
  el._val = to;
  cancelAnimationFrame(el._raf);
  if (reducedMotion() || from === to) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    el.textContent = format(from + (to - from) * easeOut(t));
    if (t < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}


/**
 * Damped spring on a set of numeric channels (semi-implicit Euler, fixed 1/240 s step).
 * `target()` sets goals; velocity carries over, so retargeting mid-flight stays fluid.
 */
export function spring(channels, onFrame, { stiffness = 520, damping = 30, mass = 1 } = {}) {
  const st = Object.fromEntries(Object.keys(channels).map((k) => [k, { x: channels[k], v: 0, to: channels[k] }]));
  const dt = 1 / 240;
  let raf = 0, last = 0, acc = 0;
  const emit = () => onFrame(Object.fromEntries(Object.entries(st).map(([k, c]) => [k, c.x])), st);
  const tick = (now) => {
    acc += Math.min(0.05, (now - last) / 1000);
    last = now;
    while (acc >= dt) {
      for (const c of Object.values(st)) {
        c.v += ((-stiffness * (c.x - c.to) - damping * c.v) / mass) * dt;
        c.x += c.v * dt;
      }
      acc -= dt;
    }
    const resting = Object.values(st).every((c) => Math.abs(c.v) < 0.05 && Math.abs(c.x - c.to) < 0.05);
    if (resting) {
      for (const c of Object.values(st)) { c.x = c.to; c.v = 0; }
      raf = 0;
    } else raf = requestAnimationFrame(tick);
    emit();
  };
  return {
    to(goal, { snap = false } = {}) {
      for (const [k, v] of Object.entries(goal)) {
        st[k].to = v;
        if (snap || reducedMotion()) { st[k].x = v; st[k].v = 0; }
      }
      if (snap || reducedMotion()) { cancelAnimationFrame(raf); raf = 0; emit(); return; }
      if (!raf) { last = performance.now(); acc = 0; raf = requestAnimationFrame(tick); }
    },
  };
}

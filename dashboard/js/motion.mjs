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

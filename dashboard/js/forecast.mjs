/* ─────────────────────────────────────────────────────────────────────────────
   Monaitor — forecast engine + the forecast view
   Forecasts always use each lab's full history; page filters do not apply.
   Every projection is shown next to the numbers it was built from.
   ───────────────────────────────────────────────────────────────────────────── */

import {
  DAY_MS, DOW_LONG, DOW_SHORT, TIERS, addDays, clear, daysBetween, flattenSignals, fmtDate, fmtShortDate, fmtWeekdayLong, h, hourOf, isLocalTime, launchDayGapDetails, pad2, startOfUTCDay, stats, tierOf, plural,
} from "./util.mjs?v=4";

/* ── engine ───────────────────────────────────────────────────────────────── */

function windowFromGaps(st, fallback) {
  const src = st.n >= 2 ? st : fallback;
  const med = Math.max(1, Math.round(src.median ?? 30));
  let lo = Math.max(1, Math.round(src.q1 ?? med * 0.7));
  let hi = Math.max(lo + 2, Math.round(src.q3 ?? med * 1.3));
  if (st.n < 4) { // thin history: don't pretend to be precise
    lo = Math.min(lo, Math.round(med * 0.7));
    hi = Math.max(hi, Math.round(med * 1.3));
  }
  return { med: Math.min(Math.max(med, lo), hi), lo, hi };
}

function statusFor(daysSince, med, lo, hi) {
  if (daysSince > hi) {
    const over = daysSince - hi;
    const key = daysSince > med * 2.5 ? "quiet" : "overdue";
    return { key, over, text: key === "quiet" ? "Unusually quiet" : `Overdue by ${plural(over, "day")}`, rank: key === "quiet" ? 2 : 0 };
  }
  if (daysSince >= lo) return { key: "window", over: 0, text: "In window", rank: 1 };
  return { key: "ahead", over: 0, text: `Opens in ${plural(lo - daysSince, "day")}`, rank: 3 };
}

function hourWindow(timed) {
  if (!timed.length) return null;
  const hours = timed.map((r) => hourOf(r.ts));
  let best = null;
  for (let s = 0; s < 24; s++) {
    const count = hours.filter((hr) => (hr - s + 24) % 24 < 3).length;
    if (!best || count > best.count) best = { start: s, count };
  }
  return { start: best.start, end: (best.start + 3) % 24, count: best.count, n: timed.length };
}

export function buildForecasts(data, now) {
  const today = startOfUTCDay(now);
  const g = data.globalGapStats || {};
  const globalWin = { median: g.median ?? 30, q1: g.q1 ?? 14, q3: g.q3 ?? 45 };

  const out = data.loadedLabs.map(({ id }) => {
    const all = data.releases.filter((r) => r.lab_id === id).sort((a, b) => a.ts - b.ts);
    const lab = all[0].lab;
    const last = all[all.length - 1];
    const lastDay = last.dayStart;
    const lastBatch = all.filter((r) => r.dayStart === lastDay);

    const gapList = launchDayGapDetails(all);
    const gaps = gapList.map((x) => x.gap);
    const st = stats(gaps);
    const { med, lo, hi } = windowFromGaps(st, globalWin);
    const daysSince = daysBetween(lastDay, today);
    const status = statusFor(daysSince, med, lo, hi);

    const startTs = addDays(lastDay, lo);
    const endTs = addDays(lastDay, hi);
    const targetTs = addDays(lastDay, med);

    const recentGaps = gaps.slice(-4);
    const recentN = recentGaps.length;
    const recentMedian = recentGaps.length >= 3 ? stats(recentGaps).median : null;

    // weekday distribution over distinct launch days
    const days = [...new Set(all.map((r) => r.dayStart))];
    const weekdayCounts = Array(7).fill(0);
    for (const d of days) weekdayCounts[(new Date(d).getUTCDay() + 6) % 7]++;
    const topWeekday = weekdayCounts.indexOf(Math.max(...weekdayCounts));

    // first occurrence of the modal weekday on/after max(today, window start)
    let slot = Math.max(today, startTs);
    for (let i = 0; i < 7 && (new Date(slot).getUTCDay() + 6) % 7 !== topWeekday; i++) slot += DAY_MS;

    const timed = all.filter((r) => r.hasTime);

    const tierRows = TIERS.map((t) => {
      const recs = all.filter((r) => r.tier === t.id);
      if (!recs.length) return null;
      const tl = recs[recs.length - 1];
      const tgaps = launchDayGapDetails(recs).map((x) => x.gap);
      const tst = stats(tgaps);
      const row = { tier: t, count: recs.length, last: tl, n: tst.n, median: tst.median };
      if (tst.n >= 2) {
        const w = windowFromGaps(tst, globalWin);
        const since = daysBetween(tl.dayStart, today);
        row.target = addDays(tl.dayStart, w.med);
        row.status = statusFor(since, w.med, w.lo, w.hi);
        row.range = [w.lo, w.hi];
      }
      return row;
    }).filter(Boolean);

    const signals = [];
    const seen = new Set();
    for (const r of [...all].reverse().slice(0, 12)) {
      for (const text of flattenSignals(r)) {
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        signals.push({ text, release: r });
      }
    }

    const evidence = st.n >= 8 ? "solid" : st.n >= 4 ? "fair" : "thin";

    return {
      id, lab, all, last, lastDay, lastBatch, count: all.length,
      gaps, gapList, st, med, lo, hi, recentMedian, recentN,
      daysSince, status, startTs, endTs, targetTs,
      weekdayCounts, topWeekday, slot, timed, timedCount: timed.length,
      tierRows, signals: signals.slice(0, 6), evidence,
      scaleMax: Math.max(hi * 1.22, daysSince * 1.08, 14),
    };
  });

  return out.sort((a, b) => a.status.rank - b.status.rank
    || (a.status.rank === 0 ? b.daysSince / b.med - a.daysSince / a.med : a.targetTs - b.targetTs));
}

/* ── rendering ────────────────────────────────────────────────────────────── */

const pct = (v, max) => `${Math.min(100, Math.max(0, (v / max) * 100)).toFixed(2)}%`;
const hourLabel = (hr) => `${pad2(hr)}:00`;
const joinNames = (names) => (names.length <= 1 ? names[0] || "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function ruler(f) {
  const max = f.scaleMax;
  const live = f.status.key !== "ahead";
  return h("div", {
    class: `ruler is-${f.status.key}`,
    role: "img",
    "aria-label": `${f.lab.name}: day ${f.daysSince} since last release. Typical gap ${f.lo} to ${f.hi} days, median ${f.med}.`,
  },
  h("span", { class: "ruler-line" }),
  h("span", { class: "ruler-band", style: { left: pct(f.lo, max), width: pct(f.hi - f.lo, max) } }),
  h("span", { class: "ruler-elapsed", style: { width: pct(Math.min(f.daysSince, f.hi), max) } }),
  f.daysSince > f.hi ? h("span", { class: "ruler-over", style: { left: pct(f.hi, max), width: pct(f.daysSince - f.hi, max) } }) : null,
  h("span", { class: "ruler-median", style: { left: pct(f.med, max) } }),
  h("span", { class: "ruler-last" }),
  h("span", { class: `ruler-today${live ? " is-live" : ""}`, style: { left: pct(f.daysSince, max) } }),
  );
}

function weekdayBars(f) {
  const max = Math.max(...f.weekdayCounts, 1);
  return h("div", { class: "wk", role: "img", "aria-label": `Launch days by weekday: ${DOW_SHORT.map((d, i) => `${d} ${f.weekdayCounts[i]}`).join(", ")}` },
    DOW_SHORT.map((d, i) => h("div", { class: `wk-col${i === f.topWeekday ? " is-top" : ""}`, title: `${DOW_LONG[i]}: ${f.weekdayCounts[i]} launch days` },
      h("span", { class: "wk-bar", style: { "--v": (f.weekdayCounts[i] / max).toFixed(3) } }),
      h("span", { class: "wk-day" }, d[0]),
    )));
}

function releaseChip(r, onOpen) {
  return h("button", { class: "mini-release", type: "button", onclick: () => onOpen(r.uid) },
    h("span", { class: "mini-name" }, r.model_name),
    h("span", { class: "mini-date" }, fmtShortDate(r.dayStart)),
  );
}

/** Every past gap as a bar, with the forecast window drawn over it, so the prediction can be second-guessed. */
function gapHistory(f) {
  const max = Math.max(...f.gaps, f.hi, f.daysSince, 1) * 1.08;
  const labelled = f.gapList.length <= 16;
  const bars = f.gapList.map((g) => h("span", {
    class: "gh-bar", style: { "--h": pct(g.gap, max) },
    title: `${plural(g.gap, "day")} · ${fmtShortDate(g.from)} → ${fmtShortDate(g.to)}`,
  }, labelled ? h("em", {}, g.gap) : null));
  bars.push(h("span", {
    class: "gh-bar is-now", style: { "--h": pct(f.daysSince, max) },
    title: `${plural(f.daysSince, "day")} so far · since ${fmtShortDate(f.lastDay)}`,
  }, h("em", {}, f.daysSince)));

  return h("div", { class: "fc-block fc-wide" },
    h("h4", {}, "Gap history"),
    h("div", { class: "gh", role: "img", "aria-label": `Days between launches, oldest first: ${f.gaps.join(", ") || "none yet"}. Current wait: ${f.daysSince} days.` },
      h("span", { class: "gh-band", style: { bottom: pct(f.lo, max), height: pct(f.hi - f.lo, max) } }),
      h("span", { class: "gh-med", style: { bottom: pct(f.med, max) } }),
      h("div", { class: "gh-bars" }, bars)),
    h("p", { class: "fine" },
      "Days between launches, oldest first. The outlined bar is the wait so far. Shaded band is the forecast window (",
      h("span", { class: "num" }, `${f.lo}–${f.hi}d`), "), the line is the median (", h("span", { class: "num" }, `${f.med}d`), ")."),
    f.gaps.length ? h("p", { class: "fine num gap-list" }, f.gaps.join(" · ")) : h("p", { class: "fine" }, "Only one launch day so far, so there are no gaps yet."),
  );
}

function detail(f, { onFocusLab, onOpen }) {
  const weekdayShare = Math.round((f.weekdayCounts[f.topWeekday] / (f.gaps.length + 1)) * 100);
  const cadence = h("div", { class: "fc-block" },
    h("h4", {}, "Cadence"),
    h("dl", { class: "kv" },
      h("dt", {}, "Typical gap"), h("dd", {}, `${f.lo}–${f.hi} days`, h("small", {}, ` median ${f.med}`)),
      f.st.n ? [h("dt", {}, "Observed range"), h("dd", {}, `${f.st.min}–${f.st.max} days`)] : null,
      h("dt", {}, "Projected window"), h("dd", {}, `${fmtShortDate(f.startTs)} – ${fmtShortDate(f.endTs)}`),
      h("dt", {}, "Centre"), h("dd", {}, fmtDate(f.targetTs)),
      f.recentMedian != null ? [h("dt", {}, `Last ${f.recentN} gaps`), h("dd", {}, `median ${Math.round(f.recentMedian)} days`)] : null,
      h("dt", {}, "Evidence"), h("dd", {}, `${f.st.n} gaps · ${f.evidence}`),
    ),
    f.evidence === "thin" ? h("p", { class: "fine" }, "Few releases so far, so the window is widened and should be read loosely.") : null,
  );

  const hourLine = h("p", { class: "lead-sm" });
  const hourFallback = h("p", { class: "fine" });

  function paintHours() {
    const hrs = hourWindow(f.timed);
    clear(hourLine);
    clear(hourFallback);
    const enough = hrs && hrs.n >= 3 && hrs.count >= 2;
    hourLine.hidden = !enough;
    hourFallback.hidden = enough;
    if (enough) {
      hourLine.append(
        h("strong", {}, `${hourLabel(hrs.start)}–${hourLabel(hrs.end)} ${isLocalTime() ? "local" : "UTC"}`),
        ` · ${hrs.count} of ${hrs.n} timed releases`,
      );
    } else {
      hourFallback.textContent = hrs
        ? `Only ${hrs.n} releases have a known time, and they are too few or too scattered for an hour estimate.`
        : "No release times known yet.";
    }
  }
  paintHours();

  const when = h("div", { class: "fc-block" },
    h("h4", {}, "Likely timing"),
    weekdayBars(f),
    h("p", { class: "lead-sm" },
      h("strong", {}, DOW_LONG[f.topWeekday]),
      ` · ${weekdayShare}% of launch days`),
    hourLine,
    hourFallback,
    f.timedCount ? h("p", { class: "fine" }, `Hour data covers ${f.timedCount} of ${f.count} releases; the rest have no time and are excluded.`) : null,
    h("p", { class: "fine" }, "Earliest likely slot: ", h("strong", {}, `${fmtWeekdayLong(f.slot)} ${fmtShortDate(f.slot)}`)),
  );

  const tierList = f.tierRows.map((t) => h("li", {},
    h("span", { class: "tr-name" }, tierOf(t.tier.id).label),
    h("span", { class: "tr-meta" },
      t.median != null ? `every ~${Math.round(t.median)}d` : "single release",
      " · last ", fmtShortDate(t.last.dayStart)),
    t.status
      ? h("span", { class: `tr-status is-${t.status.key}` }, t.status.key === "ahead" ? `due ~${fmtShortDate(t.target)}` : t.status.key === "window" ? "in window" : "overdue")
      : h("span", { class: "tr-status" }, "—"),
  ));

  const signals = h("div", { class: "fc-block" },
    h("h4", {}, "Signals seen before past launches"),
    f.signals.length
      ? h("ul", { class: "signals" }, f.signals.map((s) => h("li", {},
        h("span", { class: "sig-text" }, s.text),
        h("button", { class: "sig-src", type: "button", onclick: () => onOpen(s.release.uid), title: `Open ${s.release.model_name}` }, s.release.model_name))))
      : h("p", { class: "fine" }, "No codenames, arena sightings or leaks recorded for this lab’s recent releases."),
  );

  const byTier = h("div", { class: "fc-block" },
    h("h4", {}, "By tier"),
    h("ul", { class: "tier-rows" }, tierList),
  );

  const recent = h("div", { class: "fc-block" },
    h("h4", {}, "Latest releases"),
    h("div", { class: "mini-list" }, [...f.all].reverse().slice(0, 4).map((r) => releaseChip(r, onOpen))),
    h("button", { class: "link-btn", type: "button", onclick: () => onFocusLab(f.id) }, `See all ${f.count} ${f.lab.name} releases →`),
  );

  const el = h("div", { class: "fc-detail" }, gapHistory(f), cadence, when, byTier, signals, recent);
  el.refreshTimes = paintHours;
  return el;
}

function row(f, idx, ctx) {
  const panelId = `fc-panel-${f.id}`;
  const lastName = f.lastBatch.length > 1 ? `${f.last.model_name} +${f.lastBatch.length - 1}` : f.last.model_name;
  const btn = h("button", {
    class: "fc-summary", type: "button", "aria-expanded": "false", "aria-controls": panelId,
    onclick: () => toggle(rowEl, btn),
  },
  h("span", { class: "fc-lab" },
    h("span", { class: "fc-name" }, h("i", { class: "lab-dot", style: { background: f.lab.color } }), f.lab.name),
    h("span", { class: "fc-last" }, `${lastName} · ${fmtShortDate(f.last.dayStart)}`)),
  ruler(f),
  h("span", { class: "fc-num fc-day" }, h("b", {}, String(f.daysSince)), h("small", {}, "since last")),
  h("span", { class: "fc-num fc-gap" }, h("b", {}, `${f.lo}–${f.hi}d`), h("small", {}, `median ${f.med} · ${plural(f.st.n, "gap")}`)),
  h("span", { class: "fc-num fc-win" }, h("b", {}, `${fmtShortDate(f.startTs)} – ${fmtShortDate(f.endTs)}`), h("small", {}, `centre ${fmtShortDate(f.targetTs)}`)),
  h("span", { class: "fc-status" },
    h("span", { class: `fc-state is-${f.status.key}` }, f.status.text),
    h("span", { class: "fc-sub" }, `${f.evidence} evidence`)),
  h("span", { class: "chev", "aria-hidden": "true" }),
  );
  const detailEl = detail(f, ctx);
  const panel = h("div", { class: "fc-panel", id: panelId, role: "region", "aria-label": `${f.lab.name} forecast details` },
    h("div", { class: "fc-panel-inner" }, detailEl));
  const rowEl = h("li", { class: `fc-row is-${f.status.key}`, style: { "--i": idx } }, btn, panel);
  rowEl.refreshTimes = detailEl.refreshTimes;
  return rowEl;
}

function toggle(rowEl, btn, force) {
  const open = force ?? btn.getAttribute("aria-expanded") !== "true";
  btn.setAttribute("aria-expanded", String(open));
  rowEl.classList.toggle("is-open", open);
}

const SORTS = [
  { key: "lab", label: "Lab", dir: "asc", cmp: (a, b) => a.lab.name.localeCompare(b.lab.name), cls: "fc-h-lab" },
  { key: "line", label: "Waiting line", cls: "fc-h-line" },
  { key: "day", label: "Days", dir: "desc", cmp: (a, b) => a.daysSince - b.daysSince, cls: "fc-h-day" },
  { key: "gap", label: "Usual gap", dir: "asc", cmp: (a, b) => a.med - b.med, cls: "fc-h-gap" },
  { key: "win", label: "Window", dir: "asc", cmp: (a, b) => a.startTs - b.startTs, cls: "fc-h-win" },
  { key: "status", label: "Status", dir: "asc", cmp: null, cls: "fc-h-status" }, // null = original urgency order
];

export function renderForecast(container, headlineEl, forecasts, ctx) {
  clear(container);
  const rank = new Map(forecasts.map((f, i) => [f.id, i]));
  const els = new Map(forecasts.map((f, i) => [f.id, row(f, i, ctx)]));
  const list = h("ul", { class: "fc-list" }, [...els.values()]);
  const state = { key: "status", dir: "asc" };

  const heads = new Map();
  const head = h("div", { class: "fc-head" }, SORTS.map((s) => {
    if (!s.dir) return h("span", { class: s.cls }, s.label);
    const th = h("button", { type: "button", class: `th-btn ${s.cls}`, onclick: () => sortBy(s) }, s.label, h("span", { class: "th-arrow", "aria-hidden": "true" }));
    heads.set(s.key, th);
    return th;
  }), h("span", { class: "fc-h-chev" }));

  function paintHeads() {
    for (const [key, el] of heads) {
      const on = key === state.key;
      el.classList.toggle("is-sorted", on);
      el.classList.toggle("is-desc", on && state.dir === "desc");
      el.setAttribute("aria-label", `Sort by ${SORTS.find((x) => x.key === key).label}${on ? `, currently ${state.dir === "asc" ? "ascending" : "descending"}` : ""}`);
    }
  }

  function sortBy(s) {
    state.dir = state.key === s.key ? (state.dir === "asc" ? "desc" : "asc") : s.dir;
    state.key = s.key;
    const sign = state.dir === "asc" ? 1 : -1;
    const cmp = s.cmp || ((a, b) => rank.get(a.id) - rank.get(b.id));
    list.append(...[...forecasts].sort((a, b) => cmp(a, b) * sign || rank.get(a.id) - rank.get(b.id)).map((f) => els.get(f.id)));
    paintHeads();
  }

  container.append(head, list);
  paintHeads();

  const loud = forecasts.filter((f) => f.status.rank <= 1);
  clear(headlineEl);
  if (loud.length) {
    const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
    headlineEl.append(
      ...(loud.length <= 3
        ? [h("span", { class: "accent" }, joinNames(loud.map((f) => f.lab.name.split(" / ")[0])))]
        : [h("span", { class: "accent" }, WORDS[loud.length] || String(loud.length)), ` of ${forecasts.length} labs`]),
      ` ${loud.length === 1 ? "is" : "are"} due.`,
    );
  } else {
    const next = forecasts.find((f) => f.status.key === "ahead");
    if (next) headlineEl.append("Nothing is due yet. ", h("span", { class: "accent" }, next.lab.name.split(" / ")[0]), " is next.");
    else headlineEl.append("The field is quiet.");
  }
  return {
    list,
    refreshTimes() {
      for (const el of els.values()) el.refreshTimes?.();
    },
  };
}

export function forecastLede(forecasts) {
  const loud = forecasts.filter((f) => f.status.rank <= 1);
  const quiet = forecasts.filter((f) => f.status.key === "quiet");
  const top = loud[0];
  const bits = [];
  if (top) {
    bits.push(top.status.key === "window"
      ? `${top.lab.name} sits inside its usual release window — day ${top.daysSince} against a typical ${top.lo}–${top.hi}.`
      : `${top.lab.name} is furthest past its usual rhythm: day ${top.daysSince} against a typical ${top.lo}–${top.hi}.`);
  }
  if (quiet.length) bits.push(`${joinNames(quiet.map((f) => f.lab.name.split(" / ")[0]))} ${quiet.length === 1 ? "has" : "have"} been unusually quiet.`);
  bits.push("Each line counts days since a lab’s last release; the shaded band is its typical gap. Open a lab to see the gaps behind its forecast.");
  return bits.join(" ");
}

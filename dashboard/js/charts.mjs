/* ─────────────────────────────────────────────────────────────────────────────
   Monaitor — KPIs, timeline, rhythm and cadence views.
   Charts are plain DOM/SVG-free (positioned elements) styled by CSS variables,
   so theme switches recolour them with no re-render. Each builder renders once
   and returns update(filteredSet) so filter changes animate rather than rebuild.
   ───────────────────────────────────────────────────────────────────────────── */

import {
  DAY_MS, DOW_LONG, DOW_SHORT, LAB_BY_ID, MONTHS, TIERS, clear, countBy, fmtDays, fmtInt, fmtReleaseShortDate, fmtWhen, h, hourOf, isLocalTime, launchDayGapDetails, median, pad2, plural, quantile, releaseDayIndex, tierOf, typeOf, groupBy, fmtShortDate,
} from "./util.mjs?v=4";
import { countUp } from "./motion.mjs?v=5";

/* ── tooltip ──────────────────────────────────────────────────────────────── */

function placeTip(tip, anchor) {
  const r = anchor.getBoundingClientRect();
  const fresh = !tip.classList.contains("on");
  if (fresh) tip.style.transition = "none";
  tip.classList.add("on");
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2;
  x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
  let y = r.top - th - 12;
  const below = y < 8;
  if (below) y = r.bottom + 12;
  tip.style.setProperty("--x", `${Math.round(x)}px`);
  tip.style.setProperty("--y", `${Math.round(y)}px`);
  tip.classList.toggle("below", below);
  if (fresh) {
    void tip.offsetWidth;
    tip.style.transition = "";
  }
}

export function createTooltip() {
  const tip = h("div", { class: "tip", role: "tooltip", id: "tip" });
  document.body.append(tip);
  let active = null;
  return {
    show(anchor, release) {
      active = anchor;
      clear(tip).append(
        h("div", { class: "tip-lab" }, h("i", { class: "lab-dot", style: { background: release.lab.color } }), release.lab.name),
        h("div", { class: "tip-name" }, release.model_name),
        h("div", { class: "tip-meta" }, fmtWhen(release)),
        h("div", { class: "tip-meta" }, `${tierOf(release.tier).label} · ${typeOf(release.release_type).label}`),
      );
      placeTip(tip, anchor);
    },
    hide(anchor) {
      if (anchor && anchor !== active) return;
      tip.classList.remove("on");
      active = null;
    },
  };
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export function buildKpis(container, now) {
  const mk = (key, label) => {
    const value = h("div", { class: "kpi-value" });
    const sub = h("div", { class: "kpi-sub" });
    const el = h("div", { class: "kpi", dataset: { key } }, h("div", { class: "kpi-label" }, label), value, sub);
    container.append(el);
    return { el, value, sub };
  };
  const total = mk("total", "Releases");
  const recent = mk("recent", "Last 30 days");
  const active = mk("active", "Most active lab");
  const open = mk("open", "Open-weights share");

  return function update(rows, all) {
    countUp(total.value, rows.length, { format: (v) => fmtInt(Math.round(v)) });
    total.sub.textContent = rows.length === all.length
      ? `across ${new Set(rows.map((r) => r.lab_id)).size} labs`
      : `of ${fmtInt(all.length)} tracked`;

    const d30 = now - 30 * DAY_MS;
    const d60 = now - 60 * DAY_MS;
    const cur = rows.filter((r) => r.ts > d30 && r.ts <= now + DAY_MS).length;
    const prev = rows.filter((r) => r.ts > d60 && r.ts <= d30).length;
    countUp(recent.value, cur, { format: (v) => fmtInt(Math.round(v)) });
    const delta = cur - prev;
    recent.sub.textContent = `${delta === 0 ? "same as" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} vs`} the 30 days before`;

    const counts = countBy(rows, (r) => r.lab_id);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const lab = LAB_BY_ID[top[0]];
      active.value.textContent = lab.name.split(" / ")[0];
      active.value.classList.add("is-text");
      clear(active.sub).append(`${plural(top[1], "release")} · ${Math.round((top[1] / rows.length) * 100)}% of the total`);
    } else {
      active.value.textContent = "—";
      active.sub.textContent = "no releases match";
    }

    const ow = rows.filter((r) => r.open_weights).length;
    const share = rows.length ? (ow / rows.length) * 100 : 0;
    countUp(open.value, share, { format: (v) => `${Math.round(v)}%` });
    open.sub.textContent = `${fmtInt(ow)} of ${fmtInt(rows.length)} ship open weights`;
  };
}

/* ── timeline ─────────────────────────────────────────────────────────────── */

const TIER_FORM = { flagship: "t-flag", mid: "t-mid", fast: "t-fast", "open-weights-small": "t-open", specialized: "t-spec" };
const LANE_ROWS = [0, 1, 2, 3];

export function tierKey(container) {
  container.append(...TIERS.map((t) => h("span", { class: "key-item" },
    h("i", { class: `mk ${TIER_FORM[t.id]}` }), h("span", {}, t.label))));
}

export function buildTimeline(container, releases, { now, tooltip, onOpen }) {
  const t0 = Date.UTC(2026, 0, 1);
  const end = Math.max(now, ...releases.map((r) => r.ts)) + 6 * DAY_MS;
  const span = end - t0;
  const x = (ts) => ((ts - t0) / span) * 100;

  const counts = countBy(releases, (r) => r.lab_id);
  const labs = [...new Set(releases.map((r) => r.lab_id))].sort((a, b) => counts.get(b) - counts.get(a));

  const grid = h("div", { class: "tl-grid", "aria-hidden": "true" });
  for (let m = 0; m < 12; m++) {
    const ts = Date.UTC(2026, m, 1);
    if (ts > end) break;
    grid.append(h("span", { class: "tl-month", style: { left: `${x(ts)}%` } }, h("em", {}, MONTHS[m])));
  }
  grid.append(h("span", { class: "tl-today", style: { left: `${x(now)}%` } }, h("em", {}, "Today")));

  const markers = new Map();
  const lanes = new Map();
  const body = h("div", { class: "tl-body" });
  const inner = h("div", { class: "tl-inner" }, grid, body);

  for (const labId of labs) {
    const lab = LAB_BY_ID[labId];
    const list = releases.filter((r) => r.lab_id === labId).sort((a, b) => a.ts - b.ts);
    const rowEnds = LANE_ROWS.map(() => -Infinity);
    const track = h("div", { class: "tl-track" });
    for (const r of list) {
      const px = x(r.ts);
      let row = rowEnds.findIndex((e) => px - e > 1.15);
      if (row < 0) row = rowEnds.indexOf(Math.min(...rowEnds));
      rowEnds[row] = px;
      const btn = h("button", {
        class: `tl-dot ${TIER_FORM[r.tier] || "t-spec"}`,
        type: "button",
        tabindex: "-1",
        "aria-label": `${r.model_name}, ${lab.name}, ${fmtWhen(r)}. Open details`,
        style: { left: `${px}%`, "--dy": `${[0, -11, 11, -22][row] ?? 0}px` },
        onmouseenter: () => tooltip.show(btn, r),
        onmouseleave: () => tooltip.hide(btn),
        onfocus: () => tooltip.show(btn, r),
        onblur: () => tooltip.hide(btn),
        onclick: () => onOpen(r.uid),
      });
      markers.set(r.uid, btn);
      track.append(btn);
    }
    const laneEl = h("div", {
      class: "tl-lane", role: "group", tabindex: "0", style: { "--c": lab.color },
      "aria-label": `${lab.name}: ${plural(list.length, "release")}. Use left and right arrow keys to step through, Enter to open.`,
      onkeydown(e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const vis = [...track.querySelectorAll(".tl-dot:not(.is-off)")].sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left));
        if (!vis.length) return;
        const i = vis.indexOf(document.activeElement);
        const next = e.key === "ArrowRight" ? vis[Math.min(vis.length - 1, i + 1)] : vis[Math.max(0, i < 0 ? 0 : i - 1)];
        next.focus();
        e.preventDefault();
      },
    },
    h("div", { class: "tl-label" }, h("i", { class: "lab-dot", style: { background: lab.color } }), lab.name.split(" / ")[0]),
    track);
    lanes.set(labId, laneEl);
    body.append(laneEl);
  }

  clear(container).append(h("div", { class: "tl-scroll" }, inner));

  return function update(rows) {
    const on = new Set(rows.map((r) => r.uid));
    const perLab = new Set();
    for (const [uid, btn] of markers) btn.classList.toggle("is-off", !on.has(uid));
    for (const r of releases) {
      const btn = markers.get(r.uid);
      if (btn) btn.setAttribute("aria-label", `${r.model_name}, ${r.lab.name}, ${fmtWhen(r)}. Open details`);
    }
    for (const r of rows) perLab.add(r.lab_id);
    for (const [id, el] of lanes) el.classList.toggle("is-empty", !perLab.has(id));
  };
}

/* ── buckets: hover a number to see the releases behind it ────────────────── */

const TIP_ITEMS = 8;

/** Hover preview: the first few release names in a bucket. */
export function createBucketTip() {
  const tip = h("div", { class: "tip tip-list", role: "tooltip" });
  document.body.append(tip);
  let active = null;
  return {
    show(anchor, { title, note, rows }) {
      active = anchor;
      const shown = rows.slice(0, TIP_ITEMS);
      clear(tip).append(...[
        h("div", { class: "tip-lab" }, title),
        h("div", { class: "tip-name" }, plural(rows.length, "release")),
        note ? h("div", { class: "tip-meta" }, note) : null,
        h("ul", { class: "tip-items" }, shown.map((r) => h("li", {}, h("i", { class: "lab-dot", style: { background: r.lab.color } }), h("span", {}, r.model_name)))),
        h("div", { class: "tip-more" }, rows.length > shown.length ? `+${rows.length - shown.length} more · click to list all` : "Click to pin this list"),
      ].filter(Boolean));
      placeTip(tip, anchor);
    },
    hide(anchor) {
      if (anchor && anchor !== active) return;
      tip.classList.remove("on");
      active = null;
    },
  };
}

/** Pinned list: every release in the clicked bucket, each one opens its detail sheet. */
function createBucketPanel(host, onOpen) {
  const panel = h("div", { class: "bucket", hidden: true, role: "region", "aria-label": "Releases in the selected bucket" });
  host.append(panel);
  let pinned = null;
  const hide = () => {
    pinned?.classList.remove("is-pinned");
    pinned = null;
    panel.hidden = true;
    clear(panel);
  };
  return {
    hide,
    toggle(el, { title, rows }) {
      if (pinned === el) return hide();
      pinned?.classList.remove("is-pinned");
      pinned = el;
      el.classList.add("is-pinned");
      clear(panel).append(
        h("div", { class: "bucket-head" },
          h("p", {}, h("span", { class: "bucket-title" }, title), h("span", { class: "dim" }, ` · ${plural(rows.length, "release")}`)),
          h("button", { class: "icon-btn", type: "button", "aria-label": "Close list", onclick: hide }, h("span", { class: "x", "aria-hidden": "true" }))),
        h("div", { class: "bucket-list" }, rows.map((r) => h("button", { class: "bk-item", type: "button", onclick: () => onOpen(r.uid) },
          h("span", { class: "bk-date num" }, fmtReleaseShortDate(r)),
          h("span", { class: "bk-name" }, r.model_name),
          h("span", { class: "bk-lab" }, h("i", { class: "lab-dot", style: { background: r.lab.color } }), r.lab.name.split(" / ")[0])))),
      );
      panel.hidden = false;
    },
  };
}

/** Make `el` hover/focus-previewable and click/Enter-pinnable. `get()` is read lazily so filter changes are picked up. */
function wireBucket(el, get, panel, tip) {
  const enter = () => { const b = get(); if (b.rows.length) tip.show(el, b); };
  const pin = () => { const b = get(); if (b.rows.length) { tip.hide(el); panel.toggle(el, b); } };
  el.addEventListener("mouseenter", enter);
  el.addEventListener("focus", enter);
  el.addEventListener("mouseleave", () => tip.hide(el));
  el.addEventListener("blur", () => tip.hide(el));
  el.addEventListener("click", pin);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pin(); }
  });
}

/** Keyboard/AT affordance for a bucket that has (or no longer has) releases. */
function armBucket(el, n, label) {
  if (n) {
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-label", `${label}: ${plural(n, "release")}. Press Enter to list them.`);
  } else {
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
    el.tabIndex = -1;
  }
}

/* ── rhythm: weekday + hour ───────────────────────────────────────────────── */

function barChart(n, labelFn, { cls = "" } = {}) {
  const cols = [];
  const wrap = h("div", { class: `bars ${cls}` });
  for (let i = 0; i < n; i++) {
    const fill = h("span", { class: "bar-fill" });
    const val = h("span", { class: "bar-val" });
    const col = h("div", { class: "bar" }, val, h("div", { class: "bar-well" }, fill), h("span", { class: "bar-label" }, labelFn(i)));
    cols.push({ col, fill, val });
    wrap.append(col);
  }
  return { wrap, cols };
}

export function buildRhythm(weekdayEl, hourEl, weekdayNote, hourNote, { tip, onOpen }) {
  const wk = barChart(7, (i) => DOW_SHORT[i], { cls: "bars-wk" });
  const hr = barChart(24, (i) => (i % 3 === 0 ? pad2(i) : ""), { cls: "bars-hr" });
  weekdayEl.append(wk.wrap);
  hourEl.append(hr.wrap);

  const wkPanel = createBucketPanel(weekdayEl.closest("figure"), onOpen);
  const hrPanel = createBucketPanel(hourEl.closest("figure"), onOpen);
  let wkRows = Array.from({ length: 7 }, () => []);
  let hrRows = Array.from({ length: 24 }, () => []);
  const hourTitle = (i) => `${pad2(i)}:00–${pad2(i)}:59 ${isLocalTime() ? "local" : "UTC"}`;
  wk.cols.forEach((c, i) => wireBucket(c.col, () => ({ title: DOW_LONG[i], rows: wkRows[i] }), wkPanel, tip));
  hr.cols.forEach((c, i) => wireBucket(c.col, () => ({ title: hourTitle(i), rows: hrRows[i] }), hrPanel, tip));

  const paint = (chart, values, totalLabel) => {
    const max = Math.max(...values, 1);
    const peak = values.indexOf(Math.max(...values));
    chart.cols.forEach((c, i) => {
      c.fill.style.height = `${(values[i] / max) * 100}%`;
      c.col.classList.toggle("is-peak", values[i] > 0 && i === peak);
      c.val.textContent = values[i] || "";
      armBucket(c.col, values[i], totalLabel(i));
    });
  };

  return function update(rows) {
    tip.hide();
    wkPanel.hide();
    hrPanel.hide();

    const wkv = Array(7).fill(0);
    wkRows = Array.from({ length: 7 }, () => []);
    for (const r of rows) { const day = releaseDayIndex(r); wkv[day]++; wkRows[day].push(r); }
    paint(wk, wkv, (i) => DOW_LONG[i]);

    const timed = rows.filter((r) => r.hasTime);
    const hv = Array(24).fill(0);
    hrRows = Array.from({ length: 24 }, () => []);
    for (const r of timed) { const hr24 = hourOf(r.ts); hv[hr24]++; hrRows[hr24].push(r); }
    paint(hr, hv, (i) => hourTitle(i));

    // captions
    const mid = wkv[1] + wkv[2] + wkv[3];
    const peakDay = wkv.indexOf(Math.max(...wkv));
    weekdayNote.textContent = rows.length
      ? `${DOW_LONG[peakDay]} is the busiest day. Tuesday to Thursday carry ${Math.round((mid / rows.length) * 100)}% of releases; weekends ${Math.round(((wkv[5] + wkv[6]) / rows.length) * 100)}%.`
      : "No releases match the current filters.";

    const excluded = rows.length - timed.length;
    let best = { s: 0, c: -1 };
    for (let s = 0; s < 24; s++) {
      const c = hv[s] + hv[(s + 1) % 24] + hv[(s + 2) % 24];
      if (c > best.c) best = { s, c };
    }
    hourNote.textContent = timed.length
      ? `Based on ${fmtInt(timed.length)} of ${fmtInt(rows.length)} releases with a known time; ${fmtInt(excluded)} without one are excluded. ${pad2(best.s)}:00–${pad2((best.s + 3) % 24)}:00 ${isLocalTime() ? "local time" : "UTC"} holds ${Math.round((best.c / timed.length) * 100)}% of them.`
      : `No release times are known for the ${fmtInt(rows.length)} releases shown, so the hour view is empty.`;
  };
}

/* ── rhythm: weekday × lab matrix ─────────────────────────────────────────── */

export function buildWeekdayMatrix(container, { tip, onOpen }) {
  const table = h("div", { class: "mx", role: "table", "aria-label": "Releases per weekday, by lab" });
  container.append(h("div", { class: "mx-scroll" }, table));
  const panel = createBucketPanel(container.closest("figure"), onOpen);

  return function update(rows) {
    tip.hide();
    panel.hide();
    clear(table);
    table.append(h("div", { class: "mx-row mx-head", role: "row" },
      h("span", { class: "mx-lab", role: "columnheader" }, "Lab"),
      DOW_SHORT.map((d, i) => h("span", { class: "mx-cell", role: "columnheader", title: DOW_LONG[i] }, d)),
      h("span", { class: "mx-total", role: "columnheader" }, "Total")));

    const byLab = groupBy(rows, (r) => r.lab_id);
    const lines = [...byLab.entries()].map(([id, list]) => {
      const v = Array(7).fill(0);
      const days = Array.from({ length: 7 }, () => []);
      for (const r of list) { const day = releaseDayIndex(r); v[day]++; days[day].push(r); }
      return { id, v, days, list, total: list.length };
    }).sort((a, b) => b.total - a.total);

    const line = (name, color, v, days, list, cls = "") => {
      const total = list.length;
      const max = Math.max(...v, 1);
      const peak = v.indexOf(Math.max(...v));
      const cells = v.map((n, i) => {
        const el = h("span", { class: `mx-cell${n && i === peak ? " is-peak" : ""}${n ? "" : " is-zero"}`, role: "cell", style: { "--v": (n / max).toFixed(3) } }, n || "·");
        armBucket(el, n, `${name}, ${DOW_LONG[i]}`);
        wireBucket(el, () => ({ title: `${name} · ${DOW_LONG[i]}`, note: total ? `${Math.round((n / total) * 100)}% of ${color ? `${name}’s` : "all"} releases` : "", rows: days[i] }), panel, tip);
        return el;
      });
      const totalEl = h("span", { class: "mx-total", role: "cell" }, total);
      armBucket(totalEl, total, `${name}, all days`);
      wireBucket(totalEl, () => ({ title: `${name} · all days`, rows: list }), panel, tip);
      return h("div", { class: `mx-row ${cls}`, role: "row" },
        h("span", { class: "mx-lab", role: "rowheader" }, color ? h("i", { class: "lab-dot", style: { background: color } }) : null, h("span", { class: "mx-name" }, name)),
        cells, totalEl);
    };

    for (const l of lines) {
      const lab = LAB_BY_ID[l.id];
      table.append(line(lab.name.split(" / ")[0], lab.color, l.v, l.days, l.list));
    }
    if (lines.length) {
      const sum = Array(7).fill(0);
      const sumDays = Array.from({ length: 7 }, () => []);
      for (const r of rows) { const day = releaseDayIndex(r); sum[day]++; sumDays[day].push(r); }
      table.append(line("All labs", null, sum, sumDays, rows, "mx-all"));
    } else {
      table.append(h("p", { class: "fine empty-note" }, "No releases match the current filters."));
    }
  };
}

/* ── cadence: every gap, plotted ──────────────────────────────────────────── */

const short = (n) => fmtDays(n).replace(/d$/, "");

export function buildCadence(container) {
  const state = { key: "med", dir: "asc" };
  let latest = [];

  const COLS = [
    { key: "lab", label: "Lab", dir: "asc", cls: "cd-lab" },
    { key: "strip", label: "Every gap, in days", cls: "cd-bar" },
    { key: "n", label: "Gaps", dir: "desc", cls: "cd-n" },
    { key: "med", label: "Median", dir: "asc", cls: "cd-val" },
    { key: "iqr", label: "Middle half", cls: "cd-iqr" },
    { key: "last", label: "Latest", dir: "desc", cls: "cd-last" },
  ];

  const axis = h("span", { class: "cd-axis", "aria-hidden": "true" });
  const heads = new Map();
  const head = h("div", { class: "cd-row cd-head", role: "row" },
    COLS.map((c) => {
      let el;
      if (c.key === "strip") el = h("span", { class: c.cls, role: "columnheader" }, h("span", { class: "cd-cap" }, c.label), axis);
      else if (!c.dir) el = h("span", { class: c.cls, role: "columnheader" }, c.label);
      else {
        el = h("button", { type: "button", class: `th-btn ${c.cls}`, role: "columnheader", onclick: () => sortBy(c) }, c.label, h("span", { class: "th-arrow", "aria-hidden": "true" }));
        heads.set(c.key, el);
      }
      return el;
    }),
    h("span", { class: "cd-tiers cd-tiers-head", role: "presentation" }, TIERS.map((t) => h("span", { role: "columnheader", title: `${t.label}: median gap within the tier` }, t.short))),
  );
  const body = h("div", { class: "cd-body" });
  const table = h("div", { class: "cd-table", role: "table", "aria-label": "Days between launches, per lab and tier" }, head, body);
  container.append(h("div", { class: "cd-scroll" }, table));

  const rowEls = new Map();

  function makeRow(key, name, color, cls = "") {
    const band = h("span", { class: "cd-band" });
    const tick = h("span", { class: "cd-tick" });
    const dots = h("span", { class: "cd-dots" });
    const cells = { n: h("span", { class: "cd-n", role: "cell" }), val: h("span", { class: "cd-val", role: "cell" }), iqr: h("span", { class: "cd-iqr", role: "cell" }), last: h("span", { class: "cd-last", role: "cell" }) };
    const tiers = TIERS.map(() => h("span", { class: "cd-cell", role: "cell" }));
    const el = h("div", { class: `cd-row ${cls}`, role: "row" },
      h("span", { class: "cd-lab", role: "rowheader" }, color ? h("i", { class: "lab-dot", style: { background: color } }) : null, h("span", { class: "mx-name" }, name)),
      h("span", { class: "cd-bar", role: "cell" }, h("span", { class: "cd-line" }), band, tick, dots),
      cells.n, cells.val, cells.iqr, cells.last,
      h("span", { class: "cd-tiers", role: "presentation" }, tiers),
    );
    return { key, el, band, tick, dots, cells, tiers, color };
  }

  const overall = makeRow("all", "All labs", null, "cd-all");
  body.append(overall.el);

  function paintRow(row, details, tierGaps, max, labName) {
    const gaps = details.map((d) => d.gap);
    const q1 = quantile(gaps, 0.25);
    const q3 = quantile(gaps, 0.75);
    const med = median(gaps);
    const ok = gaps.length >= 2;
    row.el.classList.toggle("is-thin", !ok);
    row.band.style.left = ok ? `${(q1 / max) * 100}%` : "0%";
    row.band.style.width = ok ? `${Math.max(0.8, ((q3 - q1) / max) * 100)}%` : "0%";
    row.tick.style.left = med != null ? `${(med / max) * 100}%` : "0%";
    row.tick.style.opacity = med != null ? 1 : 0;

    clear(row.dots).append(...details.map((d) => h("i", {
      class: "cd-dot", style: { left: `${(d.gap / max) * 100}%`, ...(row.color ? { "--c": row.color } : {}) },
      title: `${labName ? `${labName(d)} · ` : ""}${plural(d.gap, "day")} · ${fmtShortDate(d.from)} → ${fmtShortDate(d.to)}`,
    })));

    row.cells.n.textContent = gaps.length;
    row.cells.val.textContent = med != null ? fmtDays(med) : "—";
    row.cells.val.title = ok ? `Median ${fmtDays(med)}, middle half ${fmtDays(q1)}–${fmtDays(q3)}, from ${gaps.length} gaps` : "Too few releases for a cadence";
    row.cells.iqr.textContent = ok ? `${short(q1)}–${short(q3)}d` : "—";
    row.cells.last.textContent = gaps.length ? fmtDays(gaps.at(-1)) : "—";
    TIERS.forEach((t, i) => {
      const g = tierGaps.get(t.id) || [];
      const cell = row.tiers[i];
      cell.textContent = g.length >= 2 ? fmtDays(median(g)) : "·";
      cell.title = g.length >= 2 ? `${t.label}: median ${fmtDays(median(g))} from ${g.length} gaps` : `${t.label}: not enough releases`;
      cell.classList.toggle("is-empty", g.length < 2);
    });
  }

  const sortKeys = {
    lab: (e) => e.name.toLowerCase(),
    n: (e) => e.gaps.length,
    med: (e) => e.med,
    last: (e) => e.gaps.at(-1)?.gap ?? null,
  };

  function paintHeads() {
    for (const [key, el] of heads) {
      const on = key === state.key;
      el.classList.toggle("is-sorted", on);
      el.classList.toggle("is-desc", on && state.dir === "desc");
    }
  }

  function sortBy(col) {
    state.dir = state.key === col.key ? (state.dir === "asc" ? "desc" : "asc") : col.dir;
    state.key = col.key;
    paintHeads();
    order();
  }

  function order() {
    const get = sortKeys[state.key];
    const sign = state.dir === "asc" ? 1 : -1;
    [...latest].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sign || a.name.localeCompare(b.name);
    }).forEach((e, idx) => { rowEls.get(e.id).el.style.order = idx + 1; });
    overall.el.style.order = 0;
  }

  paintHeads();

  return function update(rows) {
    const byLab = groupBy(rows, (r) => r.lab_id);
    const entries = [];
    const pooled = [];
    const pooledTier = new Map();
    for (const [id, list] of byLab) {
      const gaps = launchDayGapDetails(list);
      const tg = new Map();
      for (const [tid, tl] of groupBy(list, (r) => r.tier)) tg.set(tid, launchDayGapDetails(tl).map((x) => x.gap));
      const name = LAB_BY_ID[id].name.split(" / ")[0];
      pooled.push(...gaps.map((g) => ({ ...g, lab: name })));
      for (const [tid, g] of tg) pooledTier.set(tid, [...(pooledTier.get(tid) || []), ...g]);
      entries.push({ id, name, gaps, tg, med: median(gaps.map((x) => x.gap)) });
    }
    latest = entries;

    const top = Math.max(10, ...pooled.map((g) => g.gap));
    const step = [5, 10, 15, 20, 30, 50].find((s) => top / s <= 6) || 50;
    const max = Math.ceil(top / step) * step;
    table.style.setProperty("--tick", `${(step / max) * 100}%`);
    clear(axis).append(...Array.from({ length: Math.floor(max / step) }, (_, i) => h("span", { style: { left: `${(((i + 1) * step) / max) * 100}%` } }, (i + 1) * step)));

    paintRow(overall, pooled, pooledTier, max, (d) => d.lab);

    const seen = new Set();
    for (const e of entries) {
      seen.add(e.id);
      let row = rowEls.get(e.id);
      if (!row) {
        const lab = LAB_BY_ID[e.id];
        row = makeRow(e.id, e.name, lab.color);
        rowEls.set(e.id, row);
      }
      paintRow(row, e.gaps, e.tg, max);
      row.el.hidden = false;
      if (!row.el.isConnected) body.append(row.el);
    }
    for (const [id, row] of rowEls) if (!seen.has(id)) row.el.hidden = true;
    order();
  };
}

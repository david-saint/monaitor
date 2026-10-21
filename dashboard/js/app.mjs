/* ─────────────────────────────────────────────────────────────────────────────
   Monaitor — boot, theme, filters and orchestration
   ───────────────────────────────────────────────────────────────────────────── */

import {
  $, $$, DAY_MS, LABS, MODALITIES, RELEASE_TYPES, TIERS, fmtDate, fmtInt, h, isoDate, localZoneName, plural, setTimeZoneMode, startOfUTCDay, timeZoneMode,
} from "./util.mjs?v=4";
import { loadDataset } from "./data.mjs?v=4";
import { buildForecasts, forecastLede, renderForecast } from "./forecast.mjs?v=4";
import { buildCadence, buildKpis, buildRhythm, buildTimeline, buildWeekdayMatrix, createBucketTip, createTooltip, tierKey } from "./charts.mjs?v=4";
import { buildLedger, buildSheet } from "./ledger.mjs?v=4";
import { reducedMotion } from "./motion.mjs?v=4";

/* ── theme ────────────────────────────────────────────────────────────────── */

function initTheme() {
  const root = document.documentElement;
  const btn = $("#theme-toggle");
  const sync = () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    btn.setAttribute("aria-label", `Switch to ${next} theme`);
    btn.title = `Switch to ${next} theme`;
  };
  const stored = () => { try { return localStorage.getItem("monaitor-theme"); } catch { return null; } };
  const apply = (t) => {
    if (!reducedMotion()) {
      root.classList.add("theme-anim");
      clearTimeout(apply.t);
      apply.t = setTimeout(() => root.classList.remove("theme-anim"), 420);
    }
    root.dataset.theme = t;
    sync();
  };
  btn.addEventListener("click", () => {
    const t = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("monaitor-theme", t); } catch { /* storage unavailable */ }
    apply(t);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!stored()) apply(e.matches ? "dark" : "light");
  });
  sync();
}

/* ── side nav (expanded / icons only) ─────────────────────────────────────── */

function initSideNav() {
  const root = document.documentElement;
  const btn = $("#side-toggle");
  const links = $$(".nav a");
  const apply = (collapsed) => {
    root.dataset.side = collapsed ? "collapsed" : "expanded";
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.setAttribute("aria-label", label);
    btn.title = label;
    // labels are visually hidden when collapsed, so surface them as tooltips on the icons
    for (const a of links) {
      if (collapsed) a.title = a.querySelector("span").textContent;
      else a.removeAttribute("title");
    }
  };
  btn.addEventListener("click", () => {
    const collapsed = root.dataset.side !== "collapsed";
    try { localStorage.setItem("monaitor-side", collapsed ? "collapsed" : "expanded"); } catch { /* storage unavailable */ }
    apply(collapsed);
  });
  apply(root.dataset.side === "collapsed");
}

/* ── time zone (UTC / local) ──────────────────────────────────────────────── */

function initTimeZone(onChange) {
  const root = document.documentElement;
  const buttons = $$("#tz-control [data-tz]");
  const lede = $("#tz-lede");
  const methodTz = $("#method-hour-tz");

  const sync = () => {
    const mode = timeZoneMode();
    const zone = localZoneName();
    root.dataset.tz = mode;
    for (const b of buttons) {
      b.setAttribute("aria-pressed", String(b.dataset.tz === mode));
      if (b.dataset.tz === "local") b.title = `Show times in your local timezone (${zone})`;
    }
    if (lede) {
      lede.textContent = mode === "local"
        ? `Times are in your local timezone (${zone}).`
        : "Times are in UTC.";
    }
    if (methodTz) methodTz.textContent = mode === "local" ? "local time" : "UTC";
  };

  for (const b of buttons) {
    b.addEventListener("click", () => {
      if (b.dataset.tz === timeZoneMode()) return;
      setTimeZoneMode(b.dataset.tz);
      try { localStorage.setItem("monaitor-tz", b.dataset.tz); } catch { /* storage unavailable */ }
      sync();
      onChange();
    });
  }
  sync();
}

/* ── filters ──────────────────────────────────────────────────────────────── */

const emptyFilters = () => ({ labs: new Set(), tiers: new Set(), mods: new Set(), types: new Set(), weights: "all", from: "", to: "" });

function buildFilters(data, now, onChange) {
  const f = emptyFilters();
  const body = $("#filter-body");
  const toggleBtn = $("#filter-toggle");
  const bar = $("#filterbar");
  const reset = $("#filter-reset");
  const badge = $("#filter-badge");
  const chips = new Map();

  toggleBtn.addEventListener("click", () => {
    const open = toggleBtn.getAttribute("aria-expanded") !== "true";
    toggleBtn.setAttribute("aria-expanded", String(open));
    bar.classList.toggle("is-open", open);
  });

  const group = (title, items, set, { dot = false } = {}) => {
    const wrap = h("div", { class: "chips" });
    for (const it of items) {
      const b = h("button", {
        class: "chip", type: "button", "aria-pressed": "false",
        onclick: () => { set.has(it.id) ? set.delete(it.id) : set.add(it.id); sync(); onChange(); },
      }, dot ? h("i", { class: "lab-dot", style: { background: it.color } }) : null, it.label || it.name.split(" / ")[0]);
      chips.set(`${title}:${it.id}`, { b, set, id: it.id });
      wrap.append(b);
    }
    return h("fieldset", { class: "fgroup" }, h("legend", {}, title), wrap);
  };

  const weights = h("div", { class: "chips" }, [["all", "Any"], ["open", "Open weights"], ["closed", "Closed"]].map(([v, label]) => {
    const b = h("button", { class: "chip", type: "button", "aria-pressed": String(v === "all"), onclick: () => { f.weights = v; sync(); onChange(); } }, label);
    chips.set(`w:${v}`, { b, weight: v });
    return b;
  }));

  const minDate = isoDate(Math.min(...data.releases.map((r) => r.ts)));
  const maxDate = isoDate(Math.max(now, ...data.releases.map((r) => r.ts)));
  const fromIn = h("input", { type: "date", id: "f-from", min: minDate, max: maxDate, "aria-label": "From date" });
  const toIn = h("input", { type: "date", id: "f-to", min: minDate, max: maxDate, "aria-label": "To date" });
  const onDate = () => { f.from = fromIn.value; f.to = toIn.value; sync(); onChange(); };
  fromIn.addEventListener("change", onDate);
  toIn.addEventListener("change", onDate);
  const preset = (label, days) => h("button", {
    class: "chip chip-ghost", type: "button",
    onclick: () => {
      f.from = days ? isoDate(startOfUTCDay(now) - (days - 1) * DAY_MS) : "";
      f.to = "";
      sync(); onChange();
    },
  }, label);

  body.append(
    group("Lab", LABS.filter((l) => data.labCounts.get(l.id)), f.labs, { dot: true }),
    group("Tier", TIERS, f.tiers),
    group("Modality", MODALITIES.filter((m) => data.modalities.includes(m.id)), f.mods),
    group("Release type", RELEASE_TYPES, f.types),
    h("div", { class: "fgroup-row" },
      h("fieldset", { class: "fgroup" }, h("legend", {}, "Weights"), weights),
      h("fieldset", { class: "fgroup" }, h("legend", {}, "Release dates"),
        h("div", { class: "dates" }, fromIn, h("span", { class: "dim", "aria-hidden": "true" }, "→"), toIn,
          preset("30 days", 30), preset("90 days", 90), preset("All", 0))),
    ),
  );

  function sync() {
    for (const c of chips.values()) {
      const on = c.set ? c.set.has(c.id) : f.weights === c.weight;
      c.b.setAttribute("aria-pressed", String(on));
    }
    fromIn.value = f.from;
    toIn.value = f.to;
    const n = f.labs.size + f.tiers.size + f.mods.size + f.types.size + (f.weights !== "all" ? 1 : 0) + (f.from || f.to ? 1 : 0);
    badge.hidden = n === 0;
    badge.textContent = n;
    reset.hidden = n === 0;
  }

  reset.addEventListener("click", () => {
    f.labs.clear(); f.tiers.clear(); f.mods.clear(); f.types.clear();
    f.weights = "all"; f.from = ""; f.to = "";
    sync(); onChange();
  });

  const test = (r) =>
    (!f.labs.size || f.labs.has(r.lab_id))
    && (!f.tiers.size || f.tiers.has(r.tier))
    && (!f.mods.size || f.mods.has(r.modality_primary))
    && (!f.types.size || f.types.has(r.release_type))
    && (f.weights === "all" || (f.weights === "open") === r.open_weights)
    && (!f.from || r.release_date >= f.from)
    && (!f.to || r.release_date <= f.to);

  return {
    test,
    isActive: () => !badge.hidden,
    focusLab(id) {
      f.labs.clear(); f.labs.add(id);
      sync(); onChange();
    },
  };
}

/* ── notices & misc ───────────────────────────────────────────────────────── */

function showNotice(data) {
  const el = $("#notice");
  const msgs = [];
  if (data.sampleMode) msgs.push("Showing fake sample data — no lab files could be loaded. Nothing here is real.");
  else if (data.missingLabs.length) msgs.push(`Partial data: ${data.missingLabs.map((l) => l.name).join(", ")} could not be loaded.`);
  if (data.loadedFeedsWithNoRows.length) msgs.push(`No usable records for ${data.loadedFeedsWithNoRows.join(", ")}.`);
  if (!msgs.length) return;
  el.textContent = msgs.join(" ");
  el.hidden = false;
}

/* ── views ────────────────────────────────────────────────────────────────── */

const VIEWS = { forecast: "Forecast", timeline: "Timeline", rhythm: "Rhythm", cadence: "Cadence", releases: "Releases" };
const FILTERED = new Set(["timeline", "rhythm", "cadence", "releases"]); // the forecast always uses full history

function initRouter() {
  const links = $$(".nav a");
  const bar = $("#filterbar");
  let current = null;

  const fromHash = () => {
    const m = location.hash.match(/^#\/(\w+)/);
    return m && VIEWS[m[1]] ? m[1] : "forecast";
  };

  function show(id, { focus = true } = {}) {
    if (id === current) return;
    const first = current === null;
    current = id;
    for (const v of $$(".view")) v.hidden = v.dataset.view !== id;
    for (const a of links) {
      if (a.dataset.view === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    bar.hidden = !FILTERED.has(id);
    if (!FILTERED.has(id)) { bar.classList.remove("is-open"); $("#filter-toggle").setAttribute("aria-expanded", "false"); }
    document.title = `${VIEWS[id]} — Monaitor`;
    window.scrollTo(0, 0);
    if (focus && !first) $(`#view-${id} h1`)?.focus({ preventScroll: true });
  }

  window.addEventListener("hashchange", () => show(fromHash()));
  show(fromHash(), { focus: false });

  return {
    go(id) {
      if (location.hash !== `#/${id}`) history.pushState(null, "", `#/${id}`);
      show(id);
    },
  };
}

/** On small screens the nav is a sticky top bar; the filter bar must sit beneath it. */
function initTopOffset() {
  const side = $(".side");
  const mq = matchMedia("(max-width: 860px)");
  const set = () => document.documentElement.style.setProperty("--top-h", mq.matches ? `${side.offsetHeight}px` : "0px");
  if ("ResizeObserver" in window) new ResizeObserver(set).observe(side);
  mq.addEventListener("change", set);
  set();
}

function nowFromUrl() {
  const q = new URLSearchParams(location.search).get("now");
  const t = q ? Date.parse(`${q}T12:00:00Z`) : NaN;
  return Number.isFinite(t) ? t : Date.now();
}

/* ── boot ─────────────────────────────────────────────────────────────────── */

async function boot() {
  initTheme();
  const router = initRouter();
  initSideNav();
  initTopOffset();
  let refreshForTimeZone = () => {};
  initTimeZone(() => refreshForTimeZone());
  const now = nowFromUrl();
  $("#asof").textContent = fmtDate(now);
  $("#asof").setAttribute("datetime", isoDate(now));

  let data;
  try {
    data = await loadDataset();
  } catch (err) {
    $("#headline").textContent = "The data didn’t load.";
    $("#lede").textContent = `${err.message} Serve the project root (python3 -m http.server) and open /dashboard/.`;
    return;
  }

  showNotice(data);
  const byUid = new Map(data.releases.map((r) => [r.uid, r]));
  const sheet = buildSheet(byUid);
  const tooltip = createTooltip();
  const open = (uid) => { tooltip.hide(); sheet.open(uid); };

  const forecasts = buildForecasts(data, now);
  const forecastView = renderForecast($("#forecast-list"), $("#headline"), forecasts, {
    onOpen: open,
    onFocusLab(id) {
      filters.focusLab(id);
      router.go("releases");
    },
  });
  $("#lede").textContent = forecastLede(forecasts);
  const due = forecasts.filter((f) => f.status.rank <= 1).length;
  const navForecast = $("#nav-forecast");
  navForecast.textContent = due ? `${due} due` : "";
  navForecast.classList.toggle("is-hot", due > 0);

  tierKey($("#tier-key"));
  const updateKpis = buildKpis($("#kpis"), now);
  const updateTimeline = buildTimeline($("#timeline-chart"), data.releases, { now, tooltip, onOpen: open });
  const bucketTip = createBucketTip();
  const updateRhythm = buildRhythm($("#weekday-chart"), $("#hour-chart"), $("#weekday-note"), $("#hour-note"), { tip: bucketTip, onOpen: open });
  const updateMatrix = buildWeekdayMatrix($("#weekday-matrix"), { tip: bucketTip, onOpen: open });
  const updateCadence = buildCadence($("#cadence-chart"));
  const ledger = buildLedger($("#ledger"), byUid, { onOpen: open, onSearchKey: () => router.go("releases") });

  let queued = false;
  const apply = ({ keepPaging = false } = {}) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const rows = data.releases.filter(filters.test);
      updateKpis(rows, data.releases);
      updateTimeline(rows);
      updateRhythm(rows);
      updateMatrix(rows);
      updateCadence(rows);
      ledger.update(rows, { keepPaging });
      $("#nav-releases").textContent = fmtInt(rows.length);
      $("#filter-count").textContent = filters.isActive()
        ? `${fmtInt(rows.length)} of ${fmtInt(data.releases.length)} releases`
        : `All ${fmtInt(data.releases.length)} releases`;
    });
  };
  const filters = buildFilters(data, now, apply);
  apply();
  refreshForTimeZone = () => {
    forecastView.refreshTimes();
    apply({ keepPaging: true });
  };

  const latest = Math.max(...data.releases.map((r) => r.ts));
  $("#foot-meta").textContent = `${plural(data.releases.length, "release")} from ${data.loadedLabs.length} labs · latest ${fmtDate(latest)}${data.sampleMode ? " · SAMPLE DATA" : ""}`;

  document.documentElement.classList.add("ready");
}

boot().catch((err) => {
  console.error(err);
  const hl = $("#headline");
  if (hl) hl.textContent = "Something went wrong.";
  const lede = $("#lede");
  if (lede) lede.textContent = String(err?.message || err);
});

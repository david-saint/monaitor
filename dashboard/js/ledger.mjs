/* ─────────────────────────────────────────────────────────────────────────────
   Monaitor — releases table + detail sheet
   ───────────────────────────────────────────────────────────────────────────── */

import {
  CHANNEL_LABELS, CONFIDENCE_ORDER, TIERS, clear, confidenceDots, csvCell, domainOf, fmtClock, fmtContext, fmtInt, fmtParams, fmtPrice, fmtReleaseDate, fmtReleaseShortDate, fmtReleaseWeekdayLong, fmtTime, h, flattenSignals, modalityLabel, plural, safeUrl, tierOf, typeOf, tzAbbr,
} from "./util.mjs?v=4";
import { reducedMotion } from "./motion.mjs?v=5";

const PAGE = 30;
const CONF_TEXT = { high: "High · primary source", medium: "Medium · reputable press", low: "Low · single or unclear source" };

const COLUMNS = [
  { key: "date", label: "Date", cls: "c-date", get: (r) => r.ts, dir: "desc" },
  { key: "model", label: "Model", cls: "c-model", get: (r) => r.model_name.toLowerCase(), dir: "asc" },
  { key: "lab", label: "Lab", cls: "c-lab hide-sm", get: (r) => r.lab.name.toLowerCase(), dir: "asc" },
  { key: "tier", label: "Tier", cls: "c-tier hide-md", get: (r) => TIERS.findIndex((t) => t.id === r.tier), dir: "asc" },
  { key: "type", label: "Type", cls: "c-type hide-md", get: (r) => r.release_type, dir: "asc" },
  { key: "modality", label: "Modality", cls: "c-mod hide-lg", get: (r) => r.modality_primary, dir: "asc" },
  { key: "gap", label: "Gap", cls: "c-gap hide-xl", get: (r) => r.gapLab ?? -1, dir: "desc", title: "Days since the lab’s previous release" },
  { key: "ctx", label: "Context", cls: "c-ctx hide-xl", get: (r) => r.context_window_k ?? -1, dir: "desc" },
  { key: "price", label: "$ in / out", cls: "c-price hide-xl", get: (r) => r.price_input_per_m ?? -1, dir: "desc", title: "USD per 1M input / output tokens" },
  { key: "conf", label: "Source", cls: "c-conf", get: (r) => CONFIDENCE_ORDER[r.confidence] ?? 3, dir: "asc" },
];

export function buildLedger(root, allById, { onOpen, onSearchKey }) {
  const state = { rows: [], q: "", sort: { key: "date", dir: "desc" }, shown: PAGE };

  const search = h("input", {
    type: "search", class: "search", placeholder: "Search model, lab, codename, signal…", "aria-label": "Search releases", autocomplete: "off",
  });
  const count = h("p", { class: "ledger-count", "aria-live": "polite" });
  const exportBtn = h("button", { class: "link-btn", type: "button" }, "Export CSV");
  const thead = h("tr", {}, COLUMNS.map((c) => {
    const btn = h("button", { type: "button", class: "th-btn", title: c.title, onclick: () => sortBy(c) }, c.label, h("span", { class: "th-arrow", "aria-hidden": "true" }));
    return h("th", { scope: "col", class: c.cls, "data-key": c.key, "aria-sort": "none" }, btn);
  }));
  const tbody = h("tbody");
  const more = h("button", { class: "btn-quiet", type: "button", onclick: () => { state.shown += PAGE * 2; render(false); } });
  const empty = h("div", { class: "empty", hidden: true }, h("p", {}, "No releases match."), h("p", { class: "fine" }, "Loosen a filter or clear the search."));

  root.append(
    h("div", { class: "ledger-tools" }, search, count, exportBtn),
    h("div", { class: "table-wrap" }, h("table", { class: "ledger" }, h("thead", {}, thead), tbody)),
    empty,
    h("div", { class: "ledger-more" }, more),
  );

  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = search.value.trim().toLowerCase(); state.shown = PAGE; render(true); }, 140);
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { search.value = ""; state.q = ""; render(true); e.stopPropagation(); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      onSearchKey?.();
      search.focus();
      search.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  });

  function sortBy(col) {
    state.sort = state.sort.key === col.key
      ? { key: col.key, dir: state.sort.dir === "asc" ? "desc" : "asc" }
      : { key: col.key, dir: col.dir };
    state.shown = PAGE;
    render(true);
  }

  function visibleRows() {
    const terms = state.q.split(/\s+/).filter(Boolean);
    let rows = terms.length ? state.rows.filter((r) => terms.every((t) => r.searchHaystack.includes(t))) : state.rows.slice();
    const col = COLUMNS.find((c) => c.key === state.sort.key);
    const sign = state.sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sign || b.ts - a.ts;
    });
    return rows;
  }

  function rowEl(r, i, animate) {
    const tr = h("tr", { class: animate && i < 14 ? "row-in" : "", style: { "--i": i }, onclick: (e) => { if (!e.target.closest("button")) onOpen(r.uid); } },
      h("td", { class: "c-date" }, h("span", { class: "num" }, fmtReleaseShortDate(r)),
        h("span", { class: "sub num" }, r.hasTime
          ? [r.time_confidence === "approximate" ? "~" : "", fmtClock(r.ts), h("span", { class: "tz-suffix" }, ` ${tzAbbr(r.ts)}`)]
          : "no time")),
      h("td", { class: "c-model" },
        h("button", { type: "button", class: "row-open", onclick: () => onOpen(r.uid) },
          h("span", { class: "model-name" }, r.model_name)),
        h("span", { class: "sub" }, h("i", { class: "lab-dot", style: { background: r.lab.color } }), `${r.lab.name.split(" / ")[0]} · ${tierOf(r.tier).label}`)),
      h("td", { class: "c-lab hide-sm" }, h("span", { class: "lab-cell" }, h("i", { class: "lab-dot", style: { background: r.lab.color } }), r.lab.name.split(" / ")[0])),
      h("td", { class: "c-tier hide-md" }, tierOf(r.tier).label),
      h("td", { class: "c-type hide-md" }, typeOf(r.release_type).label),
      h("td", { class: "c-mod hide-lg" }, modalityLabel(r.modality_primary)),
      h("td", { class: "c-gap hide-xl num" }, r.gapLab != null ? `${r.gapLab}d` : "·"),
      h("td", { class: "c-ctx hide-xl num" }, r.context_window_k != null ? fmtContext(r.context_window_k).replace(" tokens", "") : "·"),
      h("td", { class: "c-price hide-xl num" }, r.price_input_per_m != null || r.price_output_per_m != null ? `${fmtPrice(r.price_input_per_m)} / ${fmtPrice(r.price_output_per_m)}` : "·"),
      h("td", { class: "c-conf" }, confidenceDots(r.confidence)),
    );
    return tr;
  }

  function render(animate) {
    const rows = visibleRows();
    const slice = rows.slice(0, state.shown);
    clear(tbody).append(...slice.map((r, i) => rowEl(r, i, animate)));
    empty.hidden = rows.length > 0;
    count.textContent = state.q || rows.length !== state.rows.length
      ? `${fmtInt(rows.length)} shown${state.q ? ` for “${state.q}”` : ""}`
      : `${fmtInt(rows.length)} releases`;
    more.hidden = rows.length <= slice.length;
    more.textContent = `Show ${Math.min(PAGE * 2, rows.length - slice.length)} more · ${fmtInt(rows.length - slice.length)} remaining`;
    for (const th of thead.children) {
      const active = th.dataset.key === state.sort.key;
      th.setAttribute("aria-sort", active ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none");
      th.classList.toggle("is-sorted", active);
      th.classList.toggle("is-desc", active && state.sort.dir === "desc");
    }
    exportBtn.onclick = () => exportCsv(rows);
  }

  return {
    update(rows, { keepPaging = false } = {}) {
      state.rows = rows;
      if (!keepPaging) state.shown = PAGE;
      render(true);
    },
  };
}

function exportCsv(rows) {
  const cols = ["release_date", "release_time_utc", "time_confidence", "lab_id", "model_name", "tier", "release_type", "modality_primary", "open_weights", "confidence", "sources"];
  const text = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(c === "sources" ? r.sources.join(" ") : r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: "monaitor-releases.csv" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── detail sheet ─────────────────────────────────────────────────────────── */

export function buildSheet(allById) {
  const dlg = h("dialog", { class: "sheet", "aria-labelledby": "sheet-title" });
  document.body.append(dlg);
  let closing = false;

  function finish() {
    if (dlg.open) dlg.close();
    closing = false;
  }
  function close() {
    if (!dlg.open || closing) return;
    closing = true;
    dlg.classList.remove("is-open");
    if (reducedMotion()) finish();
    else setTimeout(finish, 260);
  }
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });

  const fact = (k, v) => (v == null || v === "" || v === "—" ? null : [h("dt", {}, k), h("dd", {}, v)]);

  function open(uid) {
    const r = allById.get(uid);
    if (!r) return;
    const pred = r.predecessor_id ? [...allById.values()].find((x) => x.id === r.predecessor_id) : null;
    const signals = flattenSignals(r);
    const bench = Object.entries(r.notable_benchmarks || {});
    const price = r.price_input_per_m != null || r.price_output_per_m != null
      ? `${fmtPrice(r.price_input_per_m)} in · ${fmtPrice(r.price_output_per_m)} out / 1M tokens` : null;
    const timeNote = !r.hasTime ? "time not known" : `${r.time_confidence === "approximate" ? "~" : ""}${fmtTime(r.ts)}${r.time_confidence === "approximate" ? " (approximate)" : ""}`;

    clear(dlg).append(h("div", { class: "sheet-inner" },
      h("div", { class: "sheet-top" },
        h("span", { class: "sheet-lab" }, h("i", { class: "lab-dot", style: { background: r.lab.color } }), r.lab.name),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close details", onclick: close }, h("span", { class: "x", "aria-hidden": "true" }))),
      h("h2", { id: "sheet-title", class: "sheet-title" }, r.model_name),
      h("p", { class: "sheet-when" }, `${fmtReleaseWeekdayLong(r)}, ${fmtReleaseDate(r)}`, h("span", { class: "dim" }, ` · ${timeNote}`)),
      r.summary ? h("p", { class: "sheet-summary" }, r.summary) : null,
      h("div", { class: "tags" },
        h("span", { class: "tag" }, tierOf(r.tier).label),
        h("span", { class: "tag" }, typeOf(r.release_type).label),
        h("span", { class: "tag" }, modalityLabel(r.modality_primary)),
        r.open_weights ? h("span", { class: "tag tag-accent" }, `Open weights${r.license ? ` · ${r.license}` : ""}`) : null),
      h("dl", { class: "facts" },
        fact("Family", [r.family, r.version].filter((v) => v && v !== "—").join(" ")),
        fact("API id", r.api_model_id ? h("code", {}, r.api_model_id) : null),
        fact("Context", fmtContext(r.context_window_k)),
        fact("Pricing", price),
        fact("Parameters", fmtParams(r.params_total_b, r.params_active_b)),
        fact("Availability", r.availability.length ? r.availability.join(" · ") : null),
        fact("Announced", [CHANNEL_LABELS[r.announcement_channel] || r.announcement_channel, r.event].filter(Boolean).join(" · ")),
        fact("Since lab’s previous", r.gapLab != null ? `${plural(r.gapLab, "day")}` : null),
        fact("Since same tier", r.gapTier != null ? `${plural(r.gapTier, "day")}` : null),
        pred ? [h("dt", {}, "Replaces"), h("dd", {}, h("button", { class: "link-btn", type: "button", onclick: () => open(pred.uid) }, pred.model_name))] : null,
      ),
      r.capabilities.length ? h("section", {}, h("h3", {}, "Capabilities"), h("div", { class: "tags" }, r.capabilities.map((c) => h("span", { class: "tag tag-soft" }, c)))) : null,
      bench.length ? h("section", {}, h("h3", {}, "Benchmarks"), h("dl", { class: "facts bench" }, bench.map(([k, v]) => [h("dt", {}, k), h("dd", { class: "num" }, String(v))]))) : null,
      signals.length ? h("section", {}, h("h3", {}, "Pre-release signals"), h("ul", { class: "plain" }, signals.map((s) => h("li", {}, s)))) : null,
      h("section", {},
        h("h3", {}, "Sources"),
        r.sources.length
          ? h("ul", { class: "plain links" }, r.sources.map((u) => h("li", {}, h("a", { href: safeUrl(u), target: "_blank", rel: "noopener noreferrer" }, domainOf(u) || u, h("span", { "aria-hidden": "true" }, " ↗")))))
          : h("p", { class: "fine" }, "No source recorded."),
        h("p", { class: "conf-line" }, confidenceDots(r.confidence), h("span", {}, CONF_TEXT[r.confidence])),
      ),
    ));
    dlg.scrollTop = 0;
    if (!dlg.open) dlg.showModal();
    closing = false;
    requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add("is-open")));
  }

  return { open, close };
}

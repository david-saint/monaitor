# Monaitor — dashboard

A quiet dashboard for 2026 AI model releases across ten labs, built around one question — **who ships next, and when?** — with the underlying data one click away so you can reach your own conclusions. Static files, no build step, no chart library.

## Run

Serve the **project root** (the page fetches `../data/<lab>.json`):

```bash
python3 -m http.server 8000
```

Open <http://127.0.0.1:8000/dashboard/>. Opening `index.html` from the filesystem will not work (ES modules + `fetch`).

Optional: `?now=2026-10-21` pins "today" for demos and testing.

## Design

- **Layout:** a fixed side nav with one view at a time — Forecast, Timeline, Rhythm, Cadence, Releases — instead of one long page. Views are hash-routed (`#/cadence`), so they can be linked and the back button works. The nav can collapse to icons only (button at the bottom; the choice persists in `localStorage` as `monaitor-side`), leaving the accent dot for "due" labs and a tooltip on each icon. Below 860 px the nav folds into a sticky top bar instead.
- **Direction:** calm and quiet — warm paper (light) / warm near-black (dark), generous whitespace, almost no borders. One vermilion accent, reserved for *time pressure* (overdue, in window, peak bars, "today"). Per-lab colours are muted and only appear as small dots/markers.
- **Type:** Geist for text and figures, Geist Mono for dates and small readouts, loaded from Google Fonts with system fallbacks. To try a different face, change `--sans` / `--mono` in `styles.css` and the font `<link>` in `index.html`.
- **Show the data, not only the verdict:** every forecast sits next to the numbers it came from (days since last release, usual gap, projected window, gap count, evidence strength). Opening a lab draws each past gap as a bar with the forecast window behind it. Cadence plots *every* gap as a dot. Rhythm breaks weekday down by lab. The table can be sorted by gap, context and price. Hover titles carry exact dates.
- **Signature element — the "waiting line":** each lab gets a horizontal ruler. The shaded band is its typical gap between launches, the tick is the median, and the dot is *today*. A line grows from the last release to today and turns accent-coloured once it runs past the band.
- **Themes:** follows `prefers-color-scheme`; the toggle in the nav persists to `localStorage` (`monaitor-theme`). All charts are DOM elements coloured by CSS variables, so they re-theme instantly without re-rendering.
- **Times:** the sidebar **Time zone** toggle switches every clock time — tooltips, the ledger, the detail sheet, the Rhythm hour chart and the forecast hour window — between UTC and the browser's local zone. The choice persists in `localStorage` (`monaitor-tz`). Dates shown next to a clock time follow the local instant; date-only views (forecast windows, gap dates, filters) use the official release date.
- **Motion:** views fade in, forecast rows stagger and rulers draw themselves on entry, count-up KPIs, filter changes fade/scale markers and tween bars, an eased tooltip, an animated detail sheet. Everything is disabled under `prefers-reduced-motion`.
- **Accessibility:** semantic landmarks, skip link, `aria-current` on the active view with focus moved to the view heading on change, visible focus rings, chip toggles use `aria-pressed`, sortable headers expose sort state, the detail sheet is a native `<dialog>`. Timeline lanes are keyboard-navigable (Tab to a lane, ←/→ to step through markers, Enter to open).
- **Responsive:** down to 320 px. Forecast rows stack, wide tables (cadence, timeline) scroll horizontally with the lab column pinned, table columns drop progressively, and the detail sheet becomes a bottom sheet.

## The views

| View | Notes |
| --- | --- |
| **Forecast** | Headline ("Seven of 10 labs are due."), then a sortable table, one row per lab: waiting line, days since last release, usual gap (Q1–Q3, median, gap count), projected window, status, evidence. Open a row for the **gap history** chart (every past gap, the window and median drawn over it, plus the raw numbers), cadence, likely weekday/hour, per-tier due state, pre-release signals and latest releases. A collapsible note explains the method. Ignores filters. |
| **Timeline** | Key figures (releases, last 30 days vs. prior 30, most active lab, open-weights share) above one lane per lab. Colour = lab; marker form = tier (large dot flagship, medium dot mid, small dot fast, ring small open-weights, diamond specialized). |
| **Rhythm** | Day-of-week and hour-of-day bars with auto-written captions, plus a lab × weekday matrix of counts shaded relative to each lab's busiest day. Clock times follow the sidebar **Time zone** setting (UTC or local). Hover (or focus) any bar or number to preview the releases it counts; click or press Enter to pin the full list below the chart, and open any release from it. Pinned lists close when filters change. |
| **Cadence** | One row per lab: a strip with a dot for every gap between launch days, the middle-half band and median tick; then gap count, median, Q1–Q3, latest gap and per-tier medians. Sortable. An "All labs" row pools everything. |
| **Releases** | Search (`/` from anywhere), sortable columns (including gap since the lab's previous release, context window and price on wide screens), paging, CSV export of the current selection, and a detail sheet with summary, facts, capabilities, benchmarks, signals, source links and confidence. |

**Filters** (sticky bar above Timeline, Rhythm, Cadence and Releases): lab, tier, modality, release type, open weights, and a release-date range (+30 / 90 day presets). The count and the "Releases" badge in the nav follow the filters. "See all N releases" in a forecast detail jumps to Releases filtered to that lab.

### Missing times

116 of 198 records currently have `time_confidence: "unknown"` (this changes as data is enriched). They are **excluded from every hour-based view** — the hour chart, the hour window in forecasts — and each view states how many records it used. In the local time zone, Rhythm groups timed records by their local weekday; records without a time stay on their official release date. Forecast weekdays are always derived from release dates. `approximate` times are included and marked with `~`.

## Forecast method

Computed per lab from its **full history** (not the filters), as of "today" (UTC):

1. Collapse releases to **distinct launch days** — a same-day Pro + Flash launch is one event, not a 0-day gap.
2. Gaps = days between consecutive launch days. Window = **Q1–Q3** of the gaps, centre = median, all counted from the lab's last release. With fewer than 4 gaps the window is widened to ±30 % of the median; with fewer than 2, the pooled all-lab gap distribution is used.
3. Status: **Overdue** (today past the window, by N days), **In window**, or **Window opens in N days**. Past 2.5× the median, a lab is shown as **Unusually quiet** instead — it may have changed cadence rather than be "late".
4. Likely weekday = modal weekday of launch days. Likely hour = the 3-hour window holding the most *timed* releases (UTC or local, per the sidebar setting; only shown with ≥ 3 known times and ≥ 2 in the window). "Earliest likely slot" = the first such weekday on or after max(today, window start).
5. Per-tier rows apply the same method to each tier (needs ≥ 3 releases in that tier).
6. Evidence strength: ≥ 8 gaps *solid*, 4–7 *fair*, otherwise *thin*.

These are descriptive projections from past rhythm, not predictions of fact. Frequent shippers get narrow windows, so many labs can read as "due" at once.

## Data loading

- Requests `data/<lab_id>.json` for all ten labs in parallel (one retry each). Missing or empty feeds are skipped and a notice names them.
- If **no** lab file yields a usable record, falls back to `data/_sample.json` (fake) and shows a clear "sample data" notice and footer tag.
- Records are read defensively against [`../CONTRACT.md`](../CONTRACT.md): unknown enums, null prices, missing times and sources don't break rendering. Gap fields are recomputed from dates, so file order doesn't matter.
- The dashboard never writes to `data/`.

## Daily rescan

`.github/workflows/rescan.yml` runs `scripts/rescan.mjs` every day at 06:17 UTC (and on demand from the Actions tab). It polls two free, keyless sources — OpenRouter's public model list and each lab's Hugging Face org — for models first seen in the last 7 days that aren't already in `data/`, appends them as contract records, and commits. GitHub Pages then redeploys, and the dashboard picks them up (feeds are fetched with `no-store`).

Auto-added records are marked `auto_detected: true`, use `confidence: "medium"` (OpenRouter) or `"low"` (Hugging Face only), and carry approximate times: OpenRouter's listing time, which is usually within hours of launch. Tier and release type are guessed from the name. Run a backfill or a local check with:

```bash
node scripts/rescan.mjs --dry-run              # what would be added
node scripts/rescan.mjs --lookback=30          # wider window
```

Releases that never reach OpenRouter or Hugging Face (consumer-app-only features, some image/video models) still need adding by hand.

## Files

```
dashboard/
├── index.html         page shell: side nav, view skeletons, pre-paint theme script
├── styles.css         design tokens (light/dark), layout, motion, responsive rules
└── js/
    ├── app.mjs        boot, theme toggle, hash router, filters, orchestration
    ├── data.mjs       feed loading, normalisation, gap computation
    ├── forecast.mjs   forecast engine + forecast table (rulers, gap history, expandable details)
    ├── charts.mjs     tooltip, KPIs, timeline, rhythm (+ weekday matrix), cadence strip plot
    ├── ledger.mjs     releases table + detail sheet
    ├── motion.mjs     count-up and reduced-motion helper
    └── util.mjs       constants, dates, statistics, formatting, DOM helper
```

The only external request is the Google Fonts stylesheet; offline it falls back to system fonts.

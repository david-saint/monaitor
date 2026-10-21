/* ─────────────────────────────────────────────────────────────────────────────
   Monaitor — constants, formatting, statistics and DOM helpers
   ───────────────────────────────────────────────────────────────────────────── */

export const DAY_MS = 86_400_000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DOW_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Lab colours live in CSS (`--lab-<id>`) so each theme can tune them. */
const lab = (id, name, short) => ({ id, name, short, color: `var(--lab-${id})` });
export const LABS = [
  lab("openai", "OpenAI", "OAI"),
  lab("anthropic", "Anthropic", "ANT"),
  lab("google", "Google DeepMind", "GDM"),
  lab("xai", "xAI", "xAI"),
  lab("meta", "Meta", "Meta"),
  lab("deepseek", "DeepSeek", "DSK"),
  lab("alibaba", "Alibaba / Qwen", "Qwen"),
  lab("mistral", "Mistral AI", "MIS"),
  lab("moonshot", "Moonshot AI", "Kimi"),
  lab("zhipu", "Zhipu / Z.ai", "GLM"),
];
export const LAB_BY_ID = Object.fromEntries(LABS.map((l) => [l.id, l]));
export const LAB_IDS = LABS.map((l) => l.id);

/** Tier is encoded in the timeline by marker form: size / fill / ring / diamond. */
export const TIERS = [
  { id: "flagship", label: "Flagship", short: "Flagship", desc: "Pro · Opus · Max · Ultra" },
  { id: "mid", label: "Mid", short: "Mid", desc: "Sonnet · Medium · standard" },
  { id: "fast", label: "Fast", short: "Fast", desc: "Flash · Haiku · Mini · Lite" },
  { id: "open-weights-small", label: "Small open", short: "Open", desc: "Small open-weights models" },
  { id: "specialized", label: "Specialized", short: "Special", desc: "Image · video · audio · vertical" },
];
export const TIER_BY_ID = Object.fromEntries(TIERS.map((t) => [t.id, t]));
export const tierOf = (id) => TIER_BY_ID[id] || { id, label: id || "Unknown", short: "?", desc: "" };

export const MODALITIES = [
  { id: "text", label: "Text" },
  { id: "multimodal", label: "Multimodal" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "speech", label: "Speech" },
  { id: "embedding", label: "Embedding" },
  { id: "code", label: "Code" },
  { id: "world-model", label: "World model" },
];
export const MODALITY_BY_ID = Object.fromEntries(MODALITIES.map((m) => [m.id, m]));

export const RELEASE_TYPES = [
  { id: "new-model", label: "New model" },
  { id: "major-version", label: "Major version" },
  { id: "point-update", label: "Point update" },
  { id: "preview", label: "Preview" },
  { id: "experimental", label: "Experimental" },
  { id: "ga", label: "General availability" },
  { id: "open-weights", label: "Open weights" },
  { id: "deprecation-replacement", label: "Replacement" },
];
export const TYPE_BY_ID = Object.fromEntries(RELEASE_TYPES.map((t) => [t.id, t]));
export const typeOf = (id) => TYPE_BY_ID[id] || { id, label: id || "Unknown" };

export const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 };

export const CHANNEL_LABELS = {
  "blog": "Blog post",
  "x-twitter": "X / Twitter",
  "livestream": "Livestream",
  "event-keynote": "Keynote",
  "docs-changelog": "Docs / changelog",
  "huggingface": "Hugging Face",
  "github": "GitHub",
  "press": "Press",
};

/* ── time zone ────────────────────────────────────────────────────────────── */

let timeZone = document.documentElement.dataset.tz === "local" ? "local" : "utc";

export const timeZoneMode = () => timeZone;
export const isLocalTime = () => timeZone === "local";

export function setTimeZoneMode(mode) {
  timeZone = mode === "local" ? "local" : "utc";
  document.documentElement.dataset.tz = timeZone;
}

export function localZoneName() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"; }
  catch { return "local time"; }
}

const tzAbbrFormatter = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" });

/** Short zone label for a specific instant, so DST is respected: UTC / BST / GMT+2. */
export function tzAbbr(ts = Date.now()) {
  if (!isLocalTime()) return "UTC";
  try {
    return tzAbbrFormatter.formatToParts(new Date(ts)).find((p) => p.type === "timeZoneName")?.value || "local";
  } catch {
    return "local";
  }
}

export const hourOf = (ts) => {
  const d = new Date(ts);
  return isLocalTime() ? d.getHours() : d.getUTCHours();
};

export const minuteOf = (ts) => {
  const d = new Date(ts);
  return isLocalTime() ? d.getMinutes() : d.getUTCMinutes();
};

/* ── dates ────────────────────────────────────────────────────────────────── */

export const pad2 = (n) => String(n).padStart(2, "0");

export function startOfUTCDay(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function isoDate(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function fmtDate(ts) {
  if (!Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtShortDate(ts) {
  if (!Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtClock(ts) {
  if (!Number.isFinite(ts)) return "—";
  return `${pad2(hourOf(ts))}:${pad2(minuteOf(ts))}`;
}

export function fmtTime(ts) {
  if (!Number.isFinite(ts)) return "—";
  return `${fmtClock(ts)} ${tzAbbr(ts)}`;
}

export const dowIndex = (ts) => (new Date(ts).getUTCDay() + 6) % 7;
export const fmtWeekday = (ts) => (Number.isFinite(ts) ? DOW_SHORT[dowIndex(ts)] : "—");
export const fmtWeekdayLong = (ts) => (Number.isFinite(ts) ? DOW_LONG[dowIndex(ts)] : "—");

export const addDays = (ts, days) => ts + days * DAY_MS;
export const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);

export function isoWeekOf(ts) {
  const d = new Date(ts);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((target - firstThursday) / (7 * DAY_MS));
}

/* ── stats ────────────────────────────────────────────────────────────────── */

export function quantile(values, q) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  if (a.length === 1) return a[0];
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export const median = (values) => quantile(values, 0.5);

export function stats(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return { n: 0, median: null, q1: null, q3: null, iqr: null, min: null, max: null };
  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  return {
    n: clean.length,
    median: median(clean),
    q1,
    q3,
    iqr: q3 - q1,
    min: Math.min(...clean),
    max: Math.max(...clean),
  };
}

/**
 * Gaps in days between consecutive distinct launch days. Same-day launches
 * (e.g. Pro + Flash together) are one event, so they don't produce 0-day gaps.
 */
export function launchDayGaps(records) {
  const days = [...new Set(records.map((r) => r.dayStart))].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < days.length; i++) gaps.push(Math.round((days[i] - days[i - 1]) / DAY_MS));
  return gaps;
}

/** Same gaps as launchDayGaps, but each carries the two launch days it spans. */
export function launchDayGapDetails(records) {
  const days = [...new Set(records.map((r) => r.dayStart))].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < days.length; i++) out.push({ gap: Math.round((days[i] - days[i - 1]) / DAY_MS), from: days[i - 1], to: days[i] });
  return out;
}

export function countBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

export function groupBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/* ── formatting ───────────────────────────────────────────────────────────── */

export function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtDays(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
  return `${v}d`;
}

export function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.1) return `$${n.toFixed(2)}`;
  if (n < 10) return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

export function fmtContext(k) {
  if (k == null || !Number.isFinite(k)) return "—";
  if (k >= 1000) {
    const m = k / 1000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M tokens`;
  }
  return `${k}k tokens`;
}

export function fmtParams(total, active) {
  if (total == null) return "—";
  const fmt = (b) => (b >= 1000 ? `${Number((b / 1000).toFixed(1))}T` : `${Number(b.toFixed(1))}B`);
  if (active != null && active !== total) return `${fmt(total)} total · ${fmt(active)} active`;
  return fmt(total);
}

export const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

export function safeUrl(url) {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try { return new URL(u).href; } catch { return null; }
}

export function domainOf(url) {
  const safe = safeUrl(url);
  if (!safe) return "";
  try { return new URL(safe).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function flattenSignals(r) {
  const out = [];
  if (r.codename) out.push(`codename: ${r.codename}`);
  for (const s of r.pre_release_signals || []) {
    const text = String(s);
    if (!out.some((x) => x.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  return out;
}

export function csvCell(value) {
  if (value == null) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ── DOM helpers ──────────────────────────────────────────────────────────── */

function appendChildren(node, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === true) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

function applyAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.setAttribute("class", value);
    else if (key === "text") node.textContent = value;
    else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith("--")) node.style.setProperty(prop, v);
        else node.style[prop] = v;
      }
    } else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
}

/** HTML element builder: h("div", {class:"x"}, "text", childNode). */
export function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, kids);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny "n of 3" confidence mark: ●●● / ●●○ / ●○○ */
export function confidenceDots(level, label = "Source confidence") {
  const n = { high: 3, medium: 2, low: 1 }[level] ?? 1;
  const el = h("span", { class: "dots", role: "img", "aria-label": `${label}: ${level}`, title: `${label}: ${level}` });
  for (let i = 0; i < 3; i++) el.append(h("i", { class: i < n ? "on" : "" }));
  return el;
}

/** "12 Oct 2026 · 15:00 UTC" — date and time follow the selected zone; falls back to "time unknown" / "~" for approximate. */
export function fmtWhen(r) {
  const date = fmtReleaseDate(r);
  if (!r.hasTime) return `${date} · time unknown`;
  return `${date} · ${r.time_confidence === "approximate" ? "~" : ""}${fmtTime(r.ts)}`;
}

/** Date of the release as displayed: local calendar date for timed records, official release date otherwise. */
export function fmtReleaseDate(r) {
  if (!isLocalTime() || !r.hasTime) return fmtDate(r.dayStart);
  const d = new Date(r.ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtReleaseShortDate(r) {
  if (!isLocalTime() || !r.hasTime) return fmtShortDate(r.dayStart);
  const d = new Date(r.ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtReleaseWeekdayLong(r) {
  if (!isLocalTime() || !r.hasTime) return fmtWeekdayLong(r.dayStart);
  return DOW_LONG[(new Date(r.ts).getDay() + 6) % 7];
}

export function releaseDayIndex(r) {
  if (!isLocalTime() || !r.hasTime) return r.dayIndex;
  return (new Date(r.ts).getDay() + 6) % 7;
}

export const modalityLabel = (id) => MODALITY_BY_ID[id]?.label || id || "Unknown";

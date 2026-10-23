#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   MONAITOR — daily rescan
   Polls two free, keyless sources for new model releases and appends them to
   data/<lab_id>.json as CONTRACT.md records:

   - OpenRouter   GET https://openrouter.ai/api/v1/models
                  every hosted model, with a listing timestamp, context, price.
   - Hugging Face GET https://huggingface.co/api/models?author=<org>
                  open-weights drops, incl. ones never served on OpenRouter.

   Anything already in data/ (matched on name, api_model_id or id) is skipped.
   Only items first seen inside the look-back window are considered, so old
   models that the hand-researched data represents differently are not
   re-added. New records are marked `"auto_detected": true` and carry
   `confidence: "medium"` (OpenRouter) or `"low"` (Hugging Face only).

   Usage:
     node scripts/rescan.mjs                  # last 7 days, writes data/
     node scripts/rescan.mjs --dry-run        # print, don't write
     node scripts/rescan.mjs --lookback=30    # wider window
     node scripts/rescan.mjs --since=2026-10-01
     node scripts/rescan.mjs --fixtures=dir   # read openrouter.json / hf-<org>.json from dir
   Node 18+; no dependencies.
   ───────────────────────────────────────────────────────────────────────────── */

import { readFile, writeFile, appendFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const DAY_MS = 86_400_000;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SCOPE_START = "2026-01-01";

// OpenRouter author prefix → lab_id
const OPENROUTER_PREFIX = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "x-ai": "xai",
  "meta-llama": "meta",
  meta: "meta",
  deepseek: "deepseek",
  qwen: "alibaba",
  mistralai: "mistral",
  moonshotai: "moonshot",
  "z-ai": "zhipu",
  thudm: "zhipu",
};

// Hugging Face org → lab_id
const HF_ORGS = {
  openai: "openai",
  google: "google",
  "meta-llama": "meta",
  "xai-org": "xai",
  "deepseek-ai": "deepseek",
  Qwen: "alibaba",
  "Wan-AI": "alibaba",
  mistralai: "mistral",
  moonshotai: "moonshot",
  "zai-org": "zhipu",
};

// Orgs that also publish research repos: only these names count as releases.
const HF_NAME_FILTER = {
  google: /gemma|gemini|veo|imagen|lyria/i,
};

// Repos that are derivatives, not releases.
const HF_SKIP = /(gguf|awq|gptq|fp8|fp4|nvfp4|int4|int8|w4a16|w8a8|mlx|bnb|onnx|quant|eagle|mtp|draft|lora|adapter|-base$|-base-|tokenizer|demo|test)/i;
const HF_PIPELINES = new Set([
  "text-generation", "image-text-to-text", "any-to-any", "text-to-image", "image-to-image",
  "text-to-video", "image-to-video", "text-to-speech", "automatic-speech-recognition",
  "feature-extraction", "sentence-similarity", "audio-text-to-text", "video-text-to-text",
  "image-to-text", "text-to-audio",
]);

// ── args ────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const DRY = Boolean(args["dry-run"]);
const NOW = args.now ? Date.parse(`${args.now}T23:59:59Z`) : Date.now();
const SINCE = args.since
  ? Date.parse(`${args.since}T00:00:00Z`)
  : NOW - Number(args.lookback || 7) * DAY_MS;

// ── helpers ─────────────────────────────────────────────────────────────────
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isoDate = (ts) => new Date(ts).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);

function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
}

/** Every string a release might be known by, normalised, for duplicate checks. */
function matchKeys(...names) {
  const keys = new Set();
  for (const raw of names) {
    if (!raw) continue;
    const base = String(raw).replace(/^[^:]+:\s*/, "").split("/").pop().replace(/:[a-z-]+$/, "");
    for (const v of [
      base,
      base.replace(/[-_ ]?(\d{8}|\d{4}-\d{2}-\d{2})$/, ""), // dated snapshot
      base.replace(/[-_ ]instruct$/i, ""),
    ]) {
      const k = norm(v);
      if (k.length >= 3) keys.add(k);
    }
  }
  return keys;
}

async function getJson(url, fixture) {
  if (args.fixtures) return JSON.parse(await readFile(join(args.fixtures, fixture), "utf8"));
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "monaitor-rescan (+github actions)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// ── classification heuristics (only for new, unreviewed records) ────────────
function classifyTier(name, openWeights, paramsB) {
  const n = name.toLowerCase();
  if (/\b(image|imagine|imagen|video|veo|sora|wan|embed\w*|ocr|guard|shield)\b/.test(n)) return "specialized";
  if (/\b(flash|mini|nano|lite|haiku|small|air|turbo|instant|luna|quip|fast)\b/.test(n)) return "fast";
  if (/\b(code|coder|codex|devstral|codestral|tts|voice|transcribe|audio|speech|omni)\b/.test(n)) return "specialized";
  if (/\b(sonnet|medium|plus)\b/.test(n)) return "mid";
  if (openWeights && paramsB != null && paramsB <= 35) return "open-weights-small";
  return "flagship";
}

const TIER_WORD = /\b(pro|max|ultra|opus|sonnet|haiku|flash|mini|nano|lite|small|medium|large|air|turbo|plus|instant|code|coder|codex)\b/i;

function familyOf(name) {
  const first = name.split(/[\s\-_]/)[0] || name;
  return first.replace(/[\d.]+$/, "") || first;
}

function versionOf(name) {
  const m = name.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}

function paramsOf(name) {
  const total = name.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  const active = name.match(/\ba(\d+(?:\.\d+)?)b\b/i);
  return {
    total: total && !/^a/i.test(total[0]) ? Number(total[1]) : null,
    active: active ? Number(active[1]) : null,
  };
}

function modalityFromOpenRouter(arch = {}) {
  const ins = arch.input_modalities || [];
  const outs = arch.output_modalities || [];
  if (outs.includes("video")) return "video";
  if (outs.includes("image") && !outs.includes("text")) return "image";
  if (outs.includes("audio") && !outs.includes("text")) return "audio";
  if (ins.some((m) => m !== "text") || outs.some((m) => m !== "text")) return "multimodal";
  return "text";
}

function modalityFromPipeline(tag) {
  return {
    "text-to-image": "image", "image-to-image": "image",
    "text-to-video": "video", "image-to-video": "video",
    "text-to-speech": "speech", "automatic-speech-recognition": "speech", "text-to-audio": "audio",
    "feature-extraction": "embedding", "sentence-similarity": "embedding",
    "image-text-to-text": "multimodal", "any-to-any": "multimodal", "video-text-to-text": "multimodal",
    "audio-text-to-text": "multimodal", "image-to-text": "multimodal",
  }[tag] || "text";
}

function pricePerM(perToken) {
  const v = Number(perToken);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 1e6 * 10000) / 10000;
}

function firstSentence(text, max = 240) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : clean;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ── sources → candidates ────────────────────────────────────────────────────
async function fromOpenRouter() {
  const json = await getJson("https://openrouter.ai/api/v1/models", "openrouter.json");
  const out = [];
  for (const m of json.data || []) {
    const [prefix, rest] = String(m.id || "").split("/");
    const labId = OPENROUTER_PREFIX[prefix];
    if (!labId || !rest || /:/.test(rest)) continue; // skip :free / :extended / :thinking variants
    const ts = Number(m.created) * 1000;
    if (!Number.isFinite(ts) || ts < SINCE || ts > NOW) continue;
    const name = String(m.name || rest).replace(/^[^:]+:\s*/, "").trim();
    const arch = m.architecture || {};
    const params = m.supported_parameters || [];
    const ins = arch.input_modalities || [];
    const outs = arch.output_modalities || [];
    const ctx = Number(m.context_length || m.top_provider?.context_length);
    const caps = [];
    if (params.includes("reasoning") || params.includes("include_reasoning")) caps.push("reasoning");
    if (ins.includes("image")) caps.push("vision");
    if (params.includes("tools")) caps.push("tool-use");
    if (ctx >= 200_000) caps.push("long-context");
    if (ins.includes("audio")) caps.push("audio-in");
    if (outs.includes("audio")) caps.push("audio-out");
    if (outs.includes("image")) caps.push("image-out");
    out.push({
      via: "openrouter",
      labId,
      name,
      ts,
      apiId: rest,
      hfId: m.hugging_face_id || null,
      modality: modalityFromOpenRouter(arch),
      caps,
      ctxK: Number.isFinite(ctx) && ctx > 0 ? Math.round(ctx / 1000) : null,
      priceIn: pricePerM(m.pricing?.prompt),
      priceOut: pricePerM(m.pricing?.completion),
      summary: firstSentence(m.description),
      sources: [`https://openrouter.ai/${m.id}`],
      keys: matchKeys(name, rest, m.canonical_slug, m.hugging_face_id),
    });
  }
  return out;
}

async function fromHuggingFace(org, labId) {
  const url = `https://huggingface.co/api/models?author=${encodeURIComponent(org)}&sort=createdAt&direction=-1&limit=40`;
  const list = await getJson(url, `hf-${org}.json`);
  const out = [];
  for (const m of list || []) {
    const repo = m.id || m.modelId;
    if (!repo || m.private || m.gated === "manual") continue;
    const ts = Date.parse(m.createdAt);
    if (!Number.isFinite(ts) || ts < SINCE || ts > NOW) continue;
    const base = repo.split("/").pop();
    if (HF_SKIP.test(base)) continue;
    if (HF_NAME_FILTER[org] && !HF_NAME_FILTER[org].test(base)) continue;
    if (m.pipeline_tag && !HF_PIPELINES.has(m.pipeline_tag)) continue;
    const license = (m.tags || []).find((t) => t.startsWith("license:"))?.slice(8) || null;
    out.push({
      via: "huggingface",
      labId,
      name: base.replace(/_/g, " "),
      ts,
      apiId: null,
      hfId: repo,
      license: license && license !== "other" ? license : null,
      modality: modalityFromPipeline(m.pipeline_tag),
      caps: [],
      ctxK: null,
      priceIn: null,
      priceOut: null,
      summary: null,
      sources: [`https://huggingface.co/${repo}`],
      keys: matchKeys(base, repo),
    });
  }
  return out;
}

// ── candidate → ModelRelease ────────────────────────────────────────────────
function buildRecord(c, labRows) {
  const releaseDate = isoDate(c.ts);
  const iso = new Date(c.ts).toISOString();
  const hasTime = c.via === "openrouter";
  const openWeights = Boolean(c.hfId);
  const params = c.batch ? { total: null, active: null } : paramsOf(c.name);
  const tier = classifyTier(c.name, openWeights, params.total);
  const family = familyOf(c.name);
  const version = versionOf(c.name);
  const tierWord = c.name.match(TIER_WORD)?.[0];
  const tierLabel = tierWord
    ? tierWord[0].toUpperCase() + tierWord.slice(1).toLowerCase()
    : c.name.slice(family.length).replace(/^[\s\-_]+/, "") || family;

  const prior = labRows.filter((r) => r.release_date <= releaseDate);
  const prevLab = prior.at(-1);
  const prevTier = prior.filter((r) => r.tier === tier).at(-1);
  const predecessor = prior.filter((r) => r.tier === tier && r.family === family).at(-1);

  let releaseType = "new-model";
  if (/\bpreview\b/i.test(c.name)) releaseType = "preview";
  else if (/\b(exp|experimental)\b/i.test(c.name)) releaseType = "experimental";
  else if (c.via === "huggingface") releaseType = "open-weights";
  else if (predecessor?.version && version) {
    const [a, b] = [parseInt(predecessor.version, 10), parseInt(version, 10)];
    if (b > a) releaseType = "major-version";
    else if (b === a && version !== predecessor.version) releaseType = "point-update";
  }

  const availability = [];
  if (c.apiId) availability.push("api");
  if (openWeights) availability.push("open-weights");

  return {
    id: `${c.labId}-${slug(c.name)}`,
    lab_id: c.labId,
    model_name: c.name,
    api_model_id: c.apiId,
    family,
    version,
    tier,
    tier_label: tierLabel,
    modality_primary: tier === "specialized" && /\b(code|coder|codex)\b/i.test(c.name) ? "code" : c.modality,
    capabilities: c.caps,
    release_type: releaseType,
    availability,
    open_weights: openWeights,
    license: c.license ?? null,
    params_total_b: params.total,
    params_active_b: params.active,
    context_window_k: c.ctxK,
    price_input_per_m: c.priceIn,
    price_output_per_m: c.priceOut,
    release_date: releaseDate,
    release_time_utc: hasTime ? iso.slice(11, 16) : null,
    release_datetime_utc: hasTime ? `${iso.slice(0, 16)}:00Z` : `${releaseDate}T00:00:00Z`,
    time_confidence: hasTime ? "approximate" : "unknown",
    day_of_week: DOW[new Date(`${releaseDate}T00:00:00Z`).getUTCDay()],
    iso_week: isoWeek(releaseDate),
    days_since_prev_lab_release: prevLab ? dayDiff(releaseDate, prevLab.release_date) : null,
    days_since_prev_same_tier: prevTier ? dayDiff(releaseDate, prevTier.release_date) : null,
    announcement_channel: c.via === "huggingface" ? "huggingface" : "docs-changelog",
    event: null,
    pre_release_signals: [],
    codename: null,
    predecessor_id: predecessor?.id ?? null,
    notable_benchmarks: {},
    summary: c.summary || `${c.name} — auto-detected on ${c.via === "openrouter" ? "OpenRouter" : "Hugging Face"}; details pending review.`,
    sources: c.sources,
    confidence: c.via === "openrouter" ? "medium" : "low",
    auto_detected: true,
  };
}

/** Append records to the file text so existing entries keep their exact formatting. */
function appendToFileText(text, existing, added) {
  const lastTs = existing.at(-1)?.release_datetime_utc ?? "";
  const allAfter = added.every((r) => r.release_datetime_utc >= lastTs);
  if (!allAfter || !existing.length) {
    const merged = [...existing, ...added].sort((a, b) => a.release_datetime_utc.localeCompare(b.release_datetime_utc));
    return `${JSON.stringify(merged, null, 2)}\n`;
  }
  const body = added.map((r) => JSON.stringify(r, null, 2).replace(/^/gm, "  ")).join(",\n");
  return text.replace(/\s*\]\s*$/, `,\n${body}\n]\n`);
}

// ── main ────────────────────────────────────────────────────────────────────
const files = (await readdir(DATA)).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
const labs = {};
const known = new Set();
for (const f of files) {
  const labId = f.replace(/\.json$/, "");
  const text = await readFile(join(DATA, f), "utf8");
  const rows = JSON.parse(text);
  labs[labId] = { file: join(DATA, f), text, rows };
  for (const r of rows) {
    for (const k of matchKeys(r.model_name, r.api_model_id, String(r.id || "").replace(`${labId}-`, ""))) known.add(`${labId}:${k}`);
  }
}

const warnings = [];
const settled = await Promise.allSettled([
  fromOpenRouter(),
  ...Object.entries(HF_ORGS).map(([org, lab]) => fromHuggingFace(org, lab)),
]);
const okSources = settled.filter((s) => s.status === "fulfilled").length;
for (const s of settled) if (s.status === "rejected") warnings.push(s.reason.message);
if (okSources === 0) {
  console.error("All sources failed:\n" + warnings.join("\n"));
  process.exit(1);
}

// OpenRouter first, so a Hugging Face repo for the same model merges into it.
const candidates = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
const accepted = [];
for (const c of candidates) {
  if (!labs[c.labId]) continue;
  if (isoDate(c.ts) < SCOPE_START) continue;
  const keys = [...c.keys].map((k) => `${c.labId}:${k}`);
  if (keys.some((k) => known.has(k))) {
    const twin = accepted.find((a) => a.labId === c.labId && [...a.keys].some((k) => c.keys.has(k)));
    if (twin && c.via === "huggingface" && !twin.sources.includes(c.sources[0])) {
      twin.hfId ??= c.hfId;
      twin.license ??= c.license;
      twin.sources.push(...c.sources);
    }
    continue;
  }
  keys.forEach((k) => known.add(k));
  accepted.push(c);
}

// A same-day batch of open-weights sizes (Qwen-style) is one release.
for (let i = accepted.length - 1; i >= 0; i--) {
  const c = accepted[i];
  if (c.via !== "huggingface") continue;
  const group = `${familyOf(c.name)}|${versionOf(c.name)}`;
  const head = accepted.find((a, j) => j < i && a.via === "huggingface" && a.labId === c.labId
    && isoDate(a.ts) === isoDate(c.ts) && `${familyOf(a.name)}|${versionOf(a.name)}` === group);
  if (!head) continue;
  let common = 0;
  while (common < head.name.length && head.name[common] === c.name[common]) common++;
  head.name = head.name.slice(0, common).replace(/[\s\-_]+\w*$/, "") || head.name;
  head.batch = true;
  head.sources.push(...c.sources);
  accepted.splice(i, 1);
}

const byLab = {};
for (const c of accepted.sort((a, b) => a.ts - b.ts)) {
  const lab = labs[c.labId];
  const rec = buildRecord(c, [...lab.rows, ...(byLab[c.labId] || [])]);
  (byLab[c.labId] ||= []).push(rec);
}

const lines = [];
for (const [labId, added] of Object.entries(byLab)) {
  const lab = labs[labId];
  for (const r of added) lines.push(`- **${r.model_name}** (${labId}) — ${r.release_date}, ${r.tier}, via ${r.sources[0]}`);
  if (!DRY) await writeFile(lab.file, appendToFileText(lab.text, lab.rows, added));
}

const window = `${isoDate(SINCE)} → ${isoDate(NOW)}`;
const report = [
  `### Monaitor rescan (${window})`,
  lines.length ? `${lines.length} new release${lines.length === 1 ? "" : "s"}${DRY ? " (dry run, not written)" : ""}:` : "No new releases.",
  ...lines,
  ...(warnings.length ? ["", "Sources that failed:", ...warnings.map((w) => `- ${w}`)] : []),
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `added=${lines.length}\n`);

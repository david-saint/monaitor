/* ─────────────────────────────────────────────────────────────────────────────
   MONAITOR — data acquisition + normalisation against CONTRACT.md
   ───────────────────────────────────────────────────────────────────────────── */

import {
  DAY_MS, DOW_LONG, LABS, LAB_BY_ID, LAB_IDS, MODALITY_BY_ID,
  TIER_BY_ID, TYPE_BY_ID, CONFIDENCE_ORDER, isoDate, isoWeekOf, stats,
  safeUrl, flattenSignals, launchDayGaps,
} from "./util.mjs?v=4";

const VALID_CONFIDENCE = new Set(["exact", "approximate", "unknown"]);
const VALID_TIERS = new Set(Object.keys(TIER_BY_ID));
const VALID_TYPES = new Set(Object.keys(TYPE_BY_ID));

function pick(obj, key, fallback = null) {
  return obj[key] === undefined ? fallback : obj[key];
}

function normaliseTime(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeRecord(raw, fileLabId, seenIds) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const labId = LAB_BY_ID[raw.lab_id] ? raw.lab_id : fileLabId;
  const lab = LAB_BY_ID[labId];
  if (!lab) return null;

  const rawDate = typeof raw.release_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.release_date)
    ? raw.release_date
    : (typeof raw.release_datetime_utc === "string" ? raw.release_datetime_utc.slice(0, 10) : null);
  if (!rawDate) return null;
  const dayStart = Date.parse(`${rawDate}T00:00:00Z`);
  if (!Number.isFinite(dayStart)) return null;

  const time = normaliseTime(raw.release_time_utc)
    || normaliseTime(
      typeof raw.release_datetime_utc === "string"
        ? (raw.release_datetime_utc.match(/T(\d{2}:\d{2})/) || [])[1]
        : null,
    );
  const confidence = VALID_CONFIDENCE.has(raw.time_confidence) ? raw.time_confidence : (time ? "exact" : "unknown");
  const hasTime = confidence !== "unknown" && Boolean(time);
  const datetime = hasTime ? `${rawDate}T${time}:00Z` : `${rawDate}T00:00:00Z`;
  const ts = Date.parse(datetime);
  if (!Number.isFinite(ts)) return null;

  const tier = VALID_TIERS.has(raw.tier) ? raw.tier : "specialized";
  const releaseType = VALID_TYPES.has(raw.release_type) ? raw.release_type : "new-model";
  const modality = MODALITY_BY_ID[raw.modality_primary] ? raw.modality_primary : "text";
  const confidenceLevel = ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "low";

  const modelName = String(raw.model_name || `${lab.name} release`).trim();
  const baseId = String(raw.id || `${labId}-${modelName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${rawDate}`);
  let uid = baseId;
  let n = 2;
  while (seenIds.has(uid)) uid = `${baseId}#${n++}`;
  seenIds.add(uid);

  const record = {
    ...raw,
    uid,
    id: baseId,
    lab_id: labId,
    lab,
    model_name: modelName,
    api_model_id: raw.api_model_id ?? null,
    family: raw.family || "—",
    version: raw.version ?? null,
    tier,
    tier_label: raw.tier_label || TIER_BY_ID[tier]?.short || tier,
    modality_primary: modality,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
    release_type: releaseType,
    availability: Array.isArray(raw.availability) ? raw.availability : [],
    open_weights: Boolean(raw.open_weights),
    license: raw.license ?? null,
    params_total_b: Number.isFinite(raw.params_total_b) ? raw.params_total_b : null,
    params_active_b: Number.isFinite(raw.params_active_b) ? raw.params_active_b : null,
    context_window_k: Number.isFinite(raw.context_window_k) ? raw.context_window_k : null,
    price_input_per_m: Number.isFinite(raw.price_input_per_m) ? raw.price_input_per_m : null,
    price_output_per_m: Number.isFinite(raw.price_output_per_m) ? raw.price_output_per_m : null,
    release_date: rawDate,
    release_time_utc: hasTime ? time : null,
    release_datetime_utc: datetime,
    time_confidence: confidence,
    hasTime,
    ts,
    dayStart,
    dayIndex: (new Date(dayStart).getUTCDay() + 6) % 7,
    day_of_week: DOW_LONG[(new Date(dayStart).getUTCDay() + 6) % 7],
    iso_week: isoWeekOf(dayStart),
    announcement_channel: raw.announcement_channel || null,
    event: raw.event ?? null,
    pre_release_signals: Array.isArray(raw.pre_release_signals) ? raw.pre_release_signals.map(String) : [],
    codename: raw.codename ?? null,
    predecessor_id: raw.predecessor_id ?? null,
    notable_benchmarks: raw.notable_benchmarks && typeof raw.notable_benchmarks === "object" ? raw.notable_benchmarks : {},
    summary: raw.summary || "",
    sources: Array.isArray(raw.sources) ? raw.sources.filter((u) => safeUrl(u)) : [],
    confidence: confidenceLevel,
    gapLab: null,
    gapTier: null,
    raw,
  };

  record.searchHaystack = [
    record.model_name, record.id, record.api_model_id, record.lab.name, record.lab.short,
    record.family, record.version, record.tier, record.tier_label, record.modality_primary,
    record.release_type, record.codename, record.summary, record.event, record.license,
    ...record.capabilities, ...record.pre_release_signals, ...record.sources,
    record.availability.join(" "),
  ].filter(Boolean).join(" ").toLowerCase();

  return record;
}

/** Compute per-lab and per-tier gap fields from dates (authoritative, file-order safe). */
function computeGaps(records) {
  const byLab = new Map();
  for (const r of records) {
    if (!byLab.has(r.lab_id)) byLab.set(r.lab_id, []);
    byLab.get(r.lab_id).push(r);
  }
  const labGapValues = [];
  for (const list of byLab.values()) {
    list.sort((a, b) => a.ts - b.ts);
    labGapValues.push(...launchDayGaps(list));
    list.forEach((r, i) => {
      if (i > 0) r.gapLab = Math.max(0, Math.round((r.ts - list[i - 1].ts) / DAY_MS));
      for (let j = i - 1; j >= 0; j--) {
        if (list[j].tier === r.tier) {
          r.gapTier = Math.max(0, Math.round((r.ts - list[j].ts) / DAY_MS));
          break;
        }
      }
    });
  }
  return { byLab, globalGapStats: stats(labGapValues) };
}

export async function loadDataset() {
  const attempts = await Promise.all(LABS.map(async (lab) => {
    const url = new URL(`../data/${lab.id}.json`, document.baseURI).href;
    let lastError = "fetch failed";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return { lab, ok: false, reason: `HTTP ${res.status}`, url };
        const json = await res.json();
        if (!Array.isArray(json)) return { lab, ok: false, reason: "not a JSON array", url };
        return { lab, ok: true, rows: json, url };
      } catch (err) {
        lastError = err?.message || "fetch failed";
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 160));
      }
    }
    return { lab, ok: false, reason: lastError, url };
  }));

  const loadedFeeds = attempts.filter((a) => a.ok);
  const missingLabs = attempts.filter((a) => !a.ok).map((a) => ({ id: a.lab.id, name: a.lab.name, reason: a.reason }));
  const seenIds = new Set();
  let releases = [];

  for (const feed of loadedFeeds) {
    for (const raw of feed.rows) {
      const rec = normalizeRecord(raw, feed.lab.id, seenIds);
      if (rec) releases.push(rec);
    }
  }

  let sampleMode = false;
  let fallbackReason = loadedFeeds.length ? "No usable records in live feeds." : "No lab data files found.";
  if (!releases.length) {
    const url = new URL("../data/_sample.json", document.baseURI).href;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error("sample file is not an array");
      releases = [];
      for (const raw of json) {
        const rec = normalizeRecord(raw, raw?.lab_id, seenIds);
        if (rec) releases.push(rec);
      }
      sampleMode = true;
    } catch (err) {
      const error = new Error(`No live lab feeds loaded. Sample fallback failed: ${err.message}`);
      error.details = attempts;
      throw error;
    }
  }

  const { byLab, globalGapStats } = computeGaps(releases);
  releases.sort((a, b) => b.ts - a.ts || a.lab_id.localeCompare(b.lab_id) || a.model_name.localeCompare(b.model_name));

  const counts = new Map();
  for (const r of releases) counts.set(r.lab_id, (counts.get(r.lab_id) || 0) + 1);

  const loadedLabs = LABS.filter((l) => (counts.get(l.id) || 0) > 0).map((l) => ({
    id: l.id, name: l.name, count: counts.get(l.id) || 0,
  }));
  const loadedFeedsWithNoRows = loadedFeeds.filter((f) => !counts.get(f.lab.id)).map((f) => f.lab.id);

  return {
    releases,
    byLab,
    loadedLabs,
    loadedFeeds: loadedFeeds.map((f) => ({ id: f.lab.id, rows: f.rows.length })),
    loadedFeedsWithNoRows,
    missingLabs,
    sampleMode,
    fallbackReason,
    globalGapStats,
    loadedAt: new Date(),
    coverage: `${loadedLabs.length}/${LABS.length}`,
    labCounts: counts,
    modalities: [...new Set(releases.map((r) => r.modality_primary))],
    dateRange: releases.length
      ? { min: Math.min(...releases.map((r) => r.ts)), max: Math.max(...releases.map((r) => r.ts)) }
      : null,
    labIdsWithData: LAB_IDS.filter((id) => (counts.get(id) || 0) > 0),
    confidenceCounts: releases.reduce((acc, r) => {
      acc[r.confidence] = (acc[r.confidence] || 0) + 1;
      return acc;
    }, {}),
    openWeightsCount: releases.filter((r) => r.open_weights).length,
    signalCount: releases.reduce((n, r) => n + flattenSignals(r).length, 0),
    isoDateToday: isoDate(Date.now()),
    confidenceOrder: CONFIDENCE_ORDER,
  };
}

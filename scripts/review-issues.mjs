#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   MONAITOR — review queue as GitHub issues
   Keeps one issue (label `auto-detected`) per record in data/ that still has
   `auto_detected: true`:

   - opens an issue for each such record that has never had one,
   - comments when the rescan filled something in (from --report),
   - closes the issue once `auto_detected` is removed from the record
     (or the record is deleted).

   An issue you close by hand stays closed. Runs in GitHub Actions:
     GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/review-issues.mjs --report=rescan.json
   ───────────────────────────────────────────────────────────────────────────── */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const LABEL = "auto-detected";
const MARKER = /<!-- monaitor-record: (\S+) -->/;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO } = process.env;
const BRANCH = process.env.GITHUB_REF_NAME || "main";
if (!TOKEN || !REPO) {
  console.error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
  process.exit(1);
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && !(method === "POST" && path === "/labels" && res.status === 422)) {
    throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

const show = (v) => (v == null || (Array.isArray(v) && !v.length) ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

function issueBody(rec, file) {
  const fileUrl = `https://github.com/${REPO}/blob/${BRANCH}/data/${file}`;
  const when = rec.release_time_utc ? `${rec.release_date} ${rec.release_time_utc} UTC (${rec.time_confidence})` : `${rec.release_date} (time unknown)`;
  const rows = [
    ["Lab", rec.lab_id],
    ["Released", when],
    ["Tier", `${rec.tier} — "${rec.tier_label}"`],
    ["Release type", rec.release_type],
    ["Predecessor", rec.predecessor_id],
    ["Modality", rec.modality_primary],
    ["Open weights", rec.open_weights ? `yes${rec.license ? ` (${rec.license})` : ""}` : "no"],
    ["Availability", rec.availability],
    ["Context", rec.context_window_k != null ? `${rec.context_window_k}k` : null],
    ["Price in / out ($/M)", rec.price_input_per_m != null ? `${rec.price_input_per_m} / ${show(rec.price_output_per_m)}` : null],
    ["Announced via", rec.announcement_channel],
    ["Confidence", rec.confidence],
  ];
  return [
    `The daily rescan added **${rec.model_name}** to [\`data/${file}\`](${fileUrl}). Its tier, release type and time are guesses; check them against the lab's own announcement.`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${show(v).replace(/\|/g, "\\|")} |`),
    "",
    "**Sources:** " + rec.sources.map((s) => `<${s}>`).join(" · "),
    "",
    "While the record keeps `auto_detected`, each daily run fills in fields that are still empty (open weights, prices, context) and comments here.",
    "",
    "- [ ] Release date and time match the primary announcement",
    "- [ ] Tier, tier label and release type are right",
    "- [ ] Announcement channel, primary source and `confidence` set",
    "- [ ] Benchmarks, codename, pre-release signals added if any",
    "- [ ] Remove `\"auto_detected\": true` from the record (this closes the issue)",
    "",
    `<!-- monaitor-record: ${rec.id} -->`,
  ].join("\n");
}

// Records still waiting for review
const pending = new Map();
const allIds = new Set();
for (const file of (await readdir(DATA)).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
  for (const rec of JSON.parse(await readFile(join(DATA, file), "utf8"))) {
    allIds.add(rec.id);
    if (rec.auto_detected) pending.set(rec.id, { rec, file });
  }
}

// Existing review issues, open and closed
const issues = new Map();
for (let page = 1; ; page++) {
  const batch = await gh("GET", `/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
  for (const issue of batch) {
    const id = issue.body?.match(MARKER)?.[1];
    if (id && !issue.pull_request && !issues.has(id)) issues.set(id, issue);
  }
  if (batch.length < 100) break;
}

await gh("POST", "/labels", { name: LABEL, color: "d4572a", description: "Release added by the daily rescan; needs review" });

const report = args.report ? JSON.parse(await readFile(args.report, "utf8").catch(() => "{}")) : {};
const log = [];

for (const [id, { rec, file }] of pending) {
  if (issues.has(id)) continue;
  const issue = await gh("POST", "/issues", {
    title: `Review: ${rec.model_name} (${rec.lab_id}, ${rec.release_date})`,
    body: issueBody(rec, file),
    labels: [LABEL],
  });
  issues.set(id, { ...issue, fresh: true });
  log.push(`opened #${issue.number} for ${id}`);
}

for (const u of report.updated || []) {
  const issue = issues.get(u.id);
  if (!issue || issue.state !== "open" || issue.fresh) continue;
  await gh("POST", `/issues/${issue.number}/comments`, {
    body: `The daily rescan filled in:\n${u.changes.map((c) => `- ${c}`).join("\n")}`,
  });
  log.push(`commented on #${issue.number}`);
}

for (const [id, issue] of issues) {
  if (issue.state !== "open" || pending.has(id)) continue;
  const why = allIds.has(id) ? "`auto_detected` was removed from the record, so it counts as reviewed." : "The record is no longer in `data/`.";
  await gh("POST", `/issues/${issue.number}/comments`, { body: `${why} Closing.` });
  await gh("PATCH", `/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
  log.push(`closed #${issue.number} for ${id}`);
}

console.log(log.length ? log.join("\n") : `Review issues up to date (${pending.size} awaiting review).`);

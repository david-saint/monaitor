# Monaitor — Model Release Data Contract (v1)

Scope: every publicly announced/released model from the 10 tracked labs with a release date in **2026 (Jan 1 – today, Oct 21 2026)**.

## Tracked labs (`lab_id`)
| lab_id | Lab | Main families |
|---|---|---|
| `openai` | OpenAI | GPT, o-series, gpt-oss, Sora, gpt-image, Codex |
| `anthropic` | Anthropic | Claude Opus / Sonnet / Haiku |
| `google` | Google DeepMind | Gemini Pro/Flash/Flash-Lite, Gemma, Veo, Imagen, Nano Banana |
| `xai` | xAI | Grok |
| `meta` | Meta (Superintelligence Labs) | Llama, etc. |
| `deepseek` | DeepSeek | V-series, R-series |
| `alibaba` | Alibaba / Qwen | Qwen, Wan |
| `mistral` | Mistral AI | Mistral Large/Medium/Small, Magistral, Devstral, Codestral |
| `moonshot` | Moonshot AI | Kimi |
| `zhipu` | Zhipu / Z.ai | GLM |

## Output files
- Research: `data/<lab_id>.json` — a JSON **array** of `ModelRelease` objects, sorted by `release_datetime_utc` ascending.
- Dashboard: `dashboard/` — loads every `data/*.json` and must work against this schema alone.

## `ModelRelease` schema
```jsonc
{
  "id": "anthropic-claude-opus-4-5",        // string, `${lab_id}-${slug(model_name)}`, unique
  "lab_id": "anthropic",                    // enum above
  "model_name": "Claude Opus 4.5",          // official marketing name
  "api_model_id": "claude-opus-4-5-20251101", // string | null
  "family": "Claude",                       // product family
  "version": "4.5",                         // string | null
  "tier": "flagship",                       // enum: "flagship" (Pro/Opus/Max/Ultra) | "mid" (Sonnet/Medium/standard) | "fast" (Flash/Haiku/Mini/Lite/Nano) | "open-weights-small" | "specialized"
  "tier_label": "Opus",                     // the lab's own word: Pro, Flash, Mini, Opus, Haiku...
  "modality_primary": "text",               // enum: "text" | "multimodal" | "image" | "video" | "audio" | "speech" | "embedding" | "code" | "world-model"
  "capabilities": ["reasoning","vision","tool-use","coding","agentic","long-context","audio-in","audio-out","image-out","video-out","computer-use"],
  "release_type": "new-model",              // enum: "new-model" | "major-version" | "point-update" | "preview" | "experimental" | "ga" (preview -> GA promotion) | "open-weights" | "deprecation-replacement"
  "availability": ["api","consumer-app","open-weights"], // subset of: "api" | "consumer-app" | "open-weights" | "enterprise-only" | "waitlist"
  "open_weights": false,                    // boolean
  "license": null,                          // string | null (e.g. "Apache-2.0", "MIT", "Llama Community")
  "params_total_b": null,                   // number | null (billions)
  "params_active_b": null,                  // number | null (MoE active)
  "context_window_k": 200,                  // number | null (thousands of tokens)
  "price_input_per_m": 5.0,                 // number | null USD per 1M input tokens
  "price_output_per_m": 25.0,               // number | null
  "release_date": "2026-01-14",             // YYYY-MM-DD (date of public announcement / availability)
  "release_time_utc": "17:00",              // HH:MM | null if unknown
  "release_datetime_utc": "2026-01-14T17:00:00Z", // ISO 8601; use T00:00:00Z if time unknown
  "time_confidence": "exact",               // enum: "exact" | "approximate" | "unknown"
  "day_of_week": "Wednesday",               // derived from release_date (UTC)
  "iso_week": 3,                            // integer
  "days_since_prev_lab_release": 21,        // integer | null — vs previous entry in same lab file
  "days_since_prev_same_tier": 63,          // integer | null — vs previous same lab + same tier
  "announcement_channel": "blog",           // enum: "blog" | "x-twitter" | "livestream" | "event-keynote" | "docs-changelog" | "huggingface" | "github" | "press"
  "event": null,                            // string | null — e.g. "Google I/O 2026", "DevDay 2026"
  "pre_release_signals": ["lmarena-codename:'xyz'", "leaked-in-app-strings"], // strings: codenames, arena sightings, leaks, rumors seen BEFORE launch
  "codename": null,                         // string | null
  "predecessor_id": null,                   // id of the model it replaces, or null
  "notable_benchmarks": { "SWE-bench Verified": 80.9 }, // object<string, number>, may be {}
  "summary": "One-sentence description.",   // string
  "sources": ["https://..."],               // >=1 URL, primary source preferred
  "confidence": "high"                      // enum: "high" (primary source) | "medium" (reputable press) | "low" (single/unclear source)
}
```

## Rules
- Unknown values: `null` (never invent). Arrays may be empty.
- One entry per distinct model release. Simultaneous launches (e.g. Pro + Flash same day) = separate entries.
- Previews and later GA of the same model = separate entries (`preview` then `ga`).
- Include image/video/audio/embedding models, not just LLMs.
- Do not include models released before 2026-01-01.

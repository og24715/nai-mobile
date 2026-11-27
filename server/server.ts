// nai-mobile API server: phone-friendly front for the NovelAI image API.
// TypeScript / Node built-in http + global fetch. Only dep: fflate (zip).
// Serves the React frontend build (dist/) as static files plus the API.
// The frontend source lives in src/ (Vite + React + Tailwind + shadcn/ui).
// The NovelAI token is stored ONLY in the user's browser (localStorage,
// key "nai.token") and is sent per generate request as an Authorization
// header. The server keeps nothing: it uses the token in memory for that
// single request and never writes it to disk or logs it.
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { unzipSync } from "fflate";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, "..");
const OUTPUTS = path.join(ROOT, "outputs");
const STATIC = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT) || 8196;
const API_URL = "https://image.novelai.net/ai/generate-image";
const UPSCALE_URL = "https://image.novelai.net/ai/upscale";
const ENCODE_VIBE_URL = "https://image.novelai.net/ai/encode-vibe";
const SUBSCRIPTION_URL = "https://image.novelai.net/user/subscription";
const SUGGEST_URL = "https://image.novelai.net/ai/generate-image/suggest-tags";
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0";
const DATA_DIR = path.join(ROOT, "data");
const PERSONAL_CACHE_FILE = path.join(DATA_DIR, "personal-tags.json");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const SEARCH_CACHE_FILE = path.join(DATA_DIR, "search-index.json");

fs.mkdirSync(OUTPUTS, { recursive: true });

interface CharInput { prompt?: string; negative?: string }
interface GenInput {
  prompt?: string; negative?: string; model?: string;
  width?: number; height?: number; steps?: number; scale?: number;
  sampler?: string; seed?: number | string | null;
  characters?: CharInput[];
  // img2img (improvement #43): a base image attached in the form.
  // image is PNG base64 (the client cover-crops/resizes it to the
  // selected generation size); strength / noise are 0..1.
  image?: string; strength?: number; noise?: number;
  // Vibe Transfer (improvement #44): vibes already encoded via
  // /api/encode-vibe on the client. Wired into the payload only
  // for models whose capability flags allow it (see modelCaps).
  vibes?: { encoded?: string; strength?: number; informationExtracted?: number }[];
  // Precise Reference (improvement #45): entries expanded into
  // the director_reference_* arrays for V4.5 models only (see
  // modelCaps); stripped for everything else.
  references?: { image?: string; type?: string; strength?: number; fidelity?: number }[];
}

function clamp01(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

const V4_MODELS = new Set([
  "nai-diffusion-5-full", "nai-diffusion-5-curated",
  "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated",
  "nai-diffusion-4-full", "nai-diffusion-4-curated",
]);
function paramsVersion(model: string): number {
  if (model.startsWith("nai-diffusion-5")) return 4;
  if (model.startsWith("nai-diffusion-4")) return 3;
  return 1;
}

// Per-model reference-feature availability — the server mirror of
// src/lib/capabilities.ts (keep the two in sync; that file is the
// documented single place to flip when V5 support lands):
// Vibe Transfer on the V4 + V4.5 families, Precise Reference on
// V4.5 only, both off for V5 and V3. buildPayload strips the
// reference parameters for unsupported models even when the
// client sends them.
function modelCaps(model: string): { vibeTransfer: boolean; preciseReference: boolean } {
  const v45 = model.startsWith("nai-diffusion-4-5");
  const v4 = v45 || model.startsWith("nai-diffusion-4");
  return { vibeTransfer: v4, preciseReference: v45 };
}

function buildPayload(g: GenInput) {
  const model = String(g.model || "nai-diffusion-4-5-full");
  const prompt = String(g.prompt || "").trim();
  const negative = String(g.negative || "").trim();
  // Empty seed (improvement #24): omit the seed from the request
  // entirely and let NovelAI choose. The generate handler retries
  // once with a random seed if NAI rejects that with a 400, and
  // recovers the actually-used seed from the returned PNG metadata.
  const seed = (g.seed === "" || g.seed === null || g.seed === undefined)
    ? null
    : Number(g.seed) >>> 0;
  const chars = (Array.isArray(g.characters) ? g.characters : [])
    .filter((c) => c && String(c.prompt || "").trim())
    .slice(0, 6)
    .map((c) => ({ prompt: String(c.prompt).trim(), negative: String(c.negative || "").trim() }));
  const isV4 = V4_MODELS.has(model);

  let input = prompt;
  const parameters: Record<string, unknown> = {
    params_version: paramsVersion(model),
    width: Number(g.width) || 832,
    height: Number(g.height) || 1216,
    scale: Number(g.scale) || 5,
    sampler: String(g.sampler || "k_euler_ancestral"),
    steps: Number(g.steps) || 28,
    ...(seed != null ? { seed } : {}),
    n_samples: 1,
    noise_schedule: "karras",
    uc: negative,
    qualityToggle: false,
    ucPreset: 3,
  };
  if (!isV4) {
    parameters.sm = false; parameters.sm_dyn = false;
    parameters.dynamic_thresholding = false;
    if (chars.length) {
      // v3 fallback: merge character prompts into the main prompt.
      input = [prompt, ...chars.map((c) => c.prompt)].filter(Boolean).join(", ");
    }
  } else {
    if (!model.startsWith("nai-diffusion-5")) {
      parameters.sm = false; parameters.sm_dyn = false;
      parameters.dynamic_thresholding = false;
    }
    // Centers are auto-assigned evenly across the width: x = (i + 0.5) / n.
    const centerAt = (i: number) => ({ x: (i + 0.5) / chars.length, y: 0.5 });
    parameters.v4_prompt = {
      caption: {
        base_caption: prompt,
        char_captions: chars.map((c, i) => ({
          char_caption: c.prompt,
          centers: [centerAt(i)],
        })),
      },
      use_coords: chars.length > 0,
      use_order: true,
    };
    parameters.v4_negative_prompt = {
      caption: {
        base_caption: negative,
        char_captions: chars.map((c, i) => ({
          char_caption: c.negative || negative,
          centers: [centerAt(i)],
        })),
      },
      legacy_uc: false,
    };
    parameters.characterPrompts = chars.map((c, i) => ({
      prompt: c.prompt,
      uc: c.negative || negative,
      center: centerAt(i),
      enabled: true,
    }));
  }
  // img2img (improvement #43): with a base image attached, the
  // request becomes an img2img generation on the same payload —
  // prompt / model / steps / CFG / sampler / v4 structures are
  // exactly the text-to-image ones; only the action and the image
  // parameters change. extra_noise_seed follows the effective
  // seed: the user's seed when one is set; on the seedless path
  // the generate handler fills it with the retry seed it adds.
  const isImg2Img = typeof g.image === "string" && g.image.length > 0;
  if (isImg2Img) {
    parameters.image = String(g.image).replace(/^data:image\/[a-z+]+;base64,/i, "");
    parameters.strength = clamp01(Number(g.strength), 0.7);
    parameters.noise = clamp01(Number(g.noise), 0);
    if (seed != null) parameters.extra_noise_seed = seed;
  }
  // Vibe Transfer (improvement #44): the three parallel
  // reference_*_multiple arrays, in entry order. For models
  // without the capability the parameters are stripped — never
  // sent upstream — even if the client sent encoded vibes.
  const caps = modelCaps(model);
  const vibes = (Array.isArray(g.vibes) ? g.vibes : [])
    .filter((v) => v && typeof v.encoded === "string" && v.encoded.length > 0)
    .slice(0, 4);
  if (caps.vibeTransfer && vibes.length) {
    parameters.reference_image_multiple = vibes.map((v) => String(v.encoded));
    parameters.reference_strength_multiple = vibes.map((v) => clamp01(Number(v.strength), 0.6));
    parameters.reference_information_extracted_multiple = vibes.map((v) => clamp01(Number(v.informationExtracted), 1));
  }
  // Precise Reference (improvement #45): the five parallel
  // director_reference_* arrays, in entry order. Descriptions
  // carry the reference type as the base caption; the secondary
  // strength is the fidelity inversion (1 - fidelity) and the
  // information extracted is fixed at 1.0, matching the official
  // client's shape. Stripped for non-V4.5 models even if sent.
  const refs = (Array.isArray(g.references) ? g.references : [])
    .filter((r) => r && typeof r.image === "string" && r.image.length > 0)
    .slice(0, 4);
  if (caps.preciseReference && refs.length) {
    const refType = (t: unknown) =>
      t === "style" || t === "character&style" ? String(t) : "character";
    parameters.director_reference_images = refs.map((r) =>
      String(r.image).replace(/^data:image\/[a-z+]+;base64,/i, ""));
    parameters.director_reference_descriptions = refs.map((r) => ({
      caption: { base_caption: refType(r.type), char_captions: [] },
      legacy_uc: false,
    }));
    parameters.director_reference_strength_values = refs.map((r) => clamp01(Number(r.strength), 0.7));
    parameters.director_reference_secondary_strength_values = refs.map((r) => 1 - clamp01(Number(r.fidelity), 0.5));
    parameters.director_reference_information_extracted = refs.map(() => 1.0);
  }
  return { payload: { input, model, action: isImg2Img ? "img2img" : "generate", parameters }, seed, model };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function sendJson(res: http.ServerResponse, code: number, obj: unknown) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req: http.IncomingMessage, maxBytes = 2_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let total = 0;
    req.on("data", (c: Buffer) => { total += c.length; if (total > maxBytes) { reject(new Error("body too large")); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// --- PNG text chunks ---------------------------------------------------
// NovelAI PNGs carry their generation parameters in a tEXt "Comment"
// chunk (JSON). Used by the personal-tag aggregation below (and by the
// seed recovery in the generate handler).
function extractPngText(buf: Buffer): Map<string, string> | null {
  if (
    buf.length < 8 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return null;
  }
  const out = new Map<string, string>();
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const dataStart = i + 8;
    if (dataStart + len > buf.length) break;
    if (type === "tEXt") {
      const nul = buf.indexOf(0, dataStart);
      if (nul > dataStart && nul < dataStart + len) {
        const key = buf.toString("latin1", dataStart, nul);
        if (!out.has(key)) {
          out.set(key, buf.toString("utf8", nul + 1, dataStart + len));
        }
      }
    }
    if (type === "IEND") break;
    i = dataStart + len + 4;
  }
  return out;
}

// --- Personal tags (improvements #22 + #103) ---------------------------
// Tags the user actually generates with, aggregated from the Comment
// metadata of outputs/*.png (main prompt, UC, and every character
// caption).
//
// #103: the #22 design compared a whole-directory signature and rebuilt
// the aggregate from EVERY PNG whenever any file changed. With ~37k
// files in outputs/ that rebuild took ~45s and, being synchronous, it
// blocked the event loop -- so the first /api/tags call after any
// generation stalled generation itself. Like the search index (#101),
// the store is now per-file and persistent: data/personal-tags.json
// (version 2) keeps each file's own tag counts with its mtime/size, a
// refresh parses only new or changed files (head-read via
// extractPngTextHead) and drops deleted ones, and the aggregate is
// cached behind a version counter. A 10s freshness TTL on top means
// typing-time /api/tags calls usually skip the directory diff
// entirely; suggestions may lag reality by up to 10s, never more.
interface PersonalEntry {
  display: string;
  count: number;
}
interface PersonalFileRecord {
  mtimeMs: number;
  size: number;
  tags: Record<string, PersonalEntry>;
}
let personalFiles: Map<string, PersonalFileRecord> | null = null;
let personalAgg: {
  version: number;
  counts: Map<string, PersonalEntry>;
} | null = null;
let personalVersion = 0;
let personalLastRefresh = 0;
let personalRefresh: Promise<Map<string, PersonalEntry>> | null = null;
const PERSONAL_TTL_MS = 10_000;

function normalizeTagKey(s: string): string {
  return s.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function collectTagsFromPrompt(
  text: string,
  counts: Map<string, PersonalEntry>,
) {
  // Weighted-section markers are stripped (the bare tags inside count),
  // braces/brackets dropped, and source#/target#/mutual# prefixes
  // removed so suggestions offer the bare tag.
  const cleaned = text
    .replace(/-?(?:\d+(?:\.\d+)?|\.\d+)::/g, ",")
    .replace(/::/g, ",")
    .replace(/[{}[\]]/g, "");
  for (const piece of cleaned.split(",")) {
    const tag = piece.trim().replace(/^(source|target|mutual)#/, "");
    if (!tag || tag.length > 80) continue;
    const key = normalizeTagKey(tag);
    if (!key) continue;
    const cur = counts.get(key);
    if (cur) cur.count++;
    else counts.set(key, { display: tag, count: 1 });
  }
}

function promptStringsFromComment(c: Record<string, unknown>): string[] {
  const out: string[] = [];
  const capStrings = (block: unknown) => {
    const cap = (block as { caption?: unknown } | null)?.caption as
      | { base_caption?: unknown; char_captions?: unknown }
      | undefined;
    if (!cap) return;
    if (typeof cap.base_caption === "string") out.push(cap.base_caption);
    if (Array.isArray(cap.char_captions)) {
      for (const cc of cap.char_captions) {
        const t = (cc as { char_caption?: unknown } | null)?.char_caption;
        if (typeof t === "string") out.push(t);
      }
    }
  };
  if (c.v4_prompt || c.v4_negative_prompt) {
    // prompt/uc duplicate the v4 base captions, so read captions only.
    capStrings(c.v4_prompt);
    capStrings(c.v4_negative_prompt);
  } else {
    if (typeof c.prompt === "string") out.push(c.prompt);
    if (typeof c.uc === "string") out.push(c.uc);
  }
  if (Array.isArray(c.characterPrompts)) {
    for (const cp of c.characterPrompts) {
      const o = cp as { prompt?: unknown; uc?: unknown } | null;
      if (typeof o?.prompt === "string") out.push(o.prompt);
      if (typeof o?.uc === "string") out.push(o.uc);
    }
  }
  return out;
}

// --- XMP sidecars for Immich (improvement #108) ---
// Every PNG saved into outputs/ also gets a "<name>.png.xmp" sidecar
// so Immich's tag search stays current without a manual batch run.
// The sidecar mirrors ~/workspace/immich/nai_xmp.py exactly (the tool
// that backfilled the existing library): digiKam:TagsList built from
// the POSITIVE prompt strings only, plus dc:description holding the
// full positive prompt text. It is built from the saved file's own
// Comment, read back via extractPngTextHead, so it matches the
// embedded metadata whatever generation path produced the file.

// promptStringsFromComment minus every negative part: for v4 images
// only the v4_prompt caption block (the top-level prompt/uc duplicate
// it and are not read), otherwise the top-level prompt only; plus each
// characterPrompts entry's prompt (never its uc).
function positivePromptStringsFromComment(c: Record<string, unknown>): string[] {
  const out: string[] = [];
  const capStrings = (block: unknown) => {
    if (!block || typeof block !== "object") return;
    const cap = (block as { caption?: unknown }).caption;
    if (!cap || typeof cap !== "object") return;
    const { base_caption, char_captions } = cap as {
      base_caption?: unknown;
      char_captions?: unknown;
    };
    if (typeof base_caption === "string") out.push(base_caption);
    if (Array.isArray(char_captions)) {
      for (const cc of char_captions) {
        const t = (cc as { char_caption?: unknown } | null)?.char_caption;
        if (typeof t === "string") out.push(t);
      }
    }
  };
  if (c.v4_prompt || c.v4_negative_prompt) {
    capStrings(c.v4_prompt);
  } else {
    if (typeof c.prompt === "string") out.push(c.prompt);
  }
  if (Array.isArray(c.characterPrompts)) {
    for (const cp of c.characterPrompts) {
      const o = cp as { prompt?: unknown } | null;
      if (typeof o?.prompt === "string") out.push(o.prompt);
    }
  }
  return out;
}

// NAI weight token: "1.5::", "-0.3::", ".5::" (weights may span
// commas, so one can appear anywhere inside a comma-split piece, and
// stray "::" openers/closers are left behind as well).
const XMP_WEIGHT_TOKEN = /-?(?:\d+(?:\.\d+)?|\.\d+)::/g;

function cleanXmpTag(piece: string): string | null {
  let t = piece.trim();
  t = t.replace(XMP_WEIGHT_TOKEN, "");
  t = t.split("::").join("");
  // Emphasis braces/brackets: drop the characters, keep the text.
  for (const ch of "{}[]") t = t.split(ch).join("");
  t = t.split(/\s+/).filter(Boolean).join(" ");
  if (!t || t.length > 120) return null;
  // "/" is Immich's tag-hierarchy separator; flatten it.
  t = t.split("/").join("-");
  return t;
}

function xmpTagsFromPrompts(prompts: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const s of prompts) {
    for (const piece of s.split(",")) {
      const tag = cleanXmpTag(piece);
      if (tag !== null && !seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }
  }
  return tags;
}

// Same escaping as Python's xml.sax.saxutils.escape (default entities).
function xmlEscapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildXmpSidecar(tags: string[], description: string): string {
  const items = tags.map((t) => `     <rdf:li>${xmlEscapeText(t)}</rdf:li>`).join("\n");
  return (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="nai_xmp 1.0">\n' +
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '  <rdf:Description rdf:about=""\n' +
    '    xmlns:digiKam="http://www.digikam.org/ns/1.0/"\n' +
    '    xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    "   <digiKam:TagsList>\n" +
    "    <rdf:Bag>\n" +
    `${items}\n` +
    "    </rdf:Bag>\n" +
    "   </digiKam:TagsList>\n" +
    "   <dc:description>\n" +
    "    <rdf:Alt>\n" +
    `     <rdf:li xml:lang="x-default">${xmlEscapeText(description)}</rdf:li>\n` +
    "    </rdf:Alt>\n" +
    "   </dc:description>\n" +
    "  </rdf:Description>\n" +
    " </rdf:RDF>\n" +
    "</x:xmpmeta>\n"
  );
}

// Write the sidecar for one PNG already saved in outputs/. Fully
// self-contained failure-wise: a missing/unparsable Comment just
// means no sidecar, and any error is logged, never thrown — the
// generation response must not depend on this.
function writeXmpSidecar(name: string): void {
  try {
    const texts = extractPngTextHead(path.join(OUTPUTS, name));
    const comment = texts?.get("Comment");
    if (!comment) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(comment) as Record<string, unknown>;
    } catch {
      return; /* Comment is not JSON */
    }
    if (!parsed || typeof parsed !== "object") return;
    const prompts = positivePromptStringsFromComment(parsed);
    if (!prompts.length) return;
    const xmp = buildXmpSidecar(xmpTagsFromPrompts(prompts), prompts.join(", "));
    fs.writeFileSync(path.join(OUTPUTS, name + ".xmp"), xmp, "utf8");
  } catch (e) {
    console.error(`xmp sidecar failed for ${name}:`, e);
  }
}

// The on-disk per-file store, loaded once per process. An old-format
// (version 1: {sig, counts}) or unreadable file just means every file
// parses fresh on the first refresh.
function loadPersonalFiles(): Map<string, PersonalFileRecord> {
  if (personalFiles) return personalFiles;
  const map = new Map<string, PersonalFileRecord>();
  try {
    const j = JSON.parse(fs.readFileSync(PERSONAL_CACHE_FILE, "utf8")) as {
      version?: number;
      files?: Record<string, PersonalFileRecord>;
    };
    if (j && j.version === 2 && j.files) {
      for (const [name, r] of Object.entries(j.files)) {
        if (
          r &&
          typeof r.mtimeMs === "number" &&
          typeof r.size === "number" &&
          r.tags &&
          typeof r.tags === "object"
        ) {
          map.set(name, { mtimeMs: r.mtimeMs, size: r.size, tags: r.tags });
        }
      }
    }
  } catch {
    /* no usable cache -- everything parses fresh on the first refresh */
  }
  personalFiles = map;
  return map;
}

function savePersonalFiles(): void {
  if (!personalFiles) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write-then-rename so a crash mid-save keeps the previous store.
    const tmp = PERSONAL_CACHE_FILE + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify({ version: 2, files: Object.fromEntries(personalFiles) }),
    );
    fs.renameSync(tmp, PERSONAL_CACHE_FILE);
  } catch {
    /* cache persistence is best-effort */
  }
}

// One file's tag counts, from its Comment metadata (same inputs as the
// old full rebuild: promptStringsFromComment + collectTagsFromPrompt).
function parsePersonalFileTags(name: string): Record<string, PersonalEntry> {
  const counts = new Map<string, PersonalEntry>();
  try {
    const texts = extractPngTextHead(path.join(OUTPUTS, name));
    const comment = texts?.get("Comment");
    if (comment) {
      const parsed = JSON.parse(comment) as Record<string, unknown>;
      for (const s of promptStringsFromComment(parsed)) {
        collectTagsFromPrompt(s, counts);
      }
    }
  } catch {
    /* unreadable PNG / unparsable Comment -- no tags */
  }
  return Object.fromEntries(counts);
}

// Sum the per-file records into the aggregate the handler serves.
// Cached behind personalVersion, which bumps only when the store
// actually changed, so repeat calls don't re-sum ~37k records.
function aggregatePersonalCounts(): Map<string, PersonalEntry> {
  if (personalAgg && personalAgg.version === personalVersion) {
    return personalAgg.counts;
  }
  const counts = new Map<string, PersonalEntry>();
  for (const rec of loadPersonalFiles().values()) {
    for (const [key, e] of Object.entries(rec.tags)) {
      const cur = counts.get(key);
      if (cur) cur.count += e.count;
      else counts.set(key, { display: e.display, count: e.count });
    }
  }
  personalAgg = { version: personalVersion, counts };
  return counts;
}

function refreshPersonalCounts(): Map<string, PersonalEntry> {
  const files = loadPersonalFiles();
  const names = outputPngNames();
  const listed = new Set(names);
  let changed = false;
  for (const name of [...files.keys()]) {
    if (!listed.has(name)) {
      files.delete(name);
      changed = true;
    }
  }
  for (const name of names) {
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(OUTPUTS, name));
    } catch {
      continue; /* vanished mid-scan */
    }
    const prev = files.get(name);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue;
    files.set(name, {
      mtimeMs: st.mtimeMs,
      size: st.size,
      tags: parsePersonalFileTags(name),
    });
    changed = true;
  }
  if (changed) {
    personalVersion++;
    savePersonalFiles();
  }
  personalLastRefresh = Date.now();
  return aggregatePersonalCounts();
}

// The handler's entry point: serve the cached aggregate while it is
// fresh (< PERSONAL_TTL_MS since the last completed refresh), else run
// one refresh shared by all concurrent callers.
function getPersonalCounts(): Promise<Map<string, PersonalEntry>> {
  if (personalAgg && Date.now() - personalLastRefresh < PERSONAL_TTL_MS) {
    return Promise.resolve(personalAgg.counts);
  }
  if (!personalRefresh) {
    personalRefresh = Promise.resolve()
      .then(() => refreshPersonalCounts())
      .catch(() => personalAgg?.counts ?? new Map<string, PersonalEntry>())
      .finally(() => {
        personalRefresh = null;
      });
  }
  return personalRefresh;
}

// --- Favorites (improvement #61) ----------------------------------------
// The user marks the generations he likes as favorites; everything
// else can then be bulk-deleted ("Delete Others"). The store is a
// plain JSON array of output filenames in data/favorites.json
// (gitignored with the rest of data/). Entries whose files have
// disappeared are pruned whenever the store is read or written.
function outputPngNames(): string[] {
  try {
    return fs.readdirSync(OUTPUTS).filter((f) => f.toLowerCase().endsWith(".png"));
  } catch {
    return [];
  }
}

function readFavorites(): string[] {
  const listed = new Set(outputPngNames());
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf8"));
  } catch {
    /* no store yet — no favorites */
  }
  const names = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : [];
  return [...new Set(names)].filter((n) => listed.has(n));
}

function writeFavorites(favs: string[]): string[] {
  const listed = new Set(outputPngNames());
  const clean = [...new Set(favs)].filter((n) => listed.has(n));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify(clean));
  } catch {
    /* persistence is best-effort */
  }
  return clean;
}

// --- PNG dimensions (blank-hero fix) ------------------------------------
// The hero carousel's AutoHeight plugin snapshots slide heights once at
// Embla init — before the slide images have loaded — and never
// re-measures (Embla's resize handling only watches the scroll-axis
// size). Slide <img>s therefore need their intrinsic size up front, so
// /api/recent carries each file's IHDR width/height and the client can
// reserve the aspect ratio before any image bytes arrive. Reading the
// dimensions costs 24 bytes per file; results are cached by
// name+mtime+size so repeat calls stay cheap.
const pngSizeCache = new Map<string, { width: number; height: number }>();
function pngSize(
  name: string,
  mtimeMs: number,
  size: number,
): { width: number; height: number } | null {
  const key = `${name}:${mtimeMs}:${size}`;
  const hit = pngSizeCache.get(key);
  if (hit) return hit;
  try {
    const fd = fs.openSync(path.join(OUTPUTS, name), "r");
    try {
      const buf = Buffer.alloc(24);
      if (fs.readSync(fd, buf, 0, 24, 0) < 24) return null;
      // 8-byte signature, 4-byte chunk length, "IHDR", then the
      // width/height as big-endian uint32s at offsets 16/20.
      if (buf.toString("latin1", 12, 16) !== "IHDR") return null;
      const dims = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      if (dims.width <= 0 || dims.height <= 0) return null;
      pngSizeCache.set(key, dims);
      return dims;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

// --- Search index (improvements #95 + #101) ----------------------------
// Full-text search over outputs/*.png for the /search page. Each record
// carries the normalized searchable text (main prompt, UC, and every
// character caption, via promptStringsFromComment), the seed, and the
// model from the PNG Source text chunk. Favorite state is NOT cached
// here -- it lives in its own store and is applied per request.
//
// #101: outputs/ grew to ~37k files (imported phone generations), and
// the #95 design -- an in-memory index rebuilt from scratch whenever
// outputsSignature() changed -- took ~50s per rebuild, so the first
// search after any new generation (or a server restart) stalled. The
// index is now persistent and incremental: records are stored in
// data/search-index.json keyed by filename with the file's mtime/size,
// each refresh stats the directory and parses ONLY files that are new
// or changed, drops records whose files were deleted, and reuses the
// stored record for everything else. Parsing itself reads only the
// PNG's head chunks (extractPngTextHead) instead of the whole file.
interface SearchRecord {
  mtimeMs: number;
  size: number;
  text: string;
  seed: number | null;
  model: string | null;
  width?: number;
  height?: number;
}
interface SearchEntry extends SearchRecord {
  name: string;
}
let searchRecords: Map<string, SearchRecord> | null = null;
// In-flight refresh shared by concurrent /api/search requests, so a
// burst of searches triggers one directory scan, not one per request.
let searchRefresh: Promise<SearchEntry[]> | null = null;

// Head-limited variant of extractPngText for the search index: walks
// the file's chunks from the start, reading only chunk headers plus
// tEXt payloads, and stops as soon as an IDAT chunk begins once both
// "Comment" and "Source" have been collected (NovelAI writes all of
// its tEXt chunks before IDAT). If IDAT arrives before both are found,
// the walk continues (skipping non-tEXt payloads without reading them)
// exactly like extractPngText, so no text chunk is ever missed.
// Returns null for a non-PNG / unreadable file, like extractPngText.
function extractPngTextHead(file: string): Map<string, string> | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const sig = Buffer.alloc(8);
    if (
      fs.readSync(fd, sig, 0, 8, 0) < 8 ||
      sig[0] !== 0x89 ||
      sig[1] !== 0x50 ||
      sig[2] !== 0x4e ||
      sig[3] !== 0x47
    ) {
      return null;
    }
    const out = new Map<string, string>();
    const header = Buffer.alloc(8);
    let pos = 8;
    for (;;) {
      if (fs.readSync(fd, header, 0, 8, pos) < 8) break;
      const len = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (type === "IDAT" && out.has("Comment") && out.has("Source")) break;
      if (type === "tEXt") {
        const data = Buffer.alloc(len);
        if (fs.readSync(fd, data, 0, len, pos + 8) < len) break;
        const nul = data.indexOf(0);
        if (nul > 0) {
          const key = data.toString("latin1", 0, nul);
          if (!out.has(key)) {
            out.set(key, data.toString("utf8", nul + 1));
          }
        }
      }
      if (type === "IEND") break;
      pos += 8 + len + 4;
    }
    return out;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function buildSearchRecord(name: string, st: fs.Stats): SearchRecord {
  const texts = extractPngTextHead(path.join(OUTPUTS, name));
  let text = "";
  let seed: number | null = null;
  const comment = texts?.get("Comment");
  if (comment) {
    try {
      const parsed = JSON.parse(comment) as Record<string, unknown>;
      text = normalizeTagKey(promptStringsFromComment(parsed).join(", "));
      if (typeof parsed.seed === "number" && Number.isFinite(parsed.seed)) {
        seed = parsed.seed;
      }
    } catch {
      /* unparsable Comment */
    }
  }
  const dims = pngSize(name, st.mtimeMs, st.size);
  return {
    mtimeMs: st.mtimeMs,
    size: st.size,
    text,
    seed,
    model: texts?.get("Source") || null,
    ...(dims ? { width: dims.width, height: dims.height } : {}),
  };
}

// The on-disk records, loaded once per process. A missing / corrupt
// file just means every file parses fresh on the first refresh.
function loadSearchRecords(): Map<string, SearchRecord> {
  if (searchRecords) return searchRecords;
  const map = new Map<string, SearchRecord>();
  try {
    const j = JSON.parse(fs.readFileSync(SEARCH_CACHE_FILE, "utf8")) as {
      records?: Record<string, SearchRecord>;
    };
    if (j && j.records) {
      for (const [name, r] of Object.entries(j.records)) {
        if (
          r &&
          typeof r.mtimeMs === "number" &&
          typeof r.size === "number" &&
          typeof r.text === "string"
        ) {
          map.set(name, {
            mtimeMs: r.mtimeMs,
            size: r.size,
            text: r.text,
            seed: typeof r.seed === "number" ? r.seed : null,
            model: typeof r.model === "string" ? r.model : null,
            ...(typeof r.width === "number" && typeof r.height === "number"
              ? { width: r.width, height: r.height }
              : {}),
          });
        }
      }
    }
  } catch {
    /* no usable cache — everything parses fresh on the first refresh */
  }
  searchRecords = map;
  return map;
}

function saveSearchRecords(): void {
  if (!searchRecords) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write-then-rename so a crash mid-save keeps the previous index.
    const tmp = SEARCH_CACHE_FILE + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify({ records: Object.fromEntries(searchRecords) }),
    );
    fs.renameSync(tmp, SEARCH_CACHE_FILE);
  } catch {
    /* cache persistence is best-effort */
  }
}

async function refreshSearchIndex(): Promise<SearchEntry[]> {
  const records = loadSearchRecords();
  const names = outputPngNames();
  const listed = new Set(names);
  let changed = false;
  for (const name of [...records.keys()]) {
    if (!listed.has(name)) {
      records.delete(name);
      changed = true;
    }
  }
  const entries: SearchEntry[] = [];
  for (const name of names) {
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(OUTPUTS, name));
    } catch {
      continue; /* vanished mid-scan */
    }
    const prev = records.get(name);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) {
      entries.push({ name, ...prev });
      continue;
    }
    try {
      const rec = buildSearchRecord(name, st);
      records.set(name, rec);
      changed = true;
      entries.push({ name, ...rec });
    } catch {
      /* skip an unreadable PNG */
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (changed) saveSearchRecords();
  return entries;
}

function loadSearchIndex(): Promise<SearchEntry[]> {
  if (!searchRefresh) {
    searchRefresh = refreshSearchIndex()
      .catch(() => [] as SearchEntry[])
      .finally(() => {
        searchRefresh = null;
      });
  }
  return searchRefresh;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const p = url.pathname.replace(/^\/+/, "");
    if (req.method === "GET" && !p.startsWith("api/") && !p.startsWith("outputs/")) {
      // Static frontend (Vite build in dist/) with SPA fallback: "/" and
      // "/setup" (and any other app path) return index.html.
      const rel = p === "" ? "index.html" : p;
      const file = path.join(STATIC, path.normalize(rel));
      const type = MIME[path.extname(file).toLowerCase()];
      if (type && file.startsWith(STATIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const data = fs.readFileSync(file);
        res.writeHead(200, { "Content-Type": type, "Content-Length": data.length });
        res.end(data); return;
      }
      const index = path.join(STATIC, "index.html");
      if (fs.existsSync(index)) {
        const data = fs.readFileSync(index);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": data.length });
        res.end(data); return;
      }
      res.writeHead(404); res.end("not found"); return;
    }
    if (req.method === "GET" && p === "api/status") { sendJson(res, 200, { ok: true, port: PORT }); return; }
    if (req.method === "GET" && p === "api/recent") {
      // Each item carries its favorites-store state (improvement
      // #61); total / favoriteCount cover the WHOLE outputs/
      // listing (not just the 30 shown) so the client's
      // Delete-Others confirmation can state exact numbers.
      const favs = new Set(readFavorites());
      const all = fs.readdirSync(OUTPUTS).filter((f) => f.toLowerCase().endsWith(".png"))
        .map((f) => { const st = fs.statSync(path.join(OUTPUTS, f)); return { name: f, mtime: st.mtimeMs, size: st.size }; })
        .sort((a, b) => b.mtime - a.mtime);
      const items = all.slice(0, 30)
        .map((x) => {
          // IHDR dimensions let the client reserve each image's
          // aspect ratio before it loads; omitted when the header
          // can't be parsed.
          const dims = pngSize(x.name, x.mtime, x.size);
          return { name: x.name, url: "outputs/" + encodeURIComponent(x.name), favorite: favs.has(x.name), ...(dims ? { width: dims.width, height: dims.height } : {}) };
        });
      sendJson(res, 200, { ok: true, items, total: all.length, favoriteCount: favs.size }); return;
    }
    if (req.method === "GET" && p === "api/search") {
      // Image search (improvement #95): every whitespace/comma-separated
      // term must match -- as a normalized substring of the prompt / UC /
      // character text, or, for an all-digits term, as an exact seed.
      // Empty q matches everything. No token: same unauthenticated
      // local read as /api/recent.
      const q = url.searchParams.get("q") || "";
      const favoritesOnly = url.searchParams.get("favorites") === "1";
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const limit = Math.min(120, Math.max(1, Number(url.searchParams.get("limit")) || 60));
      const terms = q.split(/[\s,]+/).filter(Boolean).map((t) => ({
        raw: t,
        key: normalizeTagKey(t),
        digits: /^\d+$/.test(t),
      }));
      const favs = new Set(readFavorites());
      const matched = (await loadSearchIndex()).filter((e) => {
        if (favoritesOnly && !favs.has(e.name)) return false;
        return terms.every((t) => {
          if (t.digits && e.seed !== null && e.seed === Number(t.raw)) return true;
          return t.key !== "" && e.text.includes(t.key);
        });
      });
      const items = matched.slice(offset, offset + limit).map((x) => {
        // Dimensions are stored in the index record (#101); pngSize
        // is only a fallback for a record that has none.
        const dims = x.width && x.height ? { width: x.width, height: x.height } : pngSize(x.name, x.mtimeMs, x.size);
        return { name: x.name, url: "outputs/" + encodeURIComponent(x.name), favorite: favs.has(x.name), seed: x.seed, model: x.model, mtime: x.mtimeMs, ...(dims ? { width: dims.width, height: dims.height } : {}) };
      });
      sendJson(res, 200, { ok: true, items, total: matched.length }); return;
    }
    if (req.method === "GET" && p === "api/subscription") {
      // Same relay pattern as generate: the browser's token arrives as
      // a per-request Authorization header and is used in memory for
      // this one upstream call only — never stored or logged. Only
      // derived fields are returned; the client renders a thin bar
      // from them and never displays the raw numbers.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "API token is not set. Open ⚙ Settings and save your Persistent API Token." }); return; }
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch(SUBSCRIPTION_URL, { signal: ctrl.signal,
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0" } });
      } catch {
        clearTimeout(timer);
        sendJson(res, 502, { ok: false, error: "Failed to connect to the NovelAI API" }); return;
      }
      clearTimeout(timer);
      if (!resp.ok) {
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: your token may be invalid. Check it and save it again from ⚙ Settings." }); return; }
        sendJson(res, 502, { ok: false, error: `NovelAI API ${resp.status}` }); return;
      }
      const data = (await resp.json()) as {
        tier?: number;
        active?: boolean;
        trainingStepsLeft?: { fixedTrainingStepsLeft?: number; purchasedTrainingSteps?: number };
        usage?: { percent?: number; isNegative?: boolean } | null;
      };
      const trainingStepsLeft = data.trainingStepsLeft
        ? {
            fixedTrainingStepsLeft: Number(data.trainingStepsLeft.fixedTrainingStepsLeft) || 0,
            purchasedTrainingSteps: Number(data.trainingStepsLeft.purchasedTrainingSteps) || 0,
          }
        : null;
      const anlasTotal = trainingStepsLeft
        ? trainingStepsLeft.fixedTrainingStepsLeft + trainingStepsLeft.purchasedTrainingSteps
        : null;
      const usage = data.usage
        ? { percent: Number(data.usage.percent) || 0, isNegative: !!data.usage.isNegative }
        : null;
      sendJson(res, 200, { tier: typeof data.tier === "number" ? data.tier : null, active: !!data.active, anlasTotal, trainingStepsLeft, usage }); return;
    }
    if (req.method === "GET" && p === "api/tags") {
      // Tag suggestions (improvement #22): NovelAI's official
      // suggest-tags endpoint, relayed with the browser's token (same
      // in-memory-only pattern as /api/subscription), merged with the
      // user's personal tags from outputs/ metadata. Personal matches
      // come first (marked with their usage count as "mine"); official
      // results keep their returned order. Without a token — or if the
      // official call fails — personal matches alone are returned; the
      // endpoint never errors the UI.
      const q = (url.searchParams.get("q") || "").trim();
      const model =
        url.searchParams.get("model") || "nai-diffusion-4-5-full";
      const limit = Math.min(
        20,
        Math.max(1, Number(url.searchParams.get("limit")) || 10),
      );
      interface TagItem {
        name: string;
        count: number | null;
        confidence: number | null;
        mine: number;
      }
      const items: TagItem[] = [];
      if (q) {
        const counts = await getPersonalCounts();
        const qKey = normalizeTagKey(q);
        const byKey = new Map<string, TagItem>();
        if (qKey) {
          const personal = [...counts.entries()]
            .filter(([key]) => key.startsWith(qKey))
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, limit);
          for (const [key, v] of personal) {
            const item: TagItem = {
              name: v.display,
              count: null,
              confidence: null,
              mine: v.count,
            };
            items.push(item);
            byKey.set(key, item);
          }
        }
        const auth = String(req.headers.authorization || "");
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        if (token.length >= 10 && items.length < limit) {
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 10_000);
            const resp = await fetch(
              `${SUGGEST_URL}?model=${encodeURIComponent(model)}&prompt=${encodeURIComponent(q)}&lang=en`,
              {
                signal: ctrl.signal,
                headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
              },
            );
            clearTimeout(timer);
            if (resp.ok) {
              // The OpenAPI schema types the response's "tags" field
              // ambiguously (a singular $ref), so accept an array, a
              // single object, or a bare item defensively.
              const data: unknown = await resp.json();
              let list: unknown[] = [];
              if (Array.isArray(data)) list = data;
              else if (data && typeof data === "object") {
                const tags = (data as { tags?: unknown }).tags;
                if (Array.isArray(tags)) list = tags;
                else if (tags && typeof tags === "object") list = [tags];
                else if (typeof (data as { tag?: unknown }).tag === "string") {
                  list = [data];
                }
              }
              for (const raw of list) {
                const it = raw as {
                  tag?: unknown;
                  name?: unknown;
                  count?: unknown;
                  confidence?: unknown;
                } | null;
                const name =
                  typeof it?.tag === "string"
                    ? it.tag
                    : typeof it?.name === "string"
                      ? it.name
                      : "";
                if (!name) continue;
                const key = normalizeTagKey(name);
                const existing = byKey.get(key);
                if (existing) {
                  // Already shown as a personal tag: enrich it with
                  // the official count/confidence instead of duping.
                  if (typeof it?.count === "number") existing.count = it.count;
                  if (typeof it?.confidence === "number") {
                    existing.confidence = it.confidence;
                  }
                  continue;
                }
                const item: TagItem = {
                  name,
                  count: typeof it?.count === "number" ? it.count : null,
                  confidence:
                    typeof it?.confidence === "number" ? it.confidence : null,
                  mine: counts.get(key)?.count ?? 0,
                };
                items.push(item);
                byKey.set(key, item);
                if (items.length >= limit) break;
              }
            }
          } catch {
            /* official suggestions are best-effort */
          }
        }
      }
      sendJson(res, 200, { ok: true, items });
      return;
    }
    if (req.method === "GET" && p.startsWith("outputs/")) {
      const name = path.basename(decodeURIComponent(p.slice("outputs/".length)));
      const file = path.join(OUTPUTS, name);
      if (!name.endsWith(".png") || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
      const data = fs.readFileSync(file);
      const headers: Record<string, string> = { "Content-Type": "image/png", "Content-Length": String(data.length) };
      if (url.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="${name}"`;
      res.writeHead(200, headers); res.end(data); return;
    }
    if (req.method === "POST" && p === "api/favorite") {
      // Favorites (improvement #61): set or clear one outputs/
      // image's entry in the favorites store. Same per-request
      // token gate as the other POST routes; the token is not
      // used beyond the gate (a purely local operation).
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "API token is not set. Open ⚙ Settings and save your Persistent API Token." }); return; }
      const body = JSON.parse((await readBody(req)).toString("utf8")) as { name?: unknown; favorite?: unknown };
      const name = typeof body.name === "string" ? body.name : "";
      // Same outputs/ exact-match validation as upscale/enhance —
      // no path traversal is possible.
      if (!name || !outputPngNames().includes(name)) { sendJson(res, 400, { ok: false, error: "Image not found" }); return; }
      const fav = body.favorite === true;
      const favs = readFavorites();
      writeFavorites(fav ? [...favs, name] : favs.filter((n) => n !== name));
      // Same item shape as /api/recent entries.
      sendJson(res, 200, { ok: true, item: { name, url: "outputs/" + encodeURIComponent(name), favorite: fav } }); return;
    }
    if (req.method === "POST" && p === "api/delete-others") {
      // Delete Others (improvement #61): bulk-delete every
      // outputs/ PNG that is NOT a favorite. Only names taken
      // from the directory listing itself are ever unlinked, so
      // nothing outside outputs/ can be touched. Same token gate
      // as the other POST routes.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "API token is not set. Open ⚙ Settings and save your Persistent API Token." }); return; }
      await readBody(req); // no body fields; drained for symmetry
      const favs = new Set(readFavorites());
      let deleted = 0;
      for (const name of outputPngNames()) {
        if (favs.has(name)) continue;
        try {
          fs.unlinkSync(path.join(OUTPUTS, name));
          deleted++;
        } catch {
          /* already gone — not counted */
        }
      }
      writeFavorites([...favs]);
      sendJson(res, 200, { ok: true, deleted }); return;
    }
    if (req.method === "POST" && p === "api/upscale") {
      // Upscale (improvements #39 + #41): relay one outputs/ image to
      // NovelAI's standalone upscaler. Same token pattern as
      // generate: the browser's token arrives per-request and is
      // used in memory for this one upstream call only.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "API token is not set. Open ⚙ Settings and save your Persistent API Token." }); return; }
      const body = JSON.parse((await readBody(req)).toString("utf8")) as { name?: unknown; model?: unknown; blurSigma?: unknown };
      const name = typeof body.name === "string" ? body.name : "";
      // The name must be a file actually present in outputs/ —
      // exact match against the directory listing, so no path
      // traversal is possible.
      const listed = fs.readdirSync(OUTPUTS).filter((f) => f.toLowerCase().endsWith(".png"));
      if (!name || !listed.includes(name)) { sendJson(res, 400, { ok: false, error: "Image not found" }); return; }
      // Since the V5 launch the standalone upscaler accepts ONLY
      // V5 models (V4.5 and older are rejected upstream), so the
      // model is validated here instead of failing obscurely.
      const UPSCALE_MODELS = new Set(["nai-diffusion-5-full", "nai-diffusion-5-curated"]);
      const model = typeof body.model === "string" ? body.model : "";
      if (!UPSCALE_MODELS.has(model)) { sendJson(res, 400, { ok: false, error: "Upscale is V5-only (V4.5 and below are not supported)" }); return; }
      // declared_blur_sigma takes only these discrete values
      // (the generation-side rounding set); absent means 0.
      const BLUR_SIGMAS = new Set([0, 0.3, 0.35, 0.4, 0.45, 0.5]);
      const blurSigma = body.blurSigma === undefined ? 0 : Number(body.blurSigma);
      if (!BLUR_SIGMAS.has(blurSigma)) { sendJson(res, 400, { ok: false, error: "Invalid blur sigma value" }); return; }
      const png = fs.readFileSync(path.join(OUTPUTS, name));
      // Current upstream protocol (changed with the V5 launch;
      // the old JSON + base64 body is answered with a 401): a
      // MULTIPART form with the PNG as file part "image"
      // (filename "blob") and a JSON file part "request" whose
      // "image" value is the literal string "image", pointing at
      // the file part. There is NO scale field — the factor is
      // fixed. Content-Type is left unset so fetch fills in the
      // multipart boundary.
      const form = new FormData();
      form.append("image", new Blob([png], { type: "image/png" }), "blob");
      form.append("request", new Blob(
        [JSON.stringify({ image: "image", model, declared_blur_sigma: blurSigma })],
        { type: "application/json" },
      ), "request.json");
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 180_000);
      let resp: Response;
      try {
        resp = await fetch(UPSCALE_URL, { method: "POST", signal: ctrl.signal,
          headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, Accept: "application/x-zip-compressed" },
          body: form });
      } catch (e) {
        clearTimeout(timer);
        sendJson(res, 500, { ok: false, error: String((e as Error)?.message || e) }); return;
      }
      clearTimeout(timer);
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 500);
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: your token may be invalid. Check it and save it again from ⚙ Settings." }); return; }
        sendJson(res, 502, { ok: false, error: `NovelAI API ${resp.status}: ${text}` }); return;
      }
      // Default response is a zip of PNGs (same as generate-image);
      // a JSON body of base64 images is the documented alternative
      // when the upstream answers with one, so accept both.
      let outPng: Buffer | null = null;
      if ((resp.headers.get("content-type") || "").includes("application/json")) {
        const data = (await resp.json()) as { images?: { image?: unknown }[] };
        const b64 = Array.isArray(data.images) && typeof data.images[0]?.image === "string" ? data.images[0].image : "";
        if (b64) outPng = Buffer.from(b64, "base64");
      } else {
        const zip = new Uint8Array(await resp.arrayBuffer());
        const files = unzipSync(zip);
        for (const [fname, data] of Object.entries(files)) {
          if (fname.toLowerCase().endsWith(".png")) { outPng = Buffer.from(data); break; }
        }
      }
      if (!outPng) { sendJson(res, 502, { ok: false, error: "The API response contained no PNG" }); return; }
      const base = name.replace(/\.png$/i, "");
      let out = `${base}_up.png`;
      for (let n = 2; fs.existsSync(path.join(OUTPUTS, out)); n++) out = `${base}_up${n}.png`;
      fs.writeFileSync(path.join(OUTPUTS, out), outPng);
      writeXmpSidecar(out);
      // Same item shape as /api/recent entries.
      sendJson(res, 200, { ok: true, item: { name: out, url: "outputs/" + encodeURIComponent(out) } }); return;
    }
    if (req.method === "POST" && p === "api/enhance") {
      // Enhance (improvement #42): the official client's Enhance
      // Image is not a separate endpoint — it is generate-image
      // with action "img2img", driven by the SOURCE image's own
      // stored generation parameters (read from its PNG Comment),
      // not by the client's current form. Same per-request token
      // relay as generate/upscale; nothing is stored server-side.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "API token is not set. Open ⚙ Settings and save your Persistent API Token." }); return; }
      const body = JSON.parse((await readBody(req)).toString("utf8")) as { name?: unknown; scale?: unknown; strength?: unknown; noise?: unknown };
      const name = typeof body.name === "string" ? body.name : "";
      // Same outputs/ exact-match validation as the upscale route.
      const listed = fs.readdirSync(OUTPUTS).filter((f) => f.toLowerCase().endsWith(".png"));
      if (!name || !listed.includes(name)) { sendJson(res, 400, { ok: false, error: "Image not found" }); return; }
      const scaleSel = body.scale;
      if (!(scaleSel === 2 || scaleSel === 1.5 || scaleSel === 1 || scaleSel === "max")) { sendJson(res, 400, { ok: false, error: "Invalid scale value" }); return; }
      const strength = Number(body.strength);
      const noise = Number(body.noise);
      if (!Number.isFinite(strength) || strength < 0 || strength > 1 || !Number.isFinite(noise) || noise < 0 || noise > 1) { sendJson(res, 400, { ok: false, error: "Invalid Strength / Noise value" }); return; }
      const png = fs.readFileSync(path.join(OUTPUTS, name));
      // The payload is built from the image's own Comment metadata
      // (it embeds the full generation parameters). No Comment =
      // nothing to rebuild the generation from.
      let meta: Record<string, unknown> = {};
      const commentRaw = extractPngText(png)?.get("Comment");
      if (commentRaw) { try { meta = JSON.parse(commentRaw) as Record<string, unknown>; } catch { meta = {}; } }
      const srcPrompt = typeof meta.prompt === "string" ? meta.prompt : "";
      if (!srcPrompt) { sendJson(res, 400, { ok: false, error: "This image has no settings embedded" }); return; }
      // Model: mapped from the metadata's display name (Full
      // variants; the metadata carries no Full/Curated split).
      // Unmappable names fall back to V4.5 Full.
      const displayName = typeof meta.model_name === "string" ? meta.model_name : "";
      const model = displayName.includes("V5") ? "nai-diffusion-5-full"
        : displayName.includes("V4.5") ? "nai-diffusion-4-5-full"
        : displayName.includes("V4") ? "nai-diffusion-4-full"
        : displayName.includes("V3") ? "nai-diffusion-3"
        : "nai-diffusion-4-5-full";
      const isV5 = model.startsWith("nai-diffusion-5");
      if (scaleSel === "max" && !isV5) { sendJson(res, 400, { ok: false, error: "MAX is only for images generated with a V5 model" }); return; }
      // Target size. Source dims come from the PNG IHDR (the
      // actual pixels); scaled dims are rounded to multiples of
      // 64 and capped at 3,145,728 px total, per the official
      // client's rule. "max" sends the source's own 64-rounded
      // dims with upscaled_enhance and lets NovelAI produce 2x
      // (aspect-fitted to the same cap).
      const srcW = png.length >= 24 ? png.readUInt32BE(16) : 0;
      const srcH = png.length >= 24 ? png.readUInt32BE(20) : 0;
      if (!srcW || !srcH) { sendJson(res, 400, { ok: false, error: "Could not read the image size" }); return; }
      const round64 = (n: number) => Math.max(64, Math.round(n / 64) * 64);
      const PX_CAP = 3_145_728;
      let width: number; let height: number; let upscaledEnhance = false;
      if (scaleSel === "max") {
        width = round64(srcW); height = round64(srcH); upscaledEnhance = true;
      } else {
        width = round64(srcW * scaleSel); height = round64(srcH * scaleSel);
        if (width * height > PX_CAP) { sendJson(res, 400, { ok: false, error: "The scaled size exceeds the limit" }); return; }
      }
      const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
      const parameters: Record<string, unknown> = {
        params_version: paramsVersion(model),
        width, height,
        scale: num(meta.scale, 5),
        sampler: typeof meta.sampler === "string" ? meta.sampler : "k_euler_ancestral",
        steps: num(meta.steps, 28),
        n_samples: 1,
        uc: typeof meta.uc === "string" ? meta.uc : "",
        // img2img core: the source image itself plus the dialog's
        // strength / noise. The seed is omitted (NovelAI chooses;
        // a 400 is retried once with a random seed, mirroring the
        // generate route) and the original seed is reused as the
        // extra noise seed.
        image: png.toString("base64"),
        strength, noise,
        extra_noise_seed: typeof meta.seed === "number" && Number.isFinite(meta.seed) ? meta.seed : Math.floor(Math.random() * 4294967295),
        ...(upscaledEnhance ? { upscaled_enhance: true } : {}),
      };
      // Stored generation parameters carried over when present.
      if (typeof meta.noise_schedule === "string") parameters.noise_schedule = meta.noise_schedule;
      if (typeof meta.cfg_rescale === "number") parameters.cfg_rescale = meta.cfg_rescale;
      if (typeof meta.uncond_scale === "number") parameters.uncond_scale = meta.uncond_scale;
      if (typeof meta.sm === "boolean") parameters.sm = meta.sm;
      if (typeof meta.sm_dyn === "boolean") parameters.sm_dyn = meta.sm_dyn;
      if (typeof meta.dynamic_thresholding === "boolean") parameters.dynamic_thresholding = meta.dynamic_thresholding;
      if (typeof meta.skip_cfg_above_sigma === "number") parameters.skip_cfg_above_sigma = meta.skip_cfg_above_sigma;
      if (V4_MODELS.has(model)) {
        // V4+ requests must keep the v4 prompt structures or the
        // API returns 500 — pass the stored ones through verbatim
        // (they carry the character captions and centers).
        parameters.v4_prompt = (meta.v4_prompt && typeof meta.v4_prompt === "object")
          ? meta.v4_prompt
          : { caption: { base_caption: srcPrompt, char_captions: [] }, use_coords: false, use_order: true };
        parameters.v4_negative_prompt = (meta.v4_negative_prompt && typeof meta.v4_negative_prompt === "object")
          ? meta.v4_negative_prompt
          : { caption: { base_caption: parameters.uc, char_captions: [] }, legacy_uc: false };
      } else {
        parameters.sm = false; parameters.sm_dyn = false;
        parameters.dynamic_thresholding = false;
      }
      const payload: { input: string; model: string; action: string; parameters: Record<string, unknown> } =
        { input: srcPrompt, model, action: "img2img", parameters };
      const callNAI = async (): Promise<Response> => {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 180_000);
        try {
          return await fetch(API_URL, { method: "POST", signal: ctrl.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": UA },
            body: JSON.stringify(payload) });
        } finally { clearTimeout(timer); }
      };
      let resp: Response;
      try {
        resp = await callNAI();
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String((e as Error)?.message || e) }); return;
      }
      // Seed omitted: retry once with a random seed on a 400 (a
      // 400 means the request was rejected, so nothing was
      // generated or charged) — same policy as the generate route.
      if (!resp.ok && resp.status === 400) {
        (payload.parameters as Record<string, unknown>).seed = Math.floor(Math.random() * 4294967295);
        try {
          const retry = await callNAI();
          if (retry.ok) { resp = retry; }
          else { await retry.text().catch(() => undefined); }
        } catch { /* fall through to the original error handling */ }
      }
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 500);
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: your token may be invalid. Check it and save it again from ⚙ Settings." }); return; }
        sendJson(res, 502, { ok: false, error: `NovelAI API ${resp.status}: ${text}` }); return;
      }
      const zip = new Uint8Array(await resp.arrayBuffer());
      const files = unzipSync(zip);
      let outPng: Buffer | null = null;
      for (const [fname, data] of Object.entries(files)) {
        if (fname.toLowerCase().endsWith(".png")) { outPng = Buffer.from(data); break; }
      }
      if (!outPng) { sendJson(res, 502, { ok: false, error: "The API response contained no PNG" }); return; }
      const base = name.replace(/\.png$/i, "");
      let out = `${base}_enh.png`;
      for (let n = 2; fs.existsSync(path.join(OUTPUTS, out)); n++) out = `${base}_enh${n}.png`;
      fs.writeFileSync(path.join(OUTPUTS, out), outPng);
      writeXmpSidecar(out);
      // Same item shape as /api/recent entries.
      sendJson(res, 200, { ok: true, item: { name: out, url: "outputs/" + encodeURIComponent(out) } }); return;
    }
    if (req.method === "POST" && p === "api/encode-vibe") {
      // Vibe Transfer encoding (improvement #44): relay one
      // device image to NovelAI's /ai/encode-vibe. The upstream
      // contract (public OpenAPI schema, image.EncodeVibeRequest):
      // JSON body { image (base64), model, information_extracted
      // (0..1) }; the answer is 201 with an application/binary
      // body — the vibe blob, which generation then takes
      // base64-encoded in reference_image_multiple, so that is
      // the form returned to the client. Costs 2 Anlas per encode
      // upstream; the client caches per (file, model, info).
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "API token is not set. Open ⚙ Settings and save your Persistent API Token." }); return; }
      const body = JSON.parse((await readBody(req, 40_000_000)).toString("utf8")) as { image?: unknown; model?: unknown; informationExtracted?: unknown };
      const image = typeof body.image === "string" ? body.image.replace(/^data:image\/[a-z+]+;base64,/i, "") : "";
      if (!image) { sendJson(res, 400, { ok: false, error: "No image provided" }); return; }
      const model = typeof body.model === "string" && body.model ? body.model : "nai-diffusion-4-5-full";
      const info = clamp01(Number(body.informationExtracted), 1);
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 180_000);
      let resp: Response;
      try {
        resp = await fetch(ENCODE_VIBE_URL, { method: "POST", signal: ctrl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": UA },
          body: JSON.stringify({ image, model, information_extracted: info }) });
      } catch (e) {
        clearTimeout(timer);
        sendJson(res, 500, { ok: false, error: String((e as Error)?.message || e) }); return;
      }
      clearTimeout(timer);
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 500);
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: your token may be invalid. Check it and save it again from ⚙ Settings." }); return; }
        sendJson(res, 502, { ok: false, error: `NovelAI API ${resp.status}: ${text}` }); return;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!buf.length) { sendJson(res, 502, { ok: false, error: "The API response was empty" }); return; }
      sendJson(res, 200, { ok: true, vibe: buf.toString("base64") }); return;
    }
    if (req.method === "POST" && p === "api/generate") {
      // Token arrives per-request from the browser (localStorage) and is
      // used only in memory for this one upstream call. Never persisted.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "API token is not set. Open ⚙ Settings and save your Persistent API Token." }); return; }
      const g = JSON.parse((await readBody(req, 24_000_000)).toString("utf8")) as GenInput;
      if (!String(g.prompt || "").trim()) { sendJson(res, 400, { ok: false, error: "The prompt is empty" }); return; }
      const { payload, seed } = buildPayload(g);
      let usedSeed: number | null = seed;
      const callNAI = async (): Promise<Response> => {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 180_000);
        try {
          return await fetch(API_URL, { method: "POST", signal: ctrl.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": UA },
            body: JSON.stringify(payload) });
        } finally { clearTimeout(timer); }
      };
      let resp: Response;
      try {
        resp = await callNAI();
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String((e as Error)?.message || e) }); return;
      }
      // Seed omitted (improvement #24): retry once with a random seed
      // if NAI rejects the request. A 400 means the request was
      // rejected, so nothing was generated or charged.
      if (!resp.ok && resp.status === 400 && usedSeed == null) {
        const retrySeed = Math.floor(Math.random() * 4294967295);
        (payload.parameters as Record<string, unknown>).seed = retrySeed;
        // img2img (#43): the extra noise seed follows the effective
        // seed, so the retry seed becomes it on this path too.
        if (typeof (payload.parameters as Record<string, unknown>).image === "string") {
          (payload.parameters as Record<string, unknown>).extra_noise_seed = retrySeed;
        }
        try {
          const retry = await callNAI();
          if (retry.ok) { resp = retry; usedSeed = retrySeed; }
          else { await retry.text().catch(() => undefined); }
        } catch { /* fall through to the original error handling */ }
      }
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 500);
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: your token may be invalid. Check it and save it again from ⚙ Settings." }); return; }
        sendJson(res, 502, { ok: false, error: `NovelAI API ${resp.status}: ${text}` }); return;
      }
      const zip = new Uint8Array(await resp.arrayBuffer());
      const files = unzipSync(zip);
      const pngs: Buffer[] = [];
      for (const [name, data] of Object.entries(files)) {
        if (name.toLowerCase().endsWith(".png")) pngs.push(Buffer.from(data));
      }
      if (!pngs.length) { sendJson(res, 502, { ok: false, error: "The API response contained no PNG" }); return; }
      // Recover the seed NovelAI actually used from the returned
      // PNG's Comment metadata (it embeds the full parameters).
      if (usedSeed == null) {
        try {
          const comment = extractPngText(pngs[0])?.get("Comment");
          if (comment) {
            const cj = JSON.parse(comment) as { seed?: unknown };
            if (typeof cj.seed === "number" && Number.isFinite(cj.seed)) usedSeed = cj.seed;
          }
        } catch { /* fall back to a seedless filename / null seed */ }
      }
      const saved: string[] = [];
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      pngs.forEach((data, idx) => {
        const out = `${stamp}_seed${usedSeed ?? "na"}_${idx}.png`;
        fs.writeFileSync(path.join(OUTPUTS, out), data);
        writeXmpSidecar(out);
        saved.push("outputs/" + encodeURIComponent(out));
      });
      sendJson(res, 200, { ok: true, images: saved, seed: usedSeed }); return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found");
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e as Error)?.message || e) });
  }
});
server.listen(PORT, "0.0.0.0", () => { console.log(`nai-mobile listening on ${PORT}`); });

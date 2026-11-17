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
const SUBSCRIPTION_URL = "https://image.novelai.net/user/subscription";
const SUGGEST_URL = "https://image.novelai.net/ai/generate-image/suggest-tags";
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0";
const DATA_DIR = path.join(ROOT, "data");
const PERSONAL_CACHE_FILE = path.join(DATA_DIR, "personal-tags.json");

fs.mkdirSync(OUTPUTS, { recursive: true });

interface CharInput { prompt?: string; negative?: string }
interface GenInput {
  prompt?: string; negative?: string; model?: string;
  width?: number; height?: number; steps?: number; scale?: number;
  sampler?: string; seed?: number | string | null;
  characters?: CharInput[];
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
  return { payload: { input, model, action: "generate", parameters }, seed, model };
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
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let total = 0;
    req.on("data", (c: Buffer) => { total += c.length; if (total > 2_000_000) { reject(new Error("body too large")); req.destroy(); return; } chunks.push(c); });
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

// --- Personal tags (improvement #22) ------------------------------------
// Tags the user actually generates with, aggregated from the Comment
// metadata of outputs/*.png (main prompt, UC, and every character
// caption). Cached in memory + data/personal-tags.json, rebuilt when
// the outputs directory changes (file count / newest mtime signature).
interface PersonalEntry {
  display: string;
  count: number;
}
let personalState: { sig: string; counts: Map<string, PersonalEntry> } | null =
  null;

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

function outputsSignature(): string {
  try {
    const names = fs
      .readdirSync(OUTPUTS)
      .filter((f) => f.toLowerCase().endsWith(".png"));
    let max = 0;
    for (const n of names) {
      const m = fs.statSync(path.join(OUTPUTS, n)).mtimeMs;
      if (m > max) max = m;
    }
    return `${names.length}:${Math.round(max)}`;
  } catch {
    return "0:0";
  }
}

function loadPersonalCounts(): Map<string, PersonalEntry> {
  const sig = outputsSignature();
  if (personalState && personalState.sig === sig) return personalState.counts;
  try {
    const j = JSON.parse(fs.readFileSync(PERSONAL_CACHE_FILE, "utf8")) as {
      sig?: string;
      counts?: Record<string, PersonalEntry>;
    };
    if (j && j.sig === sig && j.counts) {
      personalState = { sig, counts: new Map(Object.entries(j.counts)) };
      return personalState.counts;
    }
  } catch {
    /* no usable cache — rebuild below */
  }
  const counts = new Map<string, PersonalEntry>();
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(OUTPUTS)
      .filter((f) => f.toLowerCase().endsWith(".png"));
  } catch {
    /* no outputs yet */
  }
  for (const name of names) {
    try {
      const texts = extractPngText(fs.readFileSync(path.join(OUTPUTS, name)));
      const comment = texts?.get("Comment");
      if (!comment) continue;
      const parsed = JSON.parse(comment) as Record<string, unknown>;
      for (const s of promptStringsFromComment(parsed)) {
        collectTagsFromPrompt(s, counts);
      }
    } catch {
      /* skip an unreadable PNG */
    }
  }
  personalState = { sig, counts };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      PERSONAL_CACHE_FILE,
      JSON.stringify({ sig, counts: Object.fromEntries(counts) }),
    );
  } catch {
    /* cache persistence is best-effort */
  }
  return counts;
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
      const items = fs.readdirSync(OUTPUTS).filter((f) => f.toLowerCase().endsWith(".png"))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(OUTPUTS, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime).slice(0, 30)
        .map((x) => ({ name: x.name, url: "outputs/" + encodeURIComponent(x.name) }));
      sendJson(res, 200, { ok: true, items }); return;
    }
    if (req.method === "GET" && p === "api/subscription") {
      // Same relay pattern as generate: the browser's token arrives as
      // a per-request Authorization header and is used in memory for
      // this one upstream call only — never stored or logged. Only
      // derived fields are returned; the client renders a thin bar
      // from them and never displays the raw numbers.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "APIトークンが未設定です。モーダルの ⚙ 設定から Persistent API Token を保存してください。" }); return; }
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch(SUBSCRIPTION_URL, { signal: ctrl.signal,
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0" } });
      } catch {
        clearTimeout(timer);
        sendJson(res, 502, { ok: false, error: "NovelAI API への接続に失敗しました" }); return;
      }
      clearTimeout(timer);
      if (!resp.ok) {
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: トークンが無効かもしれません。モーダルの ⚙ 設定からトークンを確認・保存し直してください。" }); return; }
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
        const counts = loadPersonalCounts();
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
    if (req.method === "POST" && p === "api/upscale") {
      // Upscale (improvements #39 + #41): relay one outputs/ image to
      // NovelAI's standalone upscaler. Same token pattern as
      // generate: the browser's token arrives per-request and is
      // used in memory for this one upstream call only.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "APIトークンが未設定です。モーダルの ⚙ 設定から Persistent API Token を保存してください。" }); return; }
      const body = JSON.parse((await readBody(req)).toString("utf8")) as { name?: unknown; model?: unknown; blurSigma?: unknown };
      const name = typeof body.name === "string" ? body.name : "";
      // The name must be a file actually present in outputs/ —
      // exact match against the directory listing, so no path
      // traversal is possible.
      const listed = fs.readdirSync(OUTPUTS).filter((f) => f.toLowerCase().endsWith(".png"));
      if (!name || !listed.includes(name)) { sendJson(res, 400, { ok: false, error: "対象の画像が見つかりません" }); return; }
      // Since the V5 launch the standalone upscaler accepts ONLY
      // V5 models (V4.5 and older are rejected upstream), so the
      // model is validated here instead of failing obscurely.
      const UPSCALE_MODELS = new Set(["nai-diffusion-5-full", "nai-diffusion-5-curated"]);
      const model = typeof body.model === "string" ? body.model : "";
      if (!UPSCALE_MODELS.has(model)) { sendJson(res, 400, { ok: false, error: "アップスケールはV5モデル専用です（V4.5以下は非対応）" }); return; }
      // declared_blur_sigma takes only these discrete values
      // (the generation-side rounding set); absent means 0.
      const BLUR_SIGMAS = new Set([0, 0.3, 0.35, 0.4, 0.45, 0.5]);
      const blurSigma = body.blurSigma === undefined ? 0 : Number(body.blurSigma);
      if (!BLUR_SIGMAS.has(blurSigma)) { sendJson(res, 400, { ok: false, error: "ブラーシグマの値が不正です" }); return; }
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
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: トークンが無効かもしれません。モーダルの ⚙ 設定からトークンを確認・保存し直してください。" }); return; }
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
      if (!outPng) { sendJson(res, 502, { ok: false, error: "API応答にPNGが含まれていませんでした" }); return; }
      const base = name.replace(/\.png$/i, "");
      let out = `${base}_up.png`;
      for (let n = 2; fs.existsSync(path.join(OUTPUTS, out)); n++) out = `${base}_up${n}.png`;
      fs.writeFileSync(path.join(OUTPUTS, out), outPng);
      // Same item shape as /api/recent entries.
      sendJson(res, 200, { ok: true, item: { name: out, url: "outputs/" + encodeURIComponent(out) } }); return;
    }
    if (req.method === "POST" && p === "api/generate") {
      // Token arrives per-request from the browser (localStorage) and is
      // used only in memory for this one upstream call. Never persisted.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "APIトークンが未設定です。モーダルの ⚙ 設定から Persistent API Token を保存してください。" }); return; }
      const g = JSON.parse((await readBody(req)).toString("utf8")) as GenInput;
      if (!String(g.prompt || "").trim()) { sendJson(res, 400, { ok: false, error: "プロンプトが空です" }); return; }
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
        try {
          const retry = await callNAI();
          if (retry.ok) { resp = retry; usedSeed = retrySeed; }
          else { await retry.text().catch(() => undefined); }
        } catch { /* fall through to the original error handling */ }
      }
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 500);
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: トークンが無効かもしれません。モーダルの ⚙ 設定からトークンを確認・保存し直してください。" }); return; }
        sendJson(res, 502, { ok: false, error: `NovelAI API ${resp.status}: ${text}` }); return;
      }
      const zip = new Uint8Array(await resp.arrayBuffer());
      const files = unzipSync(zip);
      const pngs: Buffer[] = [];
      for (const [name, data] of Object.entries(files)) {
        if (name.toLowerCase().endsWith(".png")) pngs.push(Buffer.from(data));
      }
      if (!pngs.length) { sendJson(res, 502, { ok: false, error: "API応答にPNGが含まれていませんでした" }); return; }
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

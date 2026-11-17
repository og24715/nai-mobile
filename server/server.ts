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
const SUBSCRIPTION_URL = "https://image.novelai.net/user/subscription";

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
  const seed = (g.seed === "" || g.seed === null || g.seed === undefined)
    ? Math.floor(Math.random() * 4294967295)
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
    seed,
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
      const tsl = data.trainingStepsLeft || {};
      const anlasTotal = (Number(tsl.fixedTrainingStepsLeft) || 0) + (Number(tsl.purchasedTrainingSteps) || 0);
      const usage = data.usage
        ? { percent: Number(data.usage.percent) || 0, isNegative: !!data.usage.isNegative }
        : null;
      sendJson(res, 200, { tier: typeof data.tier === "number" ? data.tier : null, active: !!data.active, anlasTotal, usage }); return;
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
    if (req.method === "POST" && p === "api/generate") {
      // Token arrives per-request from the browser (localStorage) and is
      // used only in memory for this one upstream call. Never persisted.
      const auth = String(req.headers.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token.length < 10) { sendJson(res, 401, { ok: false, error: "APIトークンが未設定です。モーダルの ⚙ 設定から Persistent API Token を保存してください。" }); return; }
      const g = JSON.parse((await readBody(req)).toString("utf8")) as GenInput;
      if (!String(g.prompt || "").trim()) { sendJson(res, 400, { ok: false, error: "プロンプトが空です" }); return; }
      const { payload, seed } = buildPayload(g);
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 180_000);
      let resp: Response;
      try {
        resp = await fetch(API_URL, { method: "POST", signal: ctrl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0" },
          body: JSON.stringify(payload) });
      } finally { clearTimeout(timer); }
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 500);
        if (resp.status === 401) { sendJson(res, 401, { ok: false, error: "NovelAI API 401: トークンが無効かもしれません。モーダルの ⚙ 設定からトークンを確認・保存し直してください。" }); return; }
        sendJson(res, 502, { ok: false, error: `NovelAI API ${resp.status}: ${text}` }); return;
      }
      const zip = new Uint8Array(await resp.arrayBuffer());
      const files = unzipSync(zip);
      const saved: string[] = [];
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      let idx = 0;
      for (const [name, data] of Object.entries(files)) {
        if (!name.toLowerCase().endsWith(".png")) continue;
        const out = `${stamp}_seed${seed}_${idx}.png`; idx++;
        fs.writeFileSync(path.join(OUTPUTS, out), Buffer.from(data));
        saved.push("outputs/" + encodeURIComponent(out));
      }
      if (!saved.length) { sendJson(res, 502, { ok: false, error: "API応答にPNGが含まれていませんでした" }); return; }
      sendJson(res, 200, { ok: true, images: saved, seed }); return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found");
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e as Error)?.message || e) });
  }
});
server.listen(PORT, "0.0.0.0", () => { console.log(`nai-mobile listening on ${PORT}`); });

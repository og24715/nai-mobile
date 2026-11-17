// nai-mobile: phone-friendly front for the NovelAI image API.
// TypeScript / Node built-in http + global fetch. Only dep: fflate (zip).
// Token is stored ONLY on this PC in token.txt (mode 600) and is never
// returned by any endpoint (only { hasToken: boolean }).
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { unzipSync } from "fflate";

const ROOT = path.join(__dirname, "..");
const TOKEN_FILE = path.join(ROOT, "token.txt");
const OUTPUTS = path.join(ROOT, "outputs");
const PORT = 8196;
const API_URL = "https://image.novelai.net/ai/generate-image";

fs.mkdirSync(OUTPUTS, { recursive: true });

function readToken(): string {
  try { return fs.readFileSync(TOKEN_FILE, "utf8").trim(); } catch { return ""; }
}
function hasToken(): boolean { return readToken().length > 10; }

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
    .slice(0, 2)
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
    const centers = [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }];
    parameters.v4_prompt = {
      caption: {
        base_caption: prompt,
        char_captions: chars.map((c, i) => ({
          char_caption: c.prompt,
          centers: [chars.length === 1 ? { x: 0.5, y: 0.5 } : centers[i]],
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
          centers: [chars.length === 1 ? { x: 0.5, y: 0.5 } : centers[i]],
        })),
      },
      legacy_uc: false,
    };
    parameters.characterPrompts = chars.map((c, i) => ({
      prompt: c.prompt,
      uc: c.negative || negative,
      center: chars.length === 1 ? { x: 0.5, y: 0.5 } : centers[i],
      enabled: true,
    }));
  }
  return { payload: { input, model, action: "generate", parameters }, seed, model };
}

const PAGE = String.raw`<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>nai-mobile</title>
<style>
:root{--bg:#0b0b0c;--surface:#141416;--surface2:#1d1d20;--border:#26262b;--text:#f5f5f4;--muted:#a1a1aa;--accent:#e94560;--ok:#34d399;--err:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.7;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:640px;margin:0 auto;padding:56px 20px 96px}h1{font-size:32px;font-weight:700;margin:0 0 12px}h2{font-size:18px;margin:0 0 12px}
.lead{color:var(--muted);margin:0}section{margin-bottom:56px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:28px 24px;margin-top:24px}
label{display:block;font-size:13px;color:var(--muted);margin:18px 0 6px}label:first-child{margin-top:0}
textarea,input,select{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:12px;color:var(--text);padding:12px;font-size:16px}
textarea{min-height:84px;resize:vertical}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
button{background:var(--accent);color:#fff;border:0;border-radius:999px;padding:14px 28px;font-size:16px;min-height:52px;width:100%;margin-top:24px}
button:disabled{opacity:.5}button.sub{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
.status{margin-top:16px;font-size:14px;color:var(--muted);white-space:pre-wrap}.status.err{color:var(--err)}.status.ok{color:var(--ok)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.grid img{width:100%;height:auto;display:block;border-radius:12px}
.hint{font-size:12px;color:var(--muted)}
.toprow{display:flex;justify-content:flex-end;margin-bottom:8px}.settings{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--border);border-radius:999px;padding:6px 14px;background:var(--surface)}
.val{color:var(--text);font-weight:600}input[type=range]{padding:0;accent-color:var(--accent)}
.hero{line-height:0}.hero img{width:100%;height:auto;display:block}
</style></head><body>
<div class="hero" id="heroWrap" hidden><a id="heroLink" href="" target="_blank" rel="noopener"><img id="heroImg" alt=""></a></div>
<main>
<div class="toprow"><a class="settings" href="setup">⚙ 設定</a></div>

<section><div class="card">
<label>プロンプト</label><textarea id="prompt" placeholder="1girl, ..."></textarea>
<label>ネガティブ (UC)</label><textarea id="negative" style="min-height:56px">lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]</textarea>
<div class="row"><div><label>モデル</label><select id="model">
<option value="nai-diffusion-5-full">V5 Full</option>
<option value="nai-diffusion-5-curated">V5 Curated</option>
<option value="nai-diffusion-4-5-full" selected>V4.5 Full</option>
<option value="nai-diffusion-4-5-curated">V4.5 Curated</option>
<option value="nai-diffusion-4-full">V4 Full</option>
<option value="nai-diffusion-4-curated">V4 Curated</option>
<option value="nai-diffusion-3">V3 Anime</option>
</select></div>
<div><label>サイズ</label><select id="size">
<option value="832x1216" selected>832 × 1216（縦）</option>
<option value="1216x832">1216 × 832（横）</option>
<option value="1024x1024">1024 × 1024（正方形）</option>
</select></div></div>
<div class="row"><div><label>Steps <span class="val" id="stepsVal">28</span></label><input type="range" id="steps" value="28" min="1" max="50" step="1"></div>
<div><label>Scale (CFG) <span class="val" id="scaleVal">5.0</span></label><input type="range" id="scale" value="5" step="0.1" min="0" max="20"></div></div>
<div class="row"><div><label>Sampler</label><select id="sampler">
<option value="k_euler_ancestral" selected>Euler Ancestral</option>
<option value="k_euler">Euler</option>
<option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option>
<option value="k_dpmpp_2m">DPM++ 2M</option>
<option value="k_dpmpp_sde">DPM++ SDE</option>
<option value="ddim">DDIM</option>
</select></div>
<div><label>Seed（空=ランダム）</label><input type="number" id="seed" placeholder="random"></div></div>
<label>キャラ1 プロンプト（V4以降）</label><textarea id="char1" style="min-height:48px"></textarea>
<label>キャラ1 ネガティブ</label><input id="char1neg">
<label>キャラ2 プロンプト</label><textarea id="char2" style="min-height:48px"></textarea>
<label>キャラ2 ネガティブ</label><input id="char2neg">
<button id="gen" type="button">生成する</button>
<div class="status" id="status"></div>
<div class="grid" id="result"></div>
</div></section>

<section><h2>最近の生成</h2><div class="grid" id="recent"></div></section>
</main>
<script>
const $=id=>document.getElementById(id);
const fields=['prompt','negative','model','size','steps','scale','sampler','seed','char1','char1neg','char2','char2neg'];
for(const f of fields){const v=localStorage.getItem('nai.'+f);if(v!==null&&$(f).tagName!=='SELECT'||v!==null&&$(f).value===''){} if(v!==null)$(f).value=v; $(f).addEventListener('change',()=>localStorage.setItem('nai.'+f,$(f).value));}
function syncVal(id,vid,fmt){const el=$(id),s=$(vid);const f=()=>{s.textContent=fmt(Number(el.value));};el.addEventListener('input',f);el.addEventListener('input',()=>localStorage.setItem('nai.'+id,el.value));f();}
syncVal('steps','stepsVal',v=>String(Math.round(v)));
syncVal('scale','scaleVal',v=>v.toFixed(1));
async function checkToken(){try{const r=await fetch('api/status');const j=await r.json();if(!j.hasToken){location.replace('setup');}}catch(e){}}
function setHero(url){if(!url){$('heroWrap').hidden=true;return;}$('heroImg').src=url;$('heroLink').href=url;$('heroWrap').hidden=false;}
async function recent(){try{const r=await fetch('api/recent');const j=await r.json();$('recent').innerHTML='';setHero(j.items&&j.items.length?j.items[0].url:'');for(const it of j.items){const a=document.createElement('a');a.href=it.url;const im=document.createElement('img');im.src=it.url;im.loading='lazy';a.appendChild(im);a.addEventListener('click',e=>{e.preventDefault();setHero(it.url);window.scrollTo({top:0,behavior:'smooth'});});$('recent').appendChild(a);}}catch(e){}}
$('gen').onclick=async()=>{const st=$('status');st.className='status';st.textContent='生成中…（数十秒かかることがあります）';$('gen').disabled=true;
const [w,h]=$('size').value.split('x').map(Number);
const body={prompt:$('prompt').value,negative:$('negative').value,model:$('model').value,width:w,height:h,steps:Number($('steps').value),scale:Number($('scale').value),sampler:$('sampler').value,seed:$('seed').value===''?null:Number($('seed').value),characters:[{prompt:$('char1').value,negative:$('char1neg').value},{prompt:$('char2').value,negative:$('char2neg').value}]};
try{const r=await fetch('api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();
if(!j.ok){st.className='status err';st.textContent='エラー: '+(j.error||r.status);}
else{st.className='status ok';st.textContent='完了 seed='+j.seed;$('seed').value=j.seed;localStorage.setItem('nai.seed',j.seed);$('result').innerHTML='';for(const u of j.images){const a=document.createElement('a');a.href=u;a.target='_blank';const im=document.createElement('img');im.src=u;a.appendChild(im);$('result').appendChild(a);}if(j.images&&j.images.length)setHero(j.images[0]);recent();}
}catch(e){st.className='status err';st.textContent='通信エラー: '+e;}
$('gen').disabled=false;};
checkToken();recent();
</script></body></html>`;

const SETUP_PAGE = String.raw`<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>nai-mobile 設定</title>
<style>
:root{--bg:#0b0b0c;--surface:#141416;--surface2:#1d1d20;--border:#26262b;--text:#f5f5f4;--muted:#a1a1aa;--accent:#e94560;--ok:#34d399;--err:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.7;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:640px;margin:0 auto;padding:56px 20px 96px}h1{font-size:32px;font-weight:700;margin:0 0 12px}h2{font-size:18px;margin:0 0 12px}
.lead{color:var(--muted);margin:0}section{margin-bottom:56px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:28px 24px;margin-top:24px}
label{display:block;font-size:13px;color:var(--muted);margin:18px 0 6px}label:first-child{margin-top:0}
textarea,input,select{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:12px;color:var(--text);padding:12px;font-size:16px}
button{background:var(--accent);color:#fff;border:0;border-radius:999px;padding:14px 28px;font-size:16px;min-height:52px;width:100%;margin-top:24px}
button.sub{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
.hint{font-size:12px;color:var(--muted)}
.settings{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--border);border-radius:999px;padding:6px 14px;background:var(--surface)}
</style></head><body><main>
<header><h1>トークン設定</h1><p class="lead">NovelAI の Persistent API Token をこのPCに保存します</p></header>

<section><div class="card">
<h2>APIトークン</h2>
<p class="hint" id="tokenState">確認中…</p>
<label>Persistent API Token（このPCにだけ保存されます）</label>
<input type="password" id="token" autocomplete="off" placeholder="pst-...">
<button class="sub" id="saveToken" type="button">トークンを保存</button>
<p class="hint">取得: novelai.net → Account Settings → Get Persistent API Token。チャットには送らないでください。</p>
<p style="margin-top:24px"><a class="settings" href="./">← 生成画面へ戻る</a></p>
</div></section>
</main>
<script>
const $=id=>document.getElementById(id);
async function status(){try{const r=await fetch('api/status');const j=await r.json();$('tokenState').textContent=j.hasToken?'保存済みトークン: あり（差し替える場合は新しいトークンを保存）':'保存済みトークン: なし';}catch(e){}}
$('saveToken').onclick=async()=>{const t=$('token').value.trim();if(!t){alert('トークンが空です');return;}try{const r=await fetch('api/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})});const j=await r.json();if(j.ok){location.replace('./');}else alert(j.error||'保存失敗');}catch(e){alert('通信エラー: '+e);}};
status();
</script></body></html>`;

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
    if (req.method === "GET" && (p === "" || p === "index.html")) {
      const body = Buffer.from(PAGE);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length });
      res.end(body); return;
    }
    if (req.method === "GET" && p === "setup") {
      const body = Buffer.from(SETUP_PAGE);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length });
      res.end(body); return;
    }
    if (req.method === "GET" && p === "api/status") { sendJson(res, 200, { ok: true, hasToken: hasToken(), port: PORT }); return; }
    if (req.method === "POST" && p === "api/token") {
      const j = JSON.parse((await readBody(req)).toString("utf8")) as { token?: string };
      const t = String(j.token || "").trim();
      if (t.length < 10) { sendJson(res, 400, { ok: false, error: "トークンが短すぎます" }); return; }
      fs.writeFileSync(TOKEN_FILE, t + "\n", { mode: 0o600 });
      try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
      sendJson(res, 200, { ok: true, hasToken: true }); return;
    }
    if (req.method === "GET" && p === "api/recent") {
      const items = fs.readdirSync(OUTPUTS).filter((f) => f.toLowerCase().endsWith(".png"))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(OUTPUTS, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime).slice(0, 30)
        .map((x) => ({ name: x.name, url: "outputs/" + encodeURIComponent(x.name) }));
      sendJson(res, 200, { ok: true, items }); return;
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
      const token = readToken();
      if (!token) { sendJson(res, 401, { ok: false, error: "APIトークンが未設定です。設定ページ（右上の ⚙）から Persistent API Token を保存してください。" }); return; }
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

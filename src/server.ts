// nai-mobile: phone-friendly front for the NovelAI image API.
// TypeScript / Node built-in http + global fetch. Only dep: fflate (zip).
// The NovelAI token is stored ONLY in the user's browser (localStorage,
// key "nai.token") and is sent per generate request as an Authorization
// header. The server keeps nothing: it uses the token in memory for that
// single request and never writes it to disk or logs it.
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { unzipSync } from "fflate";

const ROOT = path.join(__dirname, "..");
const OUTPUTS = path.join(ROOT, "outputs");
const PORT = 8196;
const API_URL = "https://image.novelai.net/ai/generate-image";

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

const PAGE = String.raw`<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>nai-mobile</title>
<style>
:root{--bg:#0b0b0c;--surface:#141416;--surface2:#1d1d20;--border:#26262b;--text:#f5f5f4;--muted:#a1a1aa;--accent:#e94560;--ok:#34d399;--err:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.7;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 20px 128px}h1{font-size:32px;font-weight:700;margin:0 0 12px}h2{font-size:18px;margin:0 0 12px}
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
.settings{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--border);border-radius:999px;padding:6px 14px;background:var(--surface)}
.fabrow{position:fixed;right:20px;bottom:20px;display:flex;gap:12px;z-index:40}
.fab{width:60px;height:60px;min-height:60px;border-radius:50%;padding:0;margin:0;font-size:24px;line-height:1;box-shadow:0 6px 20px rgba(0,0,0,.5)}
.fab.edit{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
.modal{display:none;position:fixed;inset:0;margin:0;background:var(--bg);overflow-y:auto;z-index:50}
.modal.open{display:block}
.modal-inner{max-width:640px;margin:0 auto;padding:20px 20px 64px}
.modalhead{display:flex;justify-content:space-between;align-items:center}
.modalhead h2{margin:0}
.closebtn{width:44px;height:44px;min-height:44px;border-radius:50%;padding:0;margin:0;font-size:22px;line-height:1;background:var(--surface2);color:var(--text);border:1px solid var(--border)}
.modalfoot{margin-top:32px}
.val{color:var(--text);font-weight:600}input[type=range]{padding:0;accent-color:var(--accent)}
.hero{line-height:0}.hero img{width:100%;height:auto;display:block}
.charblock{border:1px solid var(--border);border-radius:12px;padding:16px;margin-top:16px}
.charhead{display:flex;justify-content:space-between;align-items:center}
.charhead span{font-size:13px;color:var(--muted)}
.charhead+label{margin-top:8px}
.delbtn{width:36px;height:36px;min-height:36px;border-radius:50%;padding:0;margin:0;font-size:16px;line-height:1;background:var(--surface2);color:var(--text);border:1px solid var(--border)}
</style></head><body>
<div class="hero" id="heroWrap" hidden><a id="heroLink" href="" target="_blank" rel="noopener"><img id="heroImg" alt=""></a></div>
<main>
<div class="status" id="status"></div>
<section><h2>最近の生成</h2><div class="grid" id="recent"></div></section>
</main>
<div class="fabrow"><button class="fab" id="genFab" type="button" aria-label="生成する">▶</button><button class="fab edit" id="fab" type="button" aria-label="生成フォームを開く">✎</button></div>
<div class="modal" id="modal"><div class="modal-inner">
<div class="modalhead"><h2>生成</h2><button class="closebtn" id="modalClose" type="button" aria-label="閉じる">×</button></div>
<div class="card">
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
<div><label>Steps <span class="val" id="stepsVal">28</span></label><input type="range" id="steps" value="28" min="1" max="50" step="1"></div>
<div><label>Scale (CFG) <span class="val" id="scaleVal">5.0</span></label><input type="range" id="scale" value="5" step="0.1" min="0" max="20"></div>
<div class="row"><div><label>Sampler</label><select id="sampler">
<option value="k_euler_ancestral" selected>Euler Ancestral</option>
<option value="k_euler">Euler</option>
<option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option>
<option value="k_dpmpp_2m">DPM++ 2M</option>
<option value="k_dpmpp_sde">DPM++ SDE</option>
<option value="ddim">DDIM</option>
</select></div>
<div><label>Seed（空=ランダム）</label><input type="number" id="seed" placeholder="random"></div></div>
<label>キャラクタープロンプト（V4以降）</label>
<div id="charList"></div>
<button class="sub" id="addChar" type="button">＋ キャラ追加</button>
</div>
<p class="modalfoot"><a class="settings" href="setup">⚙ 設定</a></p>
</div></div>
<script>
const $=id=>document.getElementById(id);
const fields=['prompt','negative','model','size','steps','scale','sampler','seed'];
for(const f of fields){const v=localStorage.getItem('nai.'+f);if(v!==null&&$(f).tagName!=='SELECT'||v!==null&&$(f).value===''){} if(v!==null)$(f).value=v; $(f).addEventListener('change',()=>localStorage.setItem('nai.'+f,$(f).value));}
function syncVal(id,vid,fmt){const el=$(id),s=$(vid);const f=()=>{s.textContent=fmt(Number(el.value));};el.addEventListener('input',f);el.addEventListener('input',()=>localStorage.setItem('nai.'+id,el.value));f();}
syncVal('steps','stepsVal',v=>String(Math.round(v)));
syncVal('scale','scaleVal',v=>v.toFixed(1));
const MAXCHARS=6;let chars=[];
function saveChars(){localStorage.setItem('nai.chars',JSON.stringify(chars));}
function renderChars(){
const wrap=$('charList');wrap.innerHTML='';
chars.forEach((c,i)=>{
const d=document.createElement('div');d.className='charblock';
const head=document.createElement('div');head.className='charhead';
const t=document.createElement('span');t.textContent='キャラ'+(i+1);
const del=document.createElement('button');del.type='button';del.className='delbtn';del.textContent='×';del.setAttribute('aria-label','キャラ'+(i+1)+'を削除');
del.onclick=()=>{chars.splice(i,1);saveChars();renderChars();};
head.appendChild(t);head.appendChild(del);d.appendChild(head);
const lp=document.createElement('label');lp.textContent='プロンプト';d.appendChild(lp);
const tp=document.createElement('textarea');tp.style.minHeight='48px';tp.value=c.prompt;
tp.addEventListener('input',()=>{chars[i].prompt=tp.value;saveChars();});
d.appendChild(tp);
const ln=document.createElement('label');ln.textContent='ネガティブ';d.appendChild(ln);
const tn=document.createElement('input');tn.value=c.negative;
tn.addEventListener('input',()=>{chars[i].negative=tn.value;saveChars();});
d.appendChild(tn);
wrap.appendChild(d);
});
$('addChar').style.display=chars.length>=MAXCHARS?'none':'';
}
function initChars(){
try{const v=localStorage.getItem('nai.chars');if(v){const a=JSON.parse(v);if(Array.isArray(a)){chars=a.filter(c=>c&&typeof c==='object').slice(0,MAXCHARS).map(c=>({prompt:String(c.prompt||''),negative:String(c.negative||'')}));renderChars();return;}}}catch(e){}
const old=[['char1','char1neg'],['char2','char2neg']].map(pair=>({prompt:localStorage.getItem('nai.'+pair[0])||'',negative:localStorage.getItem('nai.'+pair[1])||''}));
chars=old.some(c=>c.prompt||c.negative)?old:[{prompt:'',negative:''}];
saveChars();renderChars();
}
$('addChar').onclick=()=>{if(chars.length<MAXCHARS){chars.push({prompt:'',negative:''});saveChars();renderChars();}};
initChars();
function checkToken(){if(!localStorage.getItem('nai.token')){location.replace('setup');}}
function setHero(url){if(!url){$('heroWrap').hidden=true;return;}$('heroImg').src=url;$('heroLink').href=url;$('heroWrap').hidden=false;}
async function recent(){try{const r=await fetch('api/recent');const j=await r.json();$('recent').innerHTML='';setHero(j.items&&j.items.length?j.items[0].url:'');for(const it of j.items){const a=document.createElement('a');a.href=it.url;const im=document.createElement('img');im.src=it.url;im.loading='lazy';a.appendChild(im);a.addEventListener('click',e=>{e.preventDefault();setHero(it.url);window.scrollTo({top:0,behavior:'smooth'});});$('recent').appendChild(a);}}catch(e){}}
let modalHist=false;
function showModal(){$('modal').classList.add('open');document.body.style.overflow='hidden';}
function hideModal(){$('modal').classList.remove('open');document.body.style.overflow='';}
function openModal(){if($('modal').classList.contains('open'))return;showModal();if(!modalHist){modalHist=true;history.pushState({naiModal:true},'');}}
function closeModal(){if(!$('modal').classList.contains('open'))return;if(modalHist){history.back();}else{hideModal();}}
window.addEventListener('popstate',()=>{if(modalHist){modalHist=false;hideModal();}});
if(history.state&&history.state.naiModal){history.replaceState(null,'');}
$('fab').onclick=openModal;
$('modalClose').onclick=closeModal;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
$('genFab').onclick=async()=>{const token=localStorage.getItem('nai.token');if(!token){location.replace('setup');return;}closeModal();window.scrollTo(0,0);const st=$('status');st.className='status';st.textContent='生成中…（数十秒かかることがあります）';$('genFab').disabled=true;
const [w,h]=$('size').value.split('x').map(Number);
const body={prompt:$('prompt').value,negative:$('negative').value,model:$('model').value,width:w,height:h,steps:Number($('steps').value),scale:Number($('scale').value),sampler:$('sampler').value,seed:$('seed').value===''?null:Number($('seed').value),characters:chars.map(c=>({prompt:c.prompt,negative:c.negative}))};
try{const r=await fetch('api/generate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});const j=await r.json();
if(!j.ok){st.className='status err';st.textContent='エラー: '+(j.error||r.status);}
else{st.className='status ok';st.textContent='完了 seed='+j.seed;$('seed').value=j.seed;localStorage.setItem('nai.seed',j.seed);if(j.images&&j.images.length)setHero(j.images[0]);recent();}
}catch(e){st.className='status err';st.textContent='通信エラー: '+e;}
$('genFab').disabled=false;};
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
<header><h1>トークン設定</h1><p class="lead">NovelAI の Persistent API Token をこのブラウザに保存します</p></header>

<section><div class="card">
<h2>APIトークン</h2>
<p class="hint" id="tokenState">確認中…</p>
<label>Persistent API Token（このブラウザの localStorage にだけ保存されます）</label>
<input type="password" id="token" autocomplete="off" placeholder="pst-...">
<button class="sub" id="saveToken" type="button">トークンを保存</button>
<button class="sub" id="clearToken" type="button">トークンを削除</button>
<p class="hint">サーバーには一切保存されません。生成のたびにこのブラウザから送信され、サーバーは中継にだけ使います。</p>
<p class="hint">保存はブラウザ／URL（オリジン）ごとです。別のブラウザや別の URL から使うときは再入力が必要で、ブラウザのデータを消すと再入力が必要になります。</p>
<p class="hint">取得: novelai.net → Account Settings → Get Persistent API Token。チャットには送らないでください。</p>
<p style="margin-top:24px"><a class="settings" href="./">← 生成画面へ戻る</a></p>
</div></section>
</main>
<script>
const $=id=>document.getElementById(id);
function status(){const has=!!localStorage.getItem('nai.token');$('tokenState').textContent=has?'保存済みトークン: あり（差し替える場合は新しいトークンを保存）':'保存済みトークン: なし';}
$('saveToken').onclick=()=>{const t=$('token').value.trim();if(!t){alert('トークンが空です');return;}localStorage.setItem('nai.token',t);location.replace('./');};
$('clearToken').onclick=()=>{localStorage.removeItem('nai.token');$('token').value='';status();};
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
    if (req.method === "GET" && p === "api/status") { sendJson(res, 200, { ok: true, port: PORT }); return; }
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

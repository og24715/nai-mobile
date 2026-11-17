// Client-side PNG metadata reader for "restore settings from a
// device image" (improvement #23). NovelAI generations embed a tEXt
// "Comment" chunk (the full generation parameters as JSON) and a
// tEXt "Source" chunk (e.g. "NovelAI Diffusion V5 0ADF9AB7"). The
// picked file never leaves the device: it is read with
// File.arrayBuffer() and the chunks are walked locally. No upload,
// no new dependencies.
import { MODELS, SAMPLERS, SIZES } from "@/lib/options";
import { splitWeightedSections } from "@/lib/promptTags";
import type { CharPrompt } from "@/hooks/useCharacters";

export interface NaiImageSettings {
  params: Record<string, unknown>;
  source: string | null;
}

// Walk PNG chunks and collect tEXt / iTXt keyword -> text pairs.
// Returns null when the buffer is not a PNG at all.
export function extractPngText(
  buf: Uint8Array,
): Map<string, string> | null {
  if (
    buf.length < 8 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 || // P
    buf[2] !== 0x4e || // N
    buf[3] !== 0x47 // G
  ) {
    return null;
  }
  const out = new Map<string, string>();
  const latin = new TextDecoder("latin1");
  const utf8 = new TextDecoder("utf-8");
  let i = 8;
  while (i + 8 <= buf.length) {
    const len =
      ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>>
      0;
    const type = latin.decode(buf.subarray(i + 4, i + 8));
    const dataStart = i + 8;
    if (dataStart + len > buf.length) break;
    const data = buf.subarray(dataStart, dataStart + len);
    if (type === "tEXt") {
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = latin.decode(data.subarray(0, nul));
        if (!out.has(key)) out.set(key, utf8.decode(data.subarray(nul + 1)));
      }
    } else if (type === "iTXt") {
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = latin.decode(data.subarray(0, nul));
        const compFlag = data[nul + 1];
        // keyword \0 compFlag compMethod language \0 translated \0 text
        let p = nul + 3;
        while (p < data.length && data[p] !== 0) p++;
        p++;
        while (p < data.length && data[p] !== 0) p++;
        p++;
        if (compFlag === 0 && p <= data.length && !out.has(key)) {
          out.set(key, utf8.decode(data.subarray(p)));
        }
      }
    }
    if (type === "IEND") break;
    i = dataStart + len + 4; // skip data + CRC
  }
  return out;
}

export async function readNaiSettings(
  file: File,
): Promise<NaiImageSettings | null> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const texts = extractPngText(buf);
  if (!texts) return null;
  const comment = texts.get("Comment");
  if (!comment) return null;
  try {
    const params = JSON.parse(comment) as unknown;
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return null;
    }
    return {
      params: params as Record<string, unknown>,
      source: texts.get("Source") ?? null,
    };
  } catch {
    return null;
  }
}

// --- Mapping the Comment JSON onto form values -------------------------

export interface RestoredForm {
  prompt?: string;
  negative?: string;
  steps?: string;
  scale?: string;
  seed?: string;
  sampler?: string;
  size?: string;
  model?: string;
  chars?: CharPrompt[];
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const numStr = (v: unknown): string | undefined =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;

// The Source string / model_name carry the model version ("NovelAI
// Diffusion V5", "... V4.5", ...) but not Full vs Curated. Map the
// version confidently; keep the currently selected model's variant
// when it is already in that version family, else default to Full.
function mapModel(
  settings: NaiImageSettings,
  currentModel: string,
): string | undefined {
  const hay = [settings.source ?? "", str(settings.params.model_name) ?? ""]
    .join(" ")
    .toLowerCase();
  let prefix: string | null = null;
  if (/v\s?4[.,]5/.test(hay)) prefix = "nai-diffusion-4-5";
  else if (/v\s?5/.test(hay)) prefix = "nai-diffusion-5";
  else if (/v\s?4/.test(hay)) prefix = "nai-diffusion-4";
  else if (/v\s?3/.test(hay)) return "nai-diffusion-3";
  if (!prefix) return undefined;
  if (currentModel.startsWith(prefix)) return currentModel;
  const full = `${prefix}-full`;
  return MODELS.some((m) => m.value === full) ? full : undefined;
}

interface CaptionLike {
  char_caption?: unknown;
  centers?: unknown;
}
interface CaptionBlock {
  caption?: { base_caption?: unknown; char_captions?: CaptionLike[] };
}

function mapChars(params: Record<string, unknown>): CharPrompt[] | undefined {
  const v4p = params.v4_prompt as CaptionBlock | undefined;
  const v4n = params.v4_negative_prompt as CaptionBlock | undefined;
  const caps = v4p?.caption?.char_captions;
  if (Array.isArray(caps)) {
    const ncaps = v4n?.caption?.char_captions;
    return caps.slice(0, 6).map((c, i) => ({
      prompt: splitWeightedSections(str(c?.char_caption) ?? ""),
      negative: splitWeightedSections(
        (Array.isArray(ncaps) ? str(ncaps[i]?.char_caption) : undefined) ??
          "",
      ),
    }));
  }
  const legacy = params.characterPrompts;
  if (Array.isArray(legacy)) {
    return legacy.slice(0, 6).map((c) => {
      const o = (c ?? {}) as { prompt?: unknown; uc?: unknown };
      return {
        prompt: splitWeightedSections(str(o.prompt) ?? ""),
        negative: splitWeightedSections(str(o.uc) ?? ""),
      };
    });
  }
  return undefined;
}

export function mapSettingsToForm(
  settings: NaiImageSettings,
  currentModel: string,
): RestoredForm {
  const p = settings.params;
  const out: RestoredForm = {};
  // Restored prompts are normalized (improvement #27): multi-tag
  // weighted sections are split into one section per tag. This runs
  // only on this restore path, never on typed/stored prompts.
  const prompt = str(p.prompt);
  if (prompt !== undefined) out.prompt = splitWeightedSections(prompt);
  const negative = str(p.uc);
  if (negative !== undefined) out.negative = splitWeightedSections(negative);
  const steps = numStr(p.steps);
  if (steps !== undefined) out.steps = steps;
  const scale = numStr(p.scale);
  if (scale !== undefined) out.scale = scale;
  // Restoring intentionally writes the image's seed into the seed
  // field (unlike a fresh generation, whose used seed is never
  // written back — improvement #9).
  const seed = numStr(p.seed);
  if (seed !== undefined) out.seed = seed;
  const sampler = str(p.sampler);
  if (sampler && SAMPLERS.some((s) => s.value === sampler)) {
    out.sampler = sampler;
  }
  if (typeof p.width === "number" && typeof p.height === "number") {
    const size = `${p.width}x${p.height}`;
    if (SIZES.some((s) => s.value === size)) out.size = size;
  }
  const model = mapModel(settings, currentModel);
  if (model !== undefined) out.model = model;
  const chars = mapChars(p);
  if (chars !== undefined) out.chars = chars;
  return out;
}

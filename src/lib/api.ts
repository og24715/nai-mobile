// API calls. All paths are relative so the app works both at
// http://host:8196/ and under the home-index gateway prefix (/nai/).
export interface RecentItem {
  name: string;
  url: string;
  // Favorites-store state (improvement #61).
  favorite: boolean;
}

export interface GenerateRequest {
  prompt: string;
  negative: string;
  model: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: string;
  seed: number | null;
  characters: { prompt: string; negative: string }[];
  // img2img (improvement #43): present only when a base image is
  // attached in the form. image is PNG base64 (no data: prefix),
  // already cover-cropped/resized by the client to the selected
  // generation size; strength / noise are 0..1.
  image?: string;
  strength?: number;
  noise?: number;
  // Vibe Transfer (improvement #44): present only when the model
  // supports it and at least one vibe has been encoded. encoded
  // is the string returned by /api/encode-vibe.
  vibes?: {
    encoded: string;
    strength: number;
    informationExtracted: number;
  }[];
  // Precise Reference (improvement #45): present only when the
  // model supports it (V4.5 family) and at least one entry
  // exists. image is PNG base64 downscaled client-side to a
  // 1024px long side; the server expands the entries into the
  // five director_reference_* arrays.
  references?: {
    image: string;
    type: string;
    strength: number;
    fidelity: number;
  }[];
}

export interface GenerateResponse {
  ok: boolean;
  images?: string[];
  // Null when the seed could not be recovered from the generated PNG
  // (the seed itself is chosen by NovelAI when the field is empty).
  seed?: number | null;
  error?: string;
}

export interface SubscriptionUsage {
  percent: number;
  isNegative: boolean;
}

export interface TrainingStepsLeft {
  fixedTrainingStepsLeft: number;
  purchasedTrainingSteps: number;
}

export interface SubscriptionInfo {
  tier: number | null;
  active: boolean;
  anlasTotal: number | null;
  trainingStepsLeft: TrainingStepsLeft | null;
  usage: SubscriptionUsage | null;
}

export interface AnlasAllowance {
  balance: number;
  denominator: number;
  percent: number;
}

// Monthly Subscription Anlas allotment for the Anlas bar's
// full-scale denominator: Opus (tier 3) refills to 10,000;
// Tablet / Scroll (tiers 1 / 2) refill to 1,000. Unknown tiers
// fall back to the Opus figure.
export function monthlyAnlasAllotment(tier: number | null): number {
  if (tier === 1 || tier === 2) return 1000;
  return 10000;
}

// The Anlas allowance behind the second bar (improvement #37):
// balance is subscription Anlas + purchased Anlas. Null when the
// subscription response carried no trainingStepsLeft at all, so
// the bar can hide instead of showing a misleading empty state.
export function anlasAllowanceFromSubscription(
  info: SubscriptionInfo,
): AnlasAllowance | null {
  const tsl = info.trainingStepsLeft;
  if (!tsl) return null;
  const balance = tsl.fixedTrainingStepsLeft + tsl.purchasedTrainingSteps;
  const denominator = monthlyAnlasAllotment(info.tier);
  const percent =
    denominator > 0
      ? Math.min(100, Math.max(0, (balance / denominator) * 100))
      : 0;
  return { balance, denominator, percent };
}

// Returns null on any failure (no token, upstream error, offline) —
// the caller renders nothing in that case.
export async function fetchSubscription(
  token: string,
): Promise<SubscriptionInfo | null> {
  try {
    const r = await fetch("api/subscription", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const trainingStepsLeft = j.trainingStepsLeft
      ? {
          fixedTrainingStepsLeft:
            Number(j.trainingStepsLeft.fixedTrainingStepsLeft) || 0,
          purchasedTrainingSteps:
            Number(j.trainingStepsLeft.purchasedTrainingSteps) || 0,
        }
      : null;
    return {
      tier: typeof j.tier === "number" ? j.tier : null,
      active: !!j.active,
      anlasTotal: trainingStepsLeft
        ? trainingStepsLeft.fixedTrainingStepsLeft +
          trainingStepsLeft.purchasedTrainingSteps
        : null,
      trainingStepsLeft,
      usage: j.usage
        ? {
            percent: Number(j.usage.percent) || 0,
            isNegative: !!j.usage.isNegative,
          }
        : null,
    };
  } catch {
    return null;
  }
}

export interface TagSuggestion {
  name: string;
  count: number | null;
  confidence: number | null;
  // How often the user has used this tag in past generations (0 =
  // not a personal tag).
  mine: number;
}

// Tag suggestions from the server (official NovelAI suggestions
// merged with the user's personal tags). Returns [] on any failure —
// the suggestion strip simply doesn't appear.
export async function fetchTagSuggestions(
  token: string,
  q: string,
  model: string,
  signal?: AbortSignal,
): Promise<TagSuggestion[]> {
  try {
    const r = await fetch(
      `api/tags?q=${encodeURIComponent(q)}&model=${encodeURIComponent(model)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal },
    );
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.items) ? (j.items as TagSuggestion[]) : [];
  } catch {
    return [];
  }
}

export interface RecentList {
  items: RecentItem[];
  // Whole-outputs/ totals (the items list itself is capped at
  // 30): what the Delete-Others confirmation counts from.
  total: number;
  favoriteCount: number;
}

export async function fetchRecent(): Promise<RecentList> {
  const r = await fetch("api/recent");
  const j = await r.json();
  const items = Array.isArray(j.items) ? (j.items as RecentItem[]) : [];
  return {
    items,
    total: typeof j.total === "number" ? j.total : items.length,
    favoriteCount:
      typeof j.favoriteCount === "number"
        ? j.favoriteCount
        : items.filter((i) => i.favorite).length,
  };
}

export interface FavoriteResponse {
  ok: boolean;
  // The image's new state, in the same shape as /api/recent items.
  item?: RecentItem;
  error?: string;
}

// Set or clear one outputs/ image's favorite flag (improvement
// #61). Only the file's name is sent; the server validates it
// against the outputs/ listing and updates its store.
export async function requestFavorite(
  token: string,
  name: string,
  favorite: boolean,
): Promise<{ status: number; json: FavoriteResponse }> {
  const r = await fetch("api/favorite", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ name, favorite }),
  });
  return { status: r.status, json: (await r.json()) as FavoriteResponse };
}

export interface DeleteOthersResponse {
  ok: boolean;
  deleted?: number;
  error?: string;
}

// Bulk-delete every outputs/ image that is NOT a favorite
// (improvement #61). Returns how many files were deleted.
export async function requestDeleteOthers(
  token: string,
): Promise<{ status: number; json: DeleteOthersResponse }> {
  const r = await fetch("api/delete-others", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({}),
  });
  return { status: r.status, json: (await r.json()) as DeleteOthersResponse };
}

export async function requestGenerate(
  token: string,
  body: GenerateRequest,
): Promise<{ status: number; json: GenerateResponse }> {
  const r = await fetch("api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as GenerateResponse };
}

export interface EncodeVibeResponse {
  ok: boolean;
  vibe?: string;
  error?: string;
}

// Encode one reference image for Vibe Transfer (improvement #44)
// via the server's relay to NovelAI's /ai/encode-vibe. The
// upstream answers with a binary blob; the server returns it
// base64-encoded, which is the form generation expects in
// reference_image_multiple.
export async function requestEncodeVibe(
    token: string,
  image: string,
  model: string,
  informationExtracted: number,
): Promise<{ status: number; json: EncodeVibeResponse }> {
  const r = await fetch("api/encode-vibe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ image, model, informationExtracted }),
  });
  return { status: r.status, json: (await r.json()) as EncodeVibeResponse };
}

export interface UpscaleResponse {
  ok: boolean;
  // The saved upscaled image, in the same shape as /api/recent
  // items, so the client can select it as the hero directly.
  item?: RecentItem;
  error?: string;
}

// Upscale one outputs/ image via the server's relay to NovelAI's
// standalone upscaler (improvements #39 + #41). The file stays on
// the PC — only its name is sent; the server reads it from
// outputs/. The upscaler is V5-only and takes a declared_blur_sigma
// from a small discrete set, chosen in the upscale dialog.
export async function requestUpscale(
  token: string,
  name: string,
  model: string,
  blurSigma: number,
): Promise<{ status: number; json: UpscaleResponse }> {
  const r = await fetch("api/upscale", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ name, model, blurSigma }),
  });
  return { status: r.status, json: (await r.json()) as UpscaleResponse };
}

export interface EnhanceResponse {
  ok: boolean;
  // The saved enhanced image, in the same shape as /api/recent
  // items, so the client can select it as the hero directly.
  item?: RecentItem;
  error?: string;
}

// Enhance one outputs/ image (improvement #42): the server
// rebuilds an img2img request from the image's own stored
// generation parameters; the client only picks the output scale
// (2 / 1.5 / 1 / "max") and the strength / noise.
export async function requestEnhance(
  token: string,
  name: string,
  scale: number | "max",
  strength: number,
  noise: number,
): Promise<{ status: number; json: EnhanceResponse }> {
  const r = await fetch("api/enhance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ name, scale, strength, noise }),
  });
  return { status: r.status, json: (await r.json()) as EnhanceResponse };
}

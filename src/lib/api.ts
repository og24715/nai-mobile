// API calls. All paths are relative so the app works both at
// http://host:8196/ and under the home-index gateway prefix (/nai/).
export interface RecentItem {
  name: string;
  url: string;
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

export async function fetchRecent(): Promise<RecentItem[]> {
  const r = await fetch("api/recent");
  const j = await r.json();
  return Array.isArray(j.items) ? (j.items as RecentItem[]) : [];
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

export interface UpscaleResponse {
  ok: boolean;
  // The saved upscaled image, in the same shape as /api/recent
  // items, so the client can select it as the hero directly.
  item?: RecentItem;
  error?: string;
}

// Upscale one outputs/ image via the server's relay to NovelAI's
// standalone upscaler (improvement #39). The file stays on the PC —
// only its name is sent; the server reads it from outputs/.
export async function requestUpscale(
  token: string,
  name: string,
  model: string,
): Promise<{ status: number; json: UpscaleResponse }> {
  const r = await fetch("api/upscale", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ name, model }),
  });
  return { status: r.status, json: (await r.json()) as UpscaleResponse };
}

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
  seed?: number;
  error?: string;
}

export interface SubscriptionUsage {
  percent: number;
  isNegative: boolean;
}

export interface SubscriptionInfo {
  tier: number | null;
  active: boolean;
  anlasTotal: number;
  usage: SubscriptionUsage | null;
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
    return {
      tier: typeof j.tier === "number" ? j.tier : null,
      active: !!j.active,
      anlasTotal: Number(j.anlasTotal) || 0,
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

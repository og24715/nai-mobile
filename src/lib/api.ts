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

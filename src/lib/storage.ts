// localStorage access helpers.
//
// The keys are part of the app's contract with the user's phone and must
// not change: "nai.token" holds the NovelAI token (browser only, the
// server never sees it except as a per-request Authorization header),
// "nai.<field>" holds each form field, "nai.chars" the character list.
export const TOKEN_KEY = "nai.token";
export const CHARS_KEY = "nai.chars";

export const fieldKey = (name: string) => "nai." + name;

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the field just won't persist */
  }
}

export function removeStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

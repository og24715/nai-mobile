import { useState } from "react";
import { CHARS_KEY, fieldKey, readStored, writeStored } from "@/lib/storage";

export interface CharPrompt {
  prompt: string;
  negative: string;
}

export const MAX_CHARS = 6;

function initChars(): CharPrompt[] {
  try {
    const v = readStored(CHARS_KEY);
    if (v) {
      const a = JSON.parse(v);
      if (Array.isArray(a)) {
        return a
          .filter((c) => c && typeof c === "object")
          .slice(0, MAX_CHARS)
          .map((c) => ({
            prompt: String(c.prompt || ""),
            negative: String(c.negative || ""),
          }));
      }
    }
  } catch {
    /* fall through to the legacy migration */
  }
  // Migration from the fixed two-character keys used before the
  // dynamic character list (improvement #6).
  const old = [
    ["char1", "char1neg"],
    ["char2", "char2neg"],
  ].map(([p, n]) => ({
    prompt: readStored(fieldKey(p)) || "",
    negative: readStored(fieldKey(n)) || "",
  }));
  const chars = old.some((c) => c.prompt || c.negative)
    ? old
    : [{ prompt: "", negative: "" }];
  writeStored(CHARS_KEY, JSON.stringify(chars));
  return chars;
}

// Character prompt list persisted as JSON under "nai.chars".
export function useCharacters() {
  const [chars, setChars] = useState<CharPrompt[]>(initChars);
  const update = (next: CharPrompt[]) => {
    writeStored(CHARS_KEY, JSON.stringify(next));
    setChars(next);
  };
  return [chars, update] as const;
}

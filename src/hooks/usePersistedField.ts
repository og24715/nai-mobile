import { useCallback, useState } from "react";
import { fieldKey, readStored, writeStored } from "@/lib/storage";

// A form field persisted to localStorage under "nai.<name>": initialized
// from storage (falling back to `initial`) and re-saved on every change,
// matching the pre-React behavior (save on both "input" and "change").
export function usePersistedField(name: string, initial: string) {
  const [value, setValue] = useState<string>(
    () => readStored(fieldKey(name)) ?? initial,
  );
  const set = useCallback(
    (v: string) => {
      writeStored(fieldKey(name), v);
      setValue(v);
    },
    [name],
  );
  return [value, set] as const;
}

// Per-model feature availability for the reference-image
// features, mirroring the CURRENT official NovelAI client:
//   - Vibe Transfer: V4 and V4.5 families
//   - Precise Reference (Director Reference): V4.5 family only
//   - both OFF for V5 and V3
// V5 support is rumored to be coming upstream; when it lands,
// flip the flags HERE (and in the mirror in server/server.ts) —
// this table is the single place to change.
export interface ModelCaps {
  vibeTransfer: boolean;
  preciseReference: boolean;
}

export function modelCaps(model: string): ModelCaps {
  const v45 = model.startsWith("nai-diffusion-4-5");
  const v4 = v45 || model.startsWith("nai-diffusion-4");
  return {
    vibeTransfer: v4,
    preciseReference: v45,
  };
}

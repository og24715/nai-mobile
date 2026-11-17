// Select options and defaults, mirroring the pre-React UI.
export const DEFAULT_NEGATIVE =
  "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]";

export const MODELS = [
  { value: "nai-diffusion-5-full", label: "V5 Full" },
  { value: "nai-diffusion-5-curated", label: "V5 Curated" },
  { value: "nai-diffusion-4-5-full", label: "V4.5 Full" },
  { value: "nai-diffusion-4-5-curated", label: "V4.5 Curated" },
  { value: "nai-diffusion-4-full", label: "V4 Full" },
  { value: "nai-diffusion-4-curated", label: "V4 Curated" },
  { value: "nai-diffusion-3", label: "V3 Anime" },
];

export const SIZES = [
  { value: "832x1216", label: "832 × 1216 (Portrait)" },
  { value: "1216x832", label: "1216 × 832 (Landscape)" },
  { value: "1024x1024", label: "1024 × 1024 (Square)" },
];

export const SAMPLERS = [
  { value: "k_euler_ancestral", label: "Euler Ancestral" },
  { value: "k_euler", label: "Euler" },
  { value: "k_dpmpp_2s_ancestral", label: "DPM++ 2S Ancestral" },
  { value: "k_dpmpp_2m", label: "DPM++ 2M" },
  { value: "k_dpmpp_sde", label: "DPM++ SDE" },
  { value: "ddim", label: "DDIM" },
];

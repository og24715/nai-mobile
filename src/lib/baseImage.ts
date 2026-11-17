// Read a device file as a PNG base64 (no data: prefix),
// downscaled so the long side is at most maxSide px, aspect
// preserved, never upscaled. The client-side preprocessing for
// Precise Reference images (improvement #45).
export async function fileToDownscaledPngBase64(
  file: File,
  maxSide: number,
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("image load failed"));
      im.src = url;
    });
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * s));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Read a device file as base64 without the data: prefix (the
// shape NovelAI's image parameters take). Used for Vibe Transfer
// encoding (improvement #44), where the file is sent as-is.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.replace(/^data:[^,]*,/, ""));
    };
    r.onerror = () => reject(new Error("file read failed"));
    r.readAsDataURL(file);
  });
}

// Base-image preparation for img2img (improvement #43): draw a
// device-picked image onto a canvas at the selected generation
// size using cover-fit (scale to fill, center-crop the overflow)
// and export it as PNG base64 without the data: prefix — the
// exact shape the NovelAI img2img `image` parameter takes.
export async function fileToCoverPngBase64(
  file: File,
  tw: number,
  th: number,
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("image load failed"));
      im.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    const s = Math.max(tw / img.naturalWidth, th / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  } finally {
    URL.revokeObjectURL(url);
  }
}

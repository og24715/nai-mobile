// PNG metadata stripping (improvements #62 + #64): NovelAI PNGs
// carry the full generation parameters in text chunks (the
// "Comment" JSON with prompt / seed / settings, and the
// "Source" marker) — and, as #64 addresses below, the same
// payload is also hidden in the alpha channel.
// To share an image without leaking those, the chunk stream is
// filtered client-side: every text chunk (tEXt, zTXt, iTXt) is
// dropped and all other chunks are kept byte-for-byte, so the
// kept chunks' CRCs stay valid and the image data is untouched.

const TEXT_CHUNK_TYPES = new Set(["tEXt", "zTXt", "iTXt"]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Returns the cleaned PNG bytes, or null when the input is not a
// well-formed PNG (the caller then falls back to the original
// bytes unchanged).
export function stripPngTextChunks(
  data: Uint8Array,
): Uint8Array<ArrayBuffer> | null {
  if (data.length < 8) return null;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) return null;
  }
  const parts: Uint8Array[] = [data.subarray(0, 8)];
  let offset = 8;
  let sawIend = false;
  while (offset + 8 <= data.length) {
    const length =
      ((data[offset] << 24) |
        (data[offset + 1] << 16) |
        (data[offset + 2] << 8) |
        data[offset + 3]) >>>
      0;
    const type = String.fromCharCode(
      data[offset + 4],
      data[offset + 5],
      data[offset + 6],
      data[offset + 7],
    );
    const chunkEnd = offset + 12 + length; // length + type + data + CRC
    if (chunkEnd > data.length) return null; // truncated chunk
    if (!TEXT_CHUNK_TYPES.has(type)) {
      parts.push(data.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend) return null;
  // Any trailing bytes after IEND are kept as-is.
  if (offset < data.length) parts.push(data.subarray(offset));
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// Improvement #64: the text chunks are not the only hiding place.
// NovelAI also embeds the same metadata in the alpha channel's
// least significant bits — the official inspect tool reads it
// back even from a chunk-stripped file. NAI outputs are fully
// opaque, so the payload lives in alpha values wobbling between
// 254 and 255; decoding the image, forcing every alpha byte to
// 255, and re-exporting as PNG destroys it while leaving the RGB
// data untouched. The canvas export contains no text chunks
// either, so this also covers the #62 stripping. Returns the
// re-encoded PNG blob, or null when decode / export fails (the
// caller then falls back to the chunk-stripped bytes above).
export async function flattenAlphaPng(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      for (let i = 3; i < pixels.length; i += 4) {
        pixels[i] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

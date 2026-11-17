// PNG metadata stripping (improvement #62): NovelAI PNGs carry
// the full generation parameters in text chunks (the "Comment"
// JSON with prompt / seed / settings, and the "Source" marker).
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

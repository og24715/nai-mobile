// PNG metadata stripping (improvements #62 + #64 + #67): NovelAI PNGs
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

// Improvement #64 (the fallback since #67): the text chunks are
// not the only hiding place.
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

// Improvement #67: the canvas re-encode above compresses far
// worse than NovelAI's own encoder (a 3 MB original came back
// as 5 MB cleaned), so the alpha wipe is now done surgically at
// the IDAT level whenever the PNG has the expected shape (8-bit
// RGBA, non-interlaced): the IDAT stream is inflated, each
// scanline is unfiltered, its alpha bytes are forced to 255, and
// the row is re-filtered with the SAME filter type the original
// encoder chose — so the rebuilt stream compresses about as
// well as the original, and the cleaned file ends up at roughly
// the original size minus the dropped text chunks. The RGB
// bytes are never touched. Returns the rebuilt PNG bytes, or
// null when the PNG does not have the expected shape or the
// stream APIs fail (the caller then falls back to the canvas
// flatten above, then to plain chunk stripping).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the chunk type bytes plus the data.
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function inflateZlib(
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const buf = await new Response(
      new Blob([new Uint8Array(data)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function deflateZlib(
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const buf = await new Response(
      new Blob([new Uint8Array(data)])
        .stream()
        .pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// The predictor PNG filtering uses at byte i of a row: the byte
// bpp positions earlier in the same row (left), the byte at the
// same position in the previous row (up), and the one before
// that (up-left); missing neighbours count as 0.
function filterPredictor(
  type: number,
  row: Uint8Array,
  prev: Uint8Array | null,
  i: number,
  bpp: number,
): number {
  const left = i >= bpp ? row[i - bpp] : 0;
  const up = prev ? prev[i] : 0;
  const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
  switch (type) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    default:
      return paethPredictor(left, up, upLeft);
  }
}

function unfilterRow(
  type: number,
  filtered: Uint8Array,
  prev: Uint8Array | null,
  bpp: number,
): Uint8Array {
  const out = new Uint8Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    out[i] = (filtered[i] + filterPredictor(type, out, prev, i, bpp)) & 0xff;
  }
  return out;
}

function filterRow(
  type: number,
  raw: Uint8Array,
  prev: Uint8Array | null,
  bpp: number,
): Uint8Array {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = (raw[i] - filterPredictor(type, raw, prev, i, bpp)) & 0xff;
  }
  return out;
}

interface PngChunk {
  type: string;
  start: number; // offset of the length field
  end: number; // offset just past the CRC
  dataStart: number;
  dataLength: number;
}

export async function flattenAlphaPngSurgical(
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    if (data.length < 8) return null;
    for (let i = 0; i < 8; i++) {
      if (data[i] !== PNG_SIGNATURE[i]) return null;
    }
    const chunks: PngChunk[] = [];
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
      const end = offset + 12 + length;
      if (end > data.length) return null; // truncated chunk
      chunks.push({
        type,
        start: offset,
        end,
        dataStart: offset + 8,
        dataLength: length,
      });
      offset = end;
      if (type === "IEND") {
        sawIend = true;
        break;
      }
    }
    if (!sawIend) return null;
    // Any trailing bytes after IEND are kept as-is.
    const trailing = data.subarray(offset);

    const ihdr = chunks.find((c) => c.type === "IHDR");
    if (!ihdr || ihdr.dataLength !== 13) return null;
    const ih = data.subarray(ihdr.dataStart, ihdr.dataStart + 13);
    const width =
      ((ih[0] << 24) | (ih[1] << 16) | (ih[2] << 8) | ih[3]) >>> 0;
    const height =
      ((ih[4] << 24) | (ih[5] << 16) | (ih[6] << 8) | ih[7]) >>> 0;
    const bitDepth = ih[8];
    const colorType = ih[9];
    const interlace = ih[12];
    // Only the shape the scanline walk below understands:
    // 8-bit RGBA (4 bytes per pixel), no interlacing.
    if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return null;
    if (width === 0 || height === 0) return null;

    const idatParts = chunks
      .filter((c) => c.type === "IDAT")
      .map((c) => data.subarray(c.dataStart, c.dataStart + c.dataLength));
    if (idatParts.length === 0) return null;
    const idat = new Uint8Array(
      idatParts.reduce((n, part) => n + part.length, 0),
    );
    {
      let at = 0;
      for (const part of idatParts) {
        idat.set(part, at);
        at += part.length;
      }
    }
    const raw = await inflateZlib(idat);
    if (!raw) return null;

    const bpp = 4;
    const rowBytes = width * bpp;
    const stride = rowBytes + 1;
    if (raw.length !== stride * height) return null;
    const rebuilt = new Uint8Array(raw.length);
    let origPrev: Uint8Array | null = null;
    let modPrev: Uint8Array | null = null;
    for (let y = 0; y < height; y++) {
      const rowStart = y * stride;
      const type = raw[rowStart];
      if (type > 4) return null;
      const filtered = raw.subarray(rowStart + 1, rowStart + stride);
      // Unfilter against the ORIGINAL previous row (that is
      // what the encoder predicted from), flatten the alpha,
      // then re-filter with the same filter type against the
      // MODIFIED previous row (that is what a decoder will
      // predict from when it reconstructs this row).
      const recon = unfilterRow(type, filtered, origPrev, bpp);
      const mod = new Uint8Array(recon);
      for (let i = 3; i < rowBytes; i += bpp) mod[i] = 255;
      const refiltered = filterRow(type, mod, modPrev, bpp);
      rebuilt[rowStart] = type;
      rebuilt.set(refiltered, rowStart + 1);
      origPrev = recon;
      modPrev = mod;
    }

    const deflated = await deflateZlib(rebuilt);
    if (!deflated) return null;

    // Rebuild the file from the original chunk sequence: every
    // non-text chunk is copied byte-for-byte (CRCs stay valid),
    // and the original IDAT run is replaced at its position by
    // the new stream, split into 64 KiB IDAT chunks.
    const parts: Uint8Array[] = [data.subarray(0, 8)];
    let idatWritten = false;
    for (const chunk of chunks) {
      if (TEXT_CHUNK_TYPES.has(chunk.type)) continue;
      if (chunk.type === "IDAT") {
        if (!idatWritten) {
          idatWritten = true;
          for (let at = 0; at < deflated.length; at += 65536) {
            parts.push(makeChunk("IDAT", deflated.subarray(at, at + 65536)));
          }
        }
        continue;
      }
      parts.push(data.subarray(chunk.start, chunk.end));
    }
    if (!idatWritten) return null;
    if (trailing.length > 0) parts.push(trailing);
    const total = parts.reduce((n, part) => n + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  } catch {
    return null;
  }
}

// Parser / serializer for NovelAI prompt strings, built for the tag
// chip editor (improvement #21). Splits a prompt into segments:
//
//   - plain tags (comma-separated, outside any weighted section)
//   - weighted sections: `n:: tagA, tagB ::` — the number directly
//     before `::` opens the section and a bare `::` closes it; commas
//     inside do NOT split it, so several tags can share one weight.
//     Negative weights (`-n:: tag ::`) are sections with weight < 0.
//   - raw chunks: anything containing { } [ ] (the legacy ×1.05 /
//     ÷1.05 cumulative operators) or an unbalanced / unparseable `::`
//     construction. Raw chunks are preserved verbatim; the editor
//     can replace a raw chunk's text as-is (#28) but gives it no
//     weight / prefix controls.
//
// Serialization joins segment bodies with ",". Unedited segments keep
// their exact original body text, so parse -> serialize reproduces the
// input for typical prompts; only segments the user actually edited
// are rewritten in canonical form.

export type Segment =
  | { kind: "tag"; text: string; body: string; dirty?: boolean }
  | { kind: "weighted"; weight: number; tags: string[]; body: string; dirty?: boolean }
  | { kind: "raw"; body: string };

// A weight as written by users: "1.5", "2", "0.55", ".5", "-3", ...
const WEIGHT_SRC = "-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const SECTION_RE = new RegExp(`^(${WEIGHT_SRC})::([\\s\\S]*)::$`);
const BRACE_RE = /[{}[\]]/;
const PREFIX_RE = /^(source|target|mutual)#/;

// Split into top-level chunks on commas, treating `n:: ... ::` spans
// as atomic (commas inside a section do not split). Chunk bodies keep
// their exact source text (including surrounding spaces).
function splitChunks(input: string): string[] {
  const chunks: string[] = [];
  const opener = new RegExp(WEIGHT_SRC + "::", "y");
  let chunkStart = 0;
  let i = 0;
  while (i < input.length) {
    if (input[i] === ",") {
      chunks.push(input.slice(chunkStart, i));
      i++;
      chunkStart = i;
      continue;
    }
    opener.lastIndex = i;
    const m = opener.exec(input);
    if (m) {
      const closer = input.indexOf("::", i + m[0].length);
      if (closer === -1) break; // unbalanced: the rest is plain text
      i = closer + 2;
      continue;
    }
    i++;
  }
  chunks.push(input.slice(chunkStart));
  return chunks;
}

export function parsePrompt(input: string): Segment[] {
  if (!input) return [];
  return splitChunks(input).map((body): Segment => {
    const t = body.trim();
    if (!t) return { kind: "raw", body };
    const sm = t.match(SECTION_RE);
    if (sm) {
      const tags = sm[2].split(",").map((s) => s.trim());
      // A section is only editable when every inner tag is a plain
      // tag; anything fancier (braces, a stray "::") stays raw.
      if (tags.every((x) => x && !BRACE_RE.test(x) && !x.includes("::"))) {
        return { kind: "weighted", weight: parseFloat(sm[1]), tags, body };
      }
      return { kind: "raw", body };
    }
    if (t.includes("::") || BRACE_RE.test(t)) return { kind: "raw", body };
    return { kind: "tag", text: t, body };
  });
}

export function fmtWeight(w: number): string {
  const r = Math.round(w * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
}

function coreOf(seg: Segment): string {
  switch (seg.kind) {
    case "tag":
      return seg.text;
    case "weighted":
      return `${fmtWeight(seg.weight)}::${seg.tags.join(", ")}::`;
    case "raw":
      return seg.body;
  }
}

export function serializePrompt(segs: Segment[]): string {
  return segs
    .map((s, idx) => {
      if (s.kind !== "raw" && s.dirty) {
        return (idx === 0 ? "" : " ") + coreOf(s);
      }
      return s.body;
    })
    .join(",");
}

// --- Chips ------------------------------------------------------------

export interface Chip {
  seg: number;
  tag: number; // index inside a weighted section; 0 for tag/raw chips
  text: string;
  weight: number | null; // null = plain tag (effective weight 1)
  raw: boolean;
}

export function listChips(segs: Segment[]): Chip[] {
  const out: Chip[] = [];
  segs.forEach((s, i) => {
    if (s.kind === "tag") {
      out.push({ seg: i, tag: 0, text: s.text, weight: null, raw: false });
    } else if (s.kind === "weighted") {
      s.tags.forEach((t, j) =>
        out.push({ seg: i, tag: j, text: t, weight: s.weight, raw: false }),
      );
    } else if (s.body.trim()) {
      out.push({ seg: i, tag: 0, text: s.body.trim(), weight: null, raw: true });
    }
  });
  return out;
}

// --- Edits --------------------------------------------------------------

export interface EditResult {
  segs: Segment[];
  select?: { seg: number; tag: number };
}

const clampWeight = (w: number) =>
  Math.max(-10, Math.min(10, Math.round(w * 10) / 10));

// Set one chip's weight. Plain tag -> its own weighted section (or no
// change at exactly 1). Single-tag section -> weight updated in place
// (unwraps to a plain tag at exactly 1). Multi-tag section -> the
// edited tag SPLITS OUT into its own section with the new weight; the
// rest of the section keeps the old weight.
export function setChipWeight(
  segs: Segment[],
  segIdx: number,
  tagIdx: number,
  weight: number,
): EditResult {
  const seg = segs[segIdx];
  if (!seg || seg.kind === "raw") return { segs };
  const w = clampWeight(weight);
  const next = segs.slice();
  if (seg.kind === "tag") {
    if (w === 1) return { segs };
    next[segIdx] = { kind: "weighted", weight: w, tags: [seg.text], body: "", dirty: true };
    return { segs: next, select: { seg: segIdx, tag: 0 } };
  }
  if (w === seg.weight) return { segs };
  if (seg.tags.length === 1) {
    next[segIdx] =
      w === 1
        ? { kind: "tag", text: seg.tags[0], body: "", dirty: true }
        : { ...seg, weight: w, body: "", dirty: true };
    return { segs: next, select: { seg: segIdx, tag: 0 } };
  }
  const tagText = seg.tags[tagIdx];
  const rest = seg.tags.filter((_, j) => j !== tagIdx);
  const remaining: Segment = {
    kind: "weighted",
    weight: seg.weight,
    tags: rest,
    body: "",
    dirty: true,
  };
  const split: Segment =
    w === 1
      ? { kind: "tag", text: tagText, body: "", dirty: true }
      : { kind: "weighted", weight: w, tags: [tagText], body: "", dirty: true };
  next.splice(segIdx, 1, remaining, split);
  return { segs: next, select: { seg: segIdx + 1, tag: 0 } };
}

// Replace one chip's text (improvement #28 — this is what replaced
// free-text editing). Plain tag / single-tag section -> the text is
// rewritten in place, keeping the weight and any source#-style
// prefix. A tag inside a multi-tag section SPLITS OUT into its own
// section carrying the edited text (same rule as weight edits). A
// raw chunk's body is replaced verbatim at the same position. Empty
// text deletes the chip (no `select` in the result, so the caller
// closes the editor bar).
export function setChipText(
  segs: Segment[],
  segIdx: number,
  tagIdx: number,
  newText: string,
): EditResult {
  const seg = segs[segIdx];
  if (!seg) return { segs };
  const text = newText.trim();
  if (!text) return { segs: deleteChip(segs, segIdx, tagIdx) };
  const next = segs.slice();
  if (seg.kind === "raw") {
    // Raw bodies are emitted verbatim by the serializer; rebuild the
    // body in canonical join form (a leading space except at index 0,
    // matching how edited non-raw segments are joined).
    next[segIdx] = { kind: "raw", body: (segIdx === 0 ? "" : " ") + text };
    return { segs: next, select: { seg: segIdx, tag: 0 } };
  }
  if (seg.kind === "tag") {
    next[segIdx] = { ...seg, text, body: "", dirty: true };
    return { segs: next, select: { seg: segIdx, tag: 0 } };
  }
  if (seg.tags.length === 1) {
    next[segIdx] = { ...seg, tags: [text], body: "", dirty: true };
    return { segs: next, select: { seg: segIdx, tag: 0 } };
  }
  const rest = seg.tags.filter((_, j) => j !== tagIdx);
  const remaining: Segment = {
    kind: "weighted",
    weight: seg.weight,
    tags: rest,
    body: "",
    dirty: true,
  };
  const split: Segment = {
    kind: "weighted",
    weight: seg.weight,
    tags: [text],
    body: "",
    dirty: true,
  };
  next.splice(segIdx, 1, remaining, split);
  return { segs: next, select: { seg: segIdx + 1, tag: 0 } };
}

export function deleteChip(
  segs: Segment[],
  segIdx: number,
  tagIdx: number,
): Segment[] {
  const seg = segs[segIdx];
  if (!seg) return segs;
  const next = segs.slice();
  if (seg.kind === "weighted" && seg.tags.length > 1) {
    const tags = seg.tags.filter((_, j) => j !== tagIdx);
    next[segIdx] = { ...seg, tags, body: "", dirty: true };
  } else {
    next.splice(segIdx, 1);
    // If the first segment went away, the new first segment's stored
    // body still carries its old separator leading space; rebuild it
    // canonically so the prompt doesn't start with a stray space.
    if (segIdx === 0 && next[0] && next[0].kind !== "raw") {
      next[0] = { ...next[0], body: "", dirty: true };
    }
  }
  return next;
}

// --- Character-prompt # prefixes (source# / target# / mutual#) ---------

export function splitPrefix(text: string): {
  prefix: string | null;
  rest: string;
} {
  const m = text.match(PREFIX_RE);
  return m
    ? { prefix: m[1], rest: text.slice(m[0].length) }
    : { prefix: null, rest: text };
}

export function setChipPrefix(
  segs: Segment[],
  segIdx: number,
  tagIdx: number,
  prefix: string | null,
): Segment[] {
  const seg = segs[segIdx];
  if (!seg || seg.kind === "raw") return segs;
  const apply = (text: string) => {
    const { rest } = splitPrefix(text);
    return prefix ? `${prefix}#${rest}` : rest;
  };
  const next = segs.slice();
  if (seg.kind === "tag") {
    next[segIdx] = { ...seg, text: apply(seg.text), body: "", dirty: true };
  } else {
    const tags = seg.tags.slice();
    tags[tagIdx] = apply(tags[tagIdx]);
    next[segIdx] = { ...seg, tags, body: "", dirty: true };
  }
  return next;
}

// --- Current-token detection (tag suggestions, #22) ---------------------

export interface TokenInfo {
  // Index where the tag text being typed starts (after the separating
  // comma / section opener / # prefix).
  start: number;
  cursor: number;
  query: string;
  // A leading source#/target#/mutual# prefix, preserved on completion.
  prefix: string;
}

// Find the tag token at the cursor: text since the last comma, where
// commas and `::` boundaries inside weighted sections are respected —
// completing inside an open `n::` section yields just the tag text.
export function findToken(value: string, cursor: number): TokenInfo {
  const upto = Math.max(0, Math.min(cursor, value.length));
  const opener = new RegExp(WEIGHT_SRC + "::", "y");
  let boundary = 0;
  let i = 0;
  while (i < upto) {
    if (value[i] === ",") {
      boundary = i + 1;
      i++;
      continue;
    }
    opener.lastIndex = i;
    const m = opener.exec(value);
    if (m) {
      const closer = value.indexOf("::", i + m[0].length);
      if (closer === -1 || closer + 2 > upto) {
        // The cursor is inside this section: the token starts after
        // the opener or after the last comma inside the section,
        // whichever is later.
        boundary = i + m[0].length;
        for (let j = boundary; j < upto; j++) {
          if (value[j] === ",") boundary = j + 1;
        }
        i = upto;
        break;
      }
      boundary = closer + 2;
      i = closer + 2;
      continue;
    }
    i++;
  }
  let start = boundary;
  while (start < upto && value[start] === " ") start++;
  let prefix = "";
  const pm = value.slice(start, upto).match(PREFIX_RE);
  if (pm) {
    prefix = pm[0];
    start += pm[0].length;
  }
  return { start, cursor: upto, query: value.slice(start, upto), prefix };
}

// --- Import-time normalization (improvements #27 + #29) -----------------

// Rewrite weighted emphasis as one canonical section per tag:
// `0.8:: a, b ::` -> `0.8:: a ::, 0.8:: b ::`.
//
// #27 handled sections that close inside a single comma chunk, but
// real-world prompts (artist mixes) mostly use a CHAINED style with
// few or no closers:
//
//   .5:: a, .7:: b .9:: c, 0.55::, d, 0.8:: , e, f, ::, g
//
// so #29 reads the input as a stream instead: a weight opener
// (`n::`) sets the current weight for everything after it until the
// next opener or a bare `::` closer (which resets to 1); reaching
// the end with a weight still open just ends the run. An opener with
// an empty run still passes its weight on — `0.55::, d` weights `d`
// at 0.55 (user-confirmed). Markers may appear mid-chunk
// (`b .9:: c` splits into two tags at different weights), and a tag
// name directly followed by a closer (`conto::`) is a tag at the
// current weight, after which the weight resets.
//
// Tags are the pieces between commas and/or markers; each piece is
// trimmed and empty pieces are dropped. Output joins the pieces with
// ", " (stray newlines / extra whitespace flatten into the join),
// emitting weight-1 pieces as plain tags and the rest as canonical
// `w:: tag ::` sections. Weights render at their exact parsed value
// (String(parseFloat)) rather than fmtWeight's 0.1 rounding, so a
// deliberate 0.55 / 0.45 is not silently rewritten to 0.6 / 0.5.
//
// Safety gates — the input is returned completely unchanged when:
//   - it contains any `{` / `}` / `[` / `]` anywhere (legacy brackets
//     are cumulative rightward operators that interact with section
//     boundaries, so stream rewriting is not semantics-safe), or
//   - a bare `::` is glued to following text (`a::b`): that reads as
//     literal tag content, not a delimiter, or
//   - it contains no weight opener at all.
// The rewrite is idempotent: running it on its own output is a no-op.
//
// Used ONLY at import time: restoring settings from an image (#23)
// and paste import (#28). Typing, localStorage loads and generation
// payloads never pass through here.
export function splitWeightedSections(text: string): string {
  if (!text) return text;
  if (BRACE_RE.test(text)) return text;
  const opener = new RegExp(`(${WEIGHT_SRC})::`, "y");
  const pieces: { tag: string; weight: number }[] = [];
  let weight = 1;
  let sawOpener = false;
  let buf = "";
  const flush = () => {
    const tag = buf.trim();
    buf = "";
    if (tag) pieces.push({ tag, weight });
  };
  let i = 0;
  while (i < text.length) {
    opener.lastIndex = i;
    const m = opener.exec(text);
    if (m) {
      flush();
      weight = parseFloat(m[1]);
      sawOpener = true;
      i += m[0].length;
      continue;
    }
    if (text.startsWith("::", i)) {
      const after = text[i + 2];
      if (after !== undefined && after !== "," && !/\s/.test(after)) {
        return text; // `a::b` — literal colons inside a tag, bail out
      }
      flush();
      weight = 1;
      i += 2;
      continue;
    }
    if (text[i] === ",") {
      flush();
      i++;
      continue;
    }
    buf += text[i];
    i++;
  }
  flush();
  if (!sawOpener) return text;
  const fmtStreamWeight = (w: number) =>
    Object.is(w, -0) ? "0" : String(w);
  return pieces
    .map((p) =>
      p.weight === 1 ? p.tag : `${fmtStreamWeight(p.weight)}:: ${p.tag} ::`,
    )
    .join(", ");
}

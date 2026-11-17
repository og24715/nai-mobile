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

// --- Restore-time normalization (improvement #27) -----------------------

// Split multi-tag weighted sections into one canonical section per
// tag: `0.8:: a, b ::` -> `0.8:: a ::, 0.8:: b ::`. Works at the
// chunk level (same splitChunks / SECTION_RE grammar as the parser):
// parsePrompt deliberately classifies a section whose inner list has
// empty entries as raw, while restored prompts carry exactly those
// (`0.8::, a, b, ::`), so they are handled here instead.
//
// Rules: empty inner entries are dropped; a section left with no
// tags disappears entirely; a section is only rewritten when ALL its
// remaining inner tags are plain — any `{` / `}` / `[` / `]` or stray
// `::` inside leaves the whole section byte-for-byte untouched
// (legacy brackets are cumulative rightward operators, so splitting
// them could change semantics). Plain tags and raw chunks keep their
// exact original text. Used ONLY when restoring settings from an
// image (#23); typing, localStorage loads and generation payloads
// never pass through here.
export function splitWeightedSections(text: string): string {
  if (!text) return text;
  const chunks = splitChunks(text);
  const pieces: string[] = [];
  let changed = false;
  let firstFrom = -1; // chunk index that produced pieces[0]
  chunks.forEach((body, ci) => {
    const sm = body.trim().match(SECTION_RE);
    if (sm) {
      const tags = sm[2]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      if (tags.every((x) => !BRACE_RE.test(x) && !x.includes("::"))) {
        changed = true;
        if (tags.length === 0) return; // drop the empty section
        const lead = body.slice(0, body.length - body.trimStart().length);
        const w = fmtWeight(parseFloat(sm[1]));
        tags.forEach((tag, i) => {
          if (firstFrom === -1) firstFrom = ci;
          pieces.push((i === 0 ? lead : " ") + `${w}:: ${tag} ::`);
        });
        return;
      }
    }
    if (firstFrom === -1) firstFrom = ci;
    pieces.push(body);
  });
  if (!changed) return text;
  // When the original first chunk was dropped, the surviving first
  // piece still carries the separator space that followed the comma.
  if (firstFrom > 0 && pieces.length > 0) {
    pieces[0] = pieces[0].replace(/^\s+/, "");
  }
  return pieces.join(",");
}

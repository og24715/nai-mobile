import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import {
  deleteChip,
  fmtWeight,
  listChips,
  parsePrompt,
  serializePrompt,
  setChipPrefix,
  setChipText,
  setChipWeight,
  splitPrefix,
  splitWeightedSections,
} from "@/lib/promptTags";
import { fetchTagSuggestions, type TagSuggestion } from "@/lib/api";
import { TOKEN_KEY, readStored } from "@/lib/storage";

export interface ChipSel {
  seg: number;
  tag: number;
}

// Snapshot of the currently selected chip, reported up to GenerateForm,
// which renders ONE shared editor bar stuck to the bottom of the form
// drawer (improvement #26). The action callbacks are stable wrappers
// that call through to the owning field's latest closures (kept in a
// ref), so a snapshot never goes stale even though it is only
// re-reported when its display fields change.
export interface ChipEditorState {
  fieldId: string;
  text: string;
  weight: number; // effective weight (1 for a plain tag)
  raw: boolean;
  character: boolean;
  prefix: string | null;
  onWeight: (w: number) => void;
  onText: (t: string) => void;
  onDelete: () => void;
  onPrefix: (p: string | null) => void;
  onClose: () => void;
}

interface Props {
  // Unique per field instance ("prompt", "char-0-negative", ...). Used
  // to route the lifted chip selection / editor bar to the right field.
  fieldId: string;
  value: string;
  onChange: (v: string) => void;
  // Character prompt fields get the source#/target#/mutual# selector.
  character?: boolean;
  // Tag suggestions (improvement #22): needs the selected model for
  // the official suggest-tags relay.
  suggest?: boolean;
  model?: string;
  // Lifted chip selection (improvement #26): the selection targeting
  // this field, or null. GenerateForm owns the state so the editor bar
  // can live outside the field, stuck to the drawer's bottom edge.
  chipSelection: ChipSel | null;
  onChipSelect: (fieldId: string, sel: ChipSel | null) => void;
  onChipEditor: (fieldId: string, ed: ChipEditorState | null) => void;
}

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// A prompt field edited ONLY through its tag chips (improvements #21,
// #26, #28): the chips plus an inline "add tag" input with the
// suggestion strip (#22) are the whole editing UI — there is no
// free-text textarea anymore. A chip's own text is edited in the
// shared editor bar (see ChipEditorBar / setChipText), and bulk text
// enters through the 貼り付け dialog (normalized by
// splitWeightedSections, like image restore) or leaves through the
// コピー button. The field's string value remains the single source
// of truth: chips are derived from it on every render, and every edit
// rewrites it through the same setter, so persistence and generation
// payloads are untouched.
export function TagField({
  fieldId,
  value,
  onChange,
  character,
  suggest,
  model,
  chipSelection,
  onChipSelect,
  onChipEditor,
}: Props) {
  const segs = useMemo(() => parsePrompt(value), [value]);
  const chips = useMemo(() => listChips(segs), [segs]);
  const sel = chipSelection;
  const selChip = sel
    ? chips.find((c) => c.seg === sel.seg && c.tag === sel.tag)
    : undefined;
  const effWeight = selChip ? (selChip.weight ?? 1) : 1;
  const selPrefix = selChip ? splitPrefix(selChip.text).prefix : null;

  // --- Suggestions (add-tag input only) --------------------------------
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const addRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef("");

  const runQuery = (q: string) => {
    if (!suggest) return;
    queryRef.current = q;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2 || /[:{}[\]]/.test(q)) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      void fetchTagSuggestions(
        readStored(TOKEN_KEY) ?? "",
        q,
        model ?? "",
        ctrl.signal,
      ).then((list) => {
        // Drop stale responses: only show results for the token the
        // user is still typing.
        if (queryRef.current === q) {
          setSuggestions(list.slice(0, 8));
        }
      });
    }, 250);
  };

  // --- Add-tag input ----------------------------------------------------
  const [addText, setAddText] = useState("");

  const scheduleAddSuggest = (text: string) => {
    if (!suggest) return;
    // A leading source#/target#/mutual# prefix is not part of the tag
    // being searched; it is re-attached when a suggestion is picked.
    runQuery(splitPrefix(text).rest);
  };

  // Append a tag to the end of the value: empty value -> just the tag;
  // value ending in a comma -> tag after ", "; otherwise insert ", ".
  const appendTag = (rawTag: string) => {
    const tag = rawTag.trim();
    if (!tag) return;
    const base = value.replace(/\s+$/, "");
    let next: string;
    if (!base) next = tag;
    else if (base.endsWith(",")) next = base + " " + tag;
    else next = base + ", " + tag;
    onChange(next);
  };

  const commitAdd = () => {
    if (!addText.trim()) return;
    appendTag(addText);
    setAddText("");
    setSuggestions([]);
    queryRef.current = "";
  };

  const applySuggestion = (s: TagSuggestion) => {
    const { prefix } = splitPrefix(addText);
    appendTag(prefix ? `${prefix}#${s.name}` : s.name);
    setAddText("");
    setSuggestions([]);
    queryRef.current = "";
    // Keep focus in the add input for consecutive additions.
    requestAnimationFrame(() => addRef.current?.focus());
  };

  const strip = suggestions.length > 0 && (
    <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
      {suggestions.map((s) => (
        <button
          key={s.name}
          type="button"
          onClick={() => applySuggestion(s)}
          className="inline-flex min-h-tap shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-suggest whitespace-nowrap"
        >
          <span>{s.name}</span>
          {s.mine > 0 ? (
            <span className="text-xs font-medium text-primary">よく使う</span>
          ) : s.count !== null ? (
            <span className="text-tag-badge text-muted-foreground">
              {fmtCount(s.count)}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );

  // --- Paste import / copy ----------------------------------------------
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyPaste = (mode: "replace" | "append") => {
    // Imported text goes through the same section-splitting
    // normalization as image restore (#27), so pasted prompts land
    // as clean per-tag chips.
    const frag = splitWeightedSections(pasteText.trim());
    if (frag.trim()) {
      if (mode === "replace") {
        onChange(frag);
      } else {
        const base = value.replace(/\s+$/, "");
        let next: string;
        if (!base) next = frag;
        else if (base.endsWith(",")) next = base + " " + frag;
        else next = base + ", " + frag;
        onChange(next);
      }
      // Indices may shift under an import; drop the chip selection
      // rather than risk the editor bar acting on the wrong tag.
      onChipSelect(fieldId, null);
    }
    setPasteText("");
    setPasteOpen(false);
  };

  const copyValue = async () => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // The page is served over plain http (non-secure context), where
      // the Clipboard API is often unavailable; fall back to a
      // temporary textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  // --- Chip editor (state lifted to GenerateForm, #26) ------------------
  const applyWeight = (w: number) => {
    if (!selChip) return;
    const r = setChipWeight(segs, selChip.seg, selChip.tag, w);
    if (r.segs !== segs) {
      onChange(serializePrompt(r.segs));
      if (r.select) onChipSelect(fieldId, r.select);
    }
  };
  const applyText = (t: string) => {
    if (!selChip) return;
    const r = setChipText(segs, selChip.seg, selChip.tag, t);
    if (r.segs !== segs) {
      onChange(serializePrompt(r.segs));
      // A select target keeps the bar open on the (possibly split-out)
      // chip; no target means the text was empty and the chip is gone.
      if (r.select) onChipSelect(fieldId, r.select);
      else onChipSelect(fieldId, null);
    }
  };
  const applyDelete = () => {
    if (!selChip) return;
    onChange(serializePrompt(deleteChip(segs, selChip.seg, selChip.tag)));
    onChipSelect(fieldId, null);
  };
  const applyPrefix = (prefix: string | null) => {
    if (!selChip) return;
    onChange(
      serializePrompt(setChipPrefix(segs, selChip.seg, selChip.tag, prefix)),
    );
  };

  // The reported snapshot's actions delegate to the latest closures so
  // the shared bar never acts on stale segments.
  const actionsRef = useRef({ applyWeight, applyText, applyDelete, applyPrefix });
  useEffect(() => {
    actionsRef.current = { applyWeight, applyText, applyDelete, applyPrefix };
  });

  const hasSel = !!selChip;
  const selText = selChip?.text;
  const selRaw = selChip?.raw ?? false;
  useEffect(() => {
    if (selChip) {
      onChipEditor(fieldId, {
        fieldId,
        text: selChip.text,
        weight: effWeight,
        raw: selChip.raw,
        character: !!character,
        prefix: selPrefix,
        onWeight: (w) => actionsRef.current.applyWeight(w),
        onText: (t) => actionsRef.current.applyText(t),
        onDelete: () => actionsRef.current.applyDelete(),
        onPrefix: (p) => actionsRef.current.applyPrefix(p),
        onClose: () => onChipSelect(fieldId, null),
      });
    } else {
      onChipEditor(fieldId, null);
    }
    return () => onChipEditor(fieldId, null);
    // Only the snapshot's display fields are deps: the actions are
    // stable ref-delegating wrappers, and GenerateForm ignores
    // re-reports whose display fields are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldId, hasSel, selText, selRaw, effWeight, selPrefix, character]);

  return (
    <div>
      {/* Field chrome: bulk text in/out. Free-text editing is gone
          (#28); paste import and copy live here instead. */}
      <div className="mb-1.5 flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-2 text-[13px] font-normal text-muted-foreground"
          onClick={() => setPasteOpen(true)}
        >
          貼り付け
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-2 text-[13px] font-normal text-muted-foreground"
          onClick={() => void copyValue()}
        >
          {copied ? "コピーしました" : "コピー"}
        </Button>
      </div>

      {/* Chips + add-tag input: the only editing UI. */}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => {
          const active = !!sel && sel.seg === c.seg && sel.tag === c.tag;
          const neg = (c.weight ?? 1) < 0;
          return (
            <button
              key={`${c.seg}:${c.tag}`}
              type="button"
              onClick={() =>
                onChipSelect(fieldId, active ? null : { seg: c.seg, tag: c.tag })
              }
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-2 text-tag leading-snug",
                c.raw
                  ? "border-dashed text-muted-foreground"
                  : "border-border bg-card",
                neg && "border-err/50 text-err",
                active && "border-primary ring-1 ring-primary",
              )}
            >
              <span className="truncate">{c.text}</span>
              {c.weight !== null && (
                <span
                  className={cn(
                    "shrink-0 text-tag-badge font-semibold",
                    neg ? "text-err" : "text-muted-foreground",
                  )}
                >
                  ×{fmtWeight(c.weight)}
                </span>
              )}
            </button>
          );
        })}
        <input
          ref={addRef}
          type="text"
          value={addText}
          aria-label="タグを追加"
          placeholder="タグを追加"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setAddText(e.target.value);
            scheduleAddSuggest(e.target.value);
          }}
          onFocus={() => {
            if (addText) scheduleAddSuggest(addText);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              // Comma commits too, so several tags can be typed in a
              // row without reaching for the suggestion strip.
              e.preventDefault();
              commitAdd();
            } else if (e.key === "Escape") {
              setAddText("");
              setSuggestions([]);
              queryRef.current = "";
            }
          }}
          onBlur={() => {
            // Hide on blur, but only after ~200ms: a tap on a
            // suggestion blurs the input first, and the strip must
            // stay mounted long enough for that tap's click to land
            // (a scroll gesture never produces a click, so this
            // delay cannot cause accidental selections).
            setTimeout(() => setSuggestions([]), 200);
          }}
          className="h-tap min-w-32 flex-1 rounded-full border border-dashed border-input bg-transparent px-3.5 text-tag outline-none placeholder:text-muted-foreground focus:border-primary"
        />
      </div>

      {strip}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>プロンプトを貼り付け</DialogTitle>
            <DialogDescription>
              貼り付けたテキストは、重みセクションをタグごとに分割して取り込まれます。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="1girl, ..."
            className="min-h-[120px] text-base"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => applyPaste("append")}
            >
              末尾に追加
            </Button>
            <Button type="button" onClick={() => applyPaste("replace")}>
              置き換える
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

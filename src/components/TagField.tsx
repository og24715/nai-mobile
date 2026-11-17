import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import {
  deleteChip,
  findToken,
  fmtWeight,
  listChips,
  parsePrompt,
  serializePrompt,
  setChipPrefix,
  setChipWeight,
  splitPrefix,
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
  onDelete: () => void;
  onPrefix: (p: string | null) => void;
  onClose: () => void;
}

interface Props {
  id?: string;
  // Unique per field instance ("prompt", "char-0-negative", ...). Used
  // to route the lifted chip selection / editor bar to the right field.
  fieldId: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
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

// A prompt field whose primary UI is the tag chips (improvement #21)
// plus an inline "add tag" input (improvement #26): typing there shows
// the same suggestion strip as the textarea (#22), and Enter / comma /
// picking a suggestion appends the tag to the end of the value. The
// raw textarea is demoted to a collapsible fallback behind the
// 「テキストで編集」 toggle (default hidden). The text remains the
// single source of truth: chips are derived from the current value on
// every render, and every edit rewrites the value through the same
// setter, so persistence and generation payloads are untouched.
export function TagField({
  id,
  fieldId,
  value,
  onChange,
  placeholder,
  className,
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

  const [showText, setShowText] = useState(false);

  // --- Suggestions (shared by the textarea and the add-tag input) -----
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [suggestSource, setSuggestSource] = useState<"textarea" | "add" | null>(
    null,
  );
  const elRef = useRef<HTMLTextAreaElement | null>(null);
  const addRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef("");
  const sourceRef = useRef<"textarea" | "add" | null>(null);

  const runQuery = (q: string, source: "textarea" | "add") => {
    if (!suggest) return;
    queryRef.current = q;
    sourceRef.current = source;
    setSuggestSource(source);
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
        // user is still typing, in the input they are typing in.
        if (queryRef.current === q && sourceRef.current === source) {
          setSuggestions(list.slice(0, 8));
        }
      });
    }, 250);
  };

  const scheduleTextareaSuggest = (text: string, cursor: number) => {
    if (!suggest) return;
    runQuery(findToken(text, cursor).query, "textarea");
  };

  // --- Add-tag input ----------------------------------------------------
  const [addText, setAddText] = useState("");

  const scheduleAddSuggest = (text: string) => {
    if (!suggest) return;
    // A leading source#/target#/mutual# prefix is not part of the tag
    // being searched; it is re-attached when a suggestion is picked.
    runQuery(splitPrefix(text).rest, "add");
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
    if (suggestSource === "add") {
      const { prefix } = splitPrefix(addText);
      appendTag(prefix ? `${prefix}#${s.name}` : s.name);
      setAddText("");
      setSuggestions([]);
      queryRef.current = "";
      // Keep focus in the add input for consecutive additions.
      requestAnimationFrame(() => addRef.current?.focus());
      return;
    }
    const el = elRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const token = findToken(value, cursor);
    const before = value.slice(0, token.start);
    const after = value.slice(cursor);
    const insert = token.prefix + s.name;
    // Don't stack a second comma when one already follows the cursor.
    const sep = after.startsWith(",") ? "" : ", ";
    const next = before + insert + sep + after;
    onChange(next);
    setSuggestions([]);
    queryRef.current = "";
    const pos = (before + insert + sep).length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const strip = suggestions.length > 0 && (
    <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
      {suggestions.map((s) => (
        <button
          key={s.name}
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            applySuggestion(s);
          }}
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

  // --- Chip editor (state lifted to GenerateForm, #26) ------------------
  const applyWeight = (w: number) => {
    if (!selChip) return;
    const r = setChipWeight(segs, selChip.seg, selChip.tag, w);
    if (r.segs !== segs) {
      onChange(serializePrompt(r.segs));
      if (r.select) onChipSelect(fieldId, r.select);
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
  const actionsRef = useRef({ applyWeight, applyDelete, applyPrefix });
  useEffect(() => {
    actionsRef.current = { applyWeight, applyDelete, applyPrefix };
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
      {/* Chips + add-tag input: the primary editing UI. */}
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
            // Small delay so a tap on a suggestion lands first (the
            // buttons also preventDefault on pointer down).
            setTimeout(() => setSuggestions([]), 150);
          }}
          className="h-tap min-w-32 flex-1 rounded-full border border-dashed border-input bg-transparent px-3.5 text-tag outline-none placeholder:text-muted-foreground focus:border-primary"
        />
      </div>

      {suggestSource === "add" && strip}

      <button
        type="button"
        onClick={() => setShowText((v) => !v)}
        aria-expanded={showText}
        className="mt-2 inline-flex items-center gap-1 py-1.5 text-sm text-muted-foreground"
      >
        <ChevronDown
          size={16}
          className={cn("transition-transform", !showText && "-rotate-90")}
        />
        テキストで編集
      </button>

      {showText && (
        <>
          <Textarea
            id={id}
            placeholder={placeholder}
            className={cn("mt-1", className)}
            value={value}
            onChange={(e) => {
              elRef.current = e.currentTarget;
              onChange(e.target.value);
              // Indices may shift under a manual edit; drop the selection
              // rather than risk acting on the wrong tag.
              onChipSelect(fieldId, null);
              scheduleTextareaSuggest(
                e.target.value,
                e.currentTarget.selectionStart ?? 0,
              );
            }}
            onSelect={(e) => {
              elRef.current = e.currentTarget;
              scheduleTextareaSuggest(
                value,
                e.currentTarget.selectionStart ?? 0,
              );
            }}
            onKeyUp={(e) => {
              elRef.current = e.currentTarget;
              scheduleTextareaSuggest(
                value,
                e.currentTarget.selectionStart ?? 0,
              );
            }}
            onClick={(e) => {
              elRef.current = e.currentTarget;
            }}
            onBlur={() => {
              setTimeout(() => setSuggestions([]), 150);
            }}
          />
          {suggestSource === "textarea" && strip}
        </>
      )}
    </div>
  );
}

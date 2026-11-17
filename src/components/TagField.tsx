import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { cn } from "cn";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
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
  type Chip,
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
  raw: boolean;
  character: boolean;
  prefix: string | null;
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
// free-text textarea anymore. Weight stepping lives ON the chips
// themselves (#34): each non-raw chip is a [−][label][+] button
// group. A chip's own text is edited in the shared editor bar (see
// ChipEditorBar / setChipText), which also holds the prefix selector
// and delete. The field's string value remains the single source of
// truth: chips are derived from it on every render, and every edit
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
            <span className="text-xs font-medium text-primary">Frequently Used</span>
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
  // --- On-chip weight stepping (improvement #34) -----------------------
  // The −/+ zones of a chip step its weight directly through
  // setChipWeight — the editor bar is not involved. Selection is only
  // adjusted when the indices move: the stepped chip itself is
  // followed to its (possibly split-out) position so an open bar
  // stays on it, and a selection pointing into/after a section that
  // split is shifted to keep pointing at the same tag.
  const stepChip = (c: Chip, delta: number) => {
    const r = setChipWeight(segs, c.seg, c.tag, (c.weight ?? 1) + delta);
    if (r.segs === segs) return;
    onChange(serializePrompt(r.segs));
    if (!sel) return;
    if (sel.seg === c.seg && sel.tag === c.tag) {
      onChipSelect(fieldId, r.select ?? null);
    } else if (r.segs.length !== segs.length) {
      if (sel.seg === c.seg && sel.tag > c.tag) {
        // Same section: the selected tag stays in the remaining
        // section, one index earlier now that c.tag left it.
        onChipSelect(fieldId, { seg: sel.seg, tag: sel.tag - 1 });
      } else if (sel.seg > c.seg) {
        onChipSelect(fieldId, { seg: sel.seg + 1, tag: sel.tag });
      }
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
  const actionsRef = useRef({ applyText, applyDelete, applyPrefix });
  useEffect(() => {
    actionsRef.current = { applyText, applyDelete, applyPrefix };
  });

  const hasSel = !!selChip;
  const selText = selChip?.text;
  const selRaw = selChip?.raw ?? false;
  useEffect(() => {
    if (selChip) {
      onChipEditor(fieldId, {
        fieldId,
        text: selChip.text,
        raw: selChip.raw,
        character: !!character,
        prefix: selPrefix,
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
  }, [fieldId, hasSel, selText, selRaw, selPrefix, character]);

  return (
    <div>
      {/* Chips + add-tag input: the only editing UI. */}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => {
          const active = !!sel && sel.seg === c.seg && sel.tag === c.tag;
          const neg = (c.weight ?? 1) < 0;
          if (c.raw) {
            // Raw chunks (brace/bracket syntax) have no weight to
            // step: a plain chip that only opens the bar's text
            // editing, as before.
            return (
              <button
                key={`${c.seg}:${c.tag}`}
                type="button"
                data-chip
                onClick={() =>
                  onChipSelect(fieldId, active ? null : { seg: c.seg, tag: c.tag })
                }
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-2 text-tag leading-snug",
                  "border-dashed text-muted-foreground",
                  active && "border-primary ring-1 ring-primary",
                )}
              >
                <span className="truncate">{c.text}</span>
              </button>
            );
          }
          // Non-raw chips are a joined [−][label][+] button group
          // (improvement #34): the −/+ zones step the weight in
          // place; the label between them selects the chip and opens
          // the editor bar (text / prefix / delete). Hand-rolled
          // rather than shadcn's ButtonGroup: that component styles
          // each button's own border and corner radius, which fights
          // this single-pill design (one container border, group-wide
          // active/negative states, truncating label).
          return (
            <div
              key={`${c.seg}:${c.tag}`}
              role="group"
              data-chip
              aria-label={c.text}
              className={cn(
                "inline-flex h-tap max-w-full items-stretch divide-x overflow-hidden rounded-full border bg-card select-none",
                neg ? "divide-err/30 border-err/50 text-err" : "divide-border border-border",
                active && "border-primary ring-1 ring-primary",
              )}
            >
              <button
                type="button"
                aria-label={`Decrease the weight of ${c.text}`}
                onClick={(e) => {
                  e.stopPropagation();
                  stepChip(c, -0.1);
                }}
                className="flex w-stepper shrink-0 touch-manipulation items-center justify-center active:bg-accent"
              >
                <Minus size={18} />
              </button>
              <button
                type="button"
                onClick={() =>
                  onChipSelect(fieldId, active ? null : { seg: c.seg, tag: c.tag })
                }
                className="flex min-w-0 touch-manipulation items-center gap-1.5 px-1.5 text-tag leading-snug"
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
              <button
                type="button"
                aria-label={`Increase the weight of ${c.text}`}
                onClick={(e) => {
                  e.stopPropagation();
                  stepChip(c, 0.1);
                }}
                className="flex w-stepper shrink-0 touch-manipulation items-center justify-center active:bg-accent"
              >
                <Plus size={18} />
              </button>
            </div>
          );
        })}
        {/* Clear button (improvement #49): the same InputGroup
            construction as the seed field (#48) — an inline x that
            exists only while text is typed. Clearing mirrors the
            Escape key and focus stays in the input for the next
            tag. The group is restyled back into the dashed pill
            the raw input used to be. */}
        <InputGroup className="h-tap min-w-32 flex-1 rounded-full border-dashed bg-transparent dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-primary has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupInput
            ref={addRef}
            type="text"
            value={addText}
            aria-label="Add tag"
            placeholder="Add tag"
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
            className="px-3.5 text-tag md:text-tag"
          />
          {addText !== "" && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                aria-label="Clear tag input"
                onClick={() => {
                  setAddText("");
                  setSuggestions([]);
                  queryRef.current = "";
                  // Keep focus in the add input for the next tag.
                  requestAnimationFrame(() => addRef.current?.focus());
                }}
              >
                <X className="size-4" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>

      {strip}
    </div>
  );
}

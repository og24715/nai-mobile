import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Plus, Trash2, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
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

interface Props {
  // Unique per field instance ("prompt", "char-0-negative", ...).
  // Used to scope the chip popover's outside-press veto to this
  // field's own chips.
  fieldId: string;
  value: string;
  onChange: (v: string) => void;
  // Character prompt fields get the source#/target#/mutual# selector.
  character?: boolean;
  // Tag suggestions (improvement #22): needs the selected model for
  // the official suggest-tags relay.
  suggest?: boolean;
  model?: string;
}

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// The per-chip editor (improvement #50): rendered inside the Popover
// anchored to the chip itself, replacing the shared sticky editor
// bar (#26) and its hand-rolled outside-tap dismissal (#36) — the
// Popover's own outside-press / Escape handling does that now. The
// contents mirror what the bar offered for a chip: a text field
// holding the chip's own text (Enter or ✓ applies it through
// setChipText — in place for plain/single-tag chips, split-out for
// a tag inside a multi-tag section, verbatim body replacement for
// raw chunks; empty text deletes the chip), a delete button, and —
// for non-raw chips in character fields only — the
// source#/target#/mutual# prefix selector. Raw chunks get only the
// text row plus delete. Weight is NOT adjusted here (#34): each
// chip carries its own [−][+] step zones.
function ChipEditorContent({
  chip,
  character,
  onApplyText,
  onPrefix,
  onDelete,
}: {
  chip: Chip;
  character: boolean;
  onApplyText: (t: string) => void;
  onPrefix: (p: string | null) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(chip.text);
  // Re-seed the draft when the popover's chip changes text through
  // another action (e.g. a prefix change rewrites the chip text).
  // Typing never touches chip.text, so this does not fight input.
  useEffect(() => {
    setDraft(chip.text);
  }, [chip.text]);
  const prefix = splitPrefix(chip.text).prefix;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          aria-label="Tag text"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onApplyText(draft);
            }
          }}
          className="h-tap min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-tag outline-none focus:border-primary"
        />
        <Button
          type="button"
          variant="secondary"
          aria-label="Apply text"
          className="h-tap w-tap shrink-0 p-0"
          onClick={() => onApplyText(draft)}
        >
          <Check size={18} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="Delete this tag"
          className="h-tap w-tap shrink-0 p-0 text-muted-foreground"
          onClick={onDelete}
        >
          <Trash2 size={16} />
        </Button>
      </div>
      {!chip.raw && character && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Prefix"
            value={prefix ?? ""}
            onChange={(e) =>
              onPrefix(e.target.value === "" ? null : e.target.value)
            }
            className="h-tap rounded-md border border-input bg-background px-1.5 text-sm"
          >
            <option value="">No prefix</option>
            <option value="source">source#</option>
            <option value="target">target#</option>
            <option value="mutual">mutual#</option>
          </select>
        </div>
      )}
    </div>
  );
}

// A prompt field edited ONLY through its tag chips (improvements #21,
// #28): the chips plus an inline "add tag" input with the
// suggestion combobox (#22, #54) are the whole editing UI — there is no
// free-text textarea anymore. Weight stepping lives ON the chips
// themselves (#34): each non-raw chip is a [−][label][+] button
// group. Tapping a chip's label opens its editor Popover (#50) with
// the text / prefix / delete controls. The field's string value
// remains the single source of truth: chips are derived from it on
// every render, and every edit rewrites it through the same setter,
// so persistence and generation payloads are untouched.
export function TagField({
  fieldId,
  value,
  onChange,
  character,
  suggest,
  model,
}: Props) {
  const segs = useMemo(() => parsePrompt(value), [value]);
  const chips = useMemo(() => listChips(segs), [segs]);

  // Which chip's editor Popover is open, if any (improvement #50).
  // Local to the field; the stepper / text-edit follow logic below
  // keeps it bound to the same tag when an edit splits a section
  // and indices shift.
  const [openChip, setOpenChip] = useState<{ seg: number; tag: number } | null>(
    null,
  );

  // --- Suggestions (add-tag input only) --------------------------------
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const addRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef("");
  // The suggestion the Combobox currently has highlighted via
  // keyboard navigation (improvement #54): Enter selects it when
  // one is set, and commits the typed text when none is.
  const highlightedRef = useRef<TagSuggestion | null>(null);

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
    highlightedRef.current = null;
    // Keep focus in the add input for consecutive additions. The
    // clear is repeated in the frame as a guard: if the Combobox
    // echoes the picked label back through onInputValueChange as
    // part of its selection handling, the input still ends empty
    // (and the stale-response guard in runQuery drops the fetch
    // that echo may have scheduled, since queryRef is reset).
    requestAnimationFrame(() => {
      setAddText("");
      setSuggestions([]);
      queryRef.current = "";
      addRef.current?.focus();
    });
  };

  // --- On-chip weight stepping (improvement #34) -----------------------
  // The −/+ zones of a chip step its weight directly through
  // setChipWeight — the editor popover is not involved. The open
  // popover is only adjusted when indices move: the stepped chip
  // itself is followed to its (possibly split-out) position so its
  // popover stays on it, and an open chip pointing into/after a
  // section that split is shifted to keep pointing at the same tag.
  const stepChip = (c: Chip, delta: number) => {
    const r = setChipWeight(segs, c.seg, c.tag, (c.weight ?? 1) + delta);
    if (r.segs === segs) return;
    onChange(serializePrompt(r.segs));
    if (!openChip) return;
    if (openChip.seg === c.seg && openChip.tag === c.tag) {
      setOpenChip(r.select ?? null);
    } else if (r.segs.length !== segs.length) {
      if (openChip.seg === c.seg && openChip.tag > c.tag) {
        // Same section: the open tag stays in the remaining
        // section, one index earlier now that c.tag left it.
        setOpenChip({ seg: openChip.seg, tag: openChip.tag - 1 });
      } else if (openChip.seg > c.seg) {
        setOpenChip({ seg: openChip.seg + 1, tag: openChip.tag });
      }
    }
  };
  const applyText = (c: Chip, t: string) => {
    const r = setChipText(segs, c.seg, c.tag, t);
    if (r.segs !== segs) {
      onChange(serializePrompt(r.segs));
      // Follow the (possibly split-out) chip so its popover stays
      // open on it; no select target means the text was empty and
      // the chip is gone, so the popover closes.
      setOpenChip(r.select ?? null);
    }
  };
  const applyDelete = (c: Chip) => {
    onChange(serializePrompt(deleteChip(segs, c.seg, c.tag)));
    setOpenChip(null);
  };
  const applyPrefix = (c: Chip, prefix: string | null) => {
    onChange(
      serializePrompt(setChipPrefix(segs, c.seg, c.tag, prefix)),
    );
  };

  // Popover open-state routing for one chip. Base UI's dismissal
  // replaces the old hand-rolled outside-tap listener (#36), with
  // one exemption carried over from it: an outside press that lands
  // on one of THIS field's chips is vetoed — a stepper tap must run
  // the follow logic above (which may move or keep the selection),
  // and a label tap on another chip opens that chip's popover
  // instead; neither should be pre-empted by this popover closing.
  // Presses anywhere else (including other fields' chips) close it.
  const handleOpenChange =
    (c: Chip) =>
    (
      open: boolean,
      details: { reason: string; event: Event; cancel: () => void },
    ) => {
      if (open) {
        setOpenChip({ seg: c.seg, tag: c.tag });
        return;
      }
      if (details.reason === "outside-press") {
        const t = details.event.target as HTMLElement | null;
        const chipEl = t?.closest?.("[data-chip]");
        if (
          chipEl &&
          chipEl.closest("[data-tagfield]")?.getAttribute("data-tagfield") ===
            fieldId
        ) {
          details.cancel();
          return;
        }
      }
      setOpenChip(null);
    };

  const editorFor = (c: Chip) => (
    <ChipEditorContent
      chip={c}
      character={!!character}
      onApplyText={(t) => applyText(c, t)}
      onPrefix={(p) => applyPrefix(c, p)}
      onDelete={() => applyDelete(c)}
    />
  );

  return (
    <div data-tagfield={fieldId}>
      {/* Chips + add-tag input: the only editing UI. */}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => {
          const active =
            !!openChip && openChip.seg === c.seg && openChip.tag === c.tag;
          const neg = (c.weight ?? 1) < 0;
          if (c.raw) {
            // Raw chunks (brace/bracket syntax) have no weight to
            // step: a plain chip whose tap opens the popover's text
            // editing, as before.
            return (
              <Popover
                key={`${c.seg}:${c.tag}`}
                open={active}
                onOpenChange={handleOpenChange(c)}
              >
                <PopoverTrigger
                  data-chip
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-2 text-tag leading-snug",
                    "border-dashed text-muted-foreground",
                    active && "border-primary ring-1 ring-primary",
                  )}
                >
                  <span className="truncate">{c.text}</span>
                </PopoverTrigger>
                <PopoverContent
                  sideOffset={6}
                  className="w-[min(320px,90vw)]"
                >
                  {editorFor(c)}
                </PopoverContent>
              </Popover>
            );
          }
          // Non-raw chips are a joined [−][label][+] button group
          // (improvement #34): the −/+ zones step the weight in
          // place; the label between them is the Popover trigger for
          // the chip editor (text / prefix / delete). Hand-rolled
          // rather than shadcn's ButtonGroup: that component styles
          // each button's own border and corner radius, which fights
          // this single-pill design (one container border, group-wide
          // active/negative states, truncating label).
          return (
            <Popover
              key={`${c.seg}:${c.tag}`}
              open={active}
              onOpenChange={handleOpenChange(c)}
            >
              <div
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
                <PopoverTrigger className="flex min-w-0 touch-manipulation items-center gap-1.5 px-1.5 text-tag leading-snug">
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
                </PopoverTrigger>
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
              <PopoverContent
                sideOffset={6}
                className="w-[min(320px,90vw)]"
              >
                {editorFor(c)}
              </PopoverContent>
            </Popover>
          );
        })}
        {/* Add-tag combobox (improvement #54): shadcn's Combobox
            (Base UI) renders the suggestions; the data layer is
            unchanged — the debounced /api/tags relay fills
            `suggestions` and the server's ordering is
            authoritative, so the Combobox's own filtering is
            disabled (filter={null}) and the list shows exactly
            what the fetch returned. Selecting an item applies it
            as a tag; Enter / comma with nothing highlighted
            commits the typed text instead. The input itself is
            the same InputGroup dashed pill as before, composed
            through the Combobox's Input part, so the #49 clear
            button keeps its place in the inline-end addon. */}
        <Combobox
          items={suggestions}
          filter={null}
          autoHighlight={false}
          itemToStringLabel={(s: TagSuggestion | null) => s?.name ?? ""}
          itemToStringValue={(s: TagSuggestion | null) => s?.name ?? ""}
          value={null}
          inputValue={addText}
          open={suggestions.length > 0}
          onOpenChange={(nextOpen, details) => {
            if (nextOpen) return;
            // The popup asked to close (outside press, focus out,
            // Escape): mirror the old strip's hide by dropping the
            // suggestions. Escape also clears the typed text.
            setSuggestions([]);
            if (details.reason === "escape-key") {
              setAddText("");
              queryRef.current = "";
            }
          }}
          onInputValueChange={(v, details) => {
            // Input changes caused by picking an item (the
            // Combobox writing the picked label into the input)
            // are handled by onValueChange, not as typing.
            if (details.reason === "item-press") return;
            setAddText(v);
            scheduleAddSuggest(v);
          }}
          onValueChange={(s) => {
            if (s) applySuggestion(s);
          }}
          onItemHighlighted={(s) => {
            highlightedRef.current = s ?? null;
          }}
        >
          <InputGroup className="h-tap min-w-32 flex-1 rounded-full border-dashed bg-transparent dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-primary has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <ComboboxPrimitive.Input
              render={
                <InputGroupInput
                  ref={addRef}
                  type="text"
                  aria-label="Add tag"
                  placeholder="Add tag"
                  enterKeyHint="done"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onFocus={() => {
                    if (addText) scheduleAddSuggest(addText);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      // With a suggestion highlighted (arrow-key
                      // navigation), Enter belongs to the Combobox
                      // and selects it. Otherwise the typed text is
                      // committed as a tag — comma commits too, so
                      // several tags can be typed in a row.
                      if (e.key === "Enter" && highlightedRef.current) {
                        return;
                      }
                      e.preventDefault();
                      commitAdd();
                    } else if (e.key === "Escape") {
                      setAddText("");
                      setSuggestions([]);
                      queryRef.current = "";
                    }
                  }}
                  className="px-3.5 text-tag md:text-tag"
                />
              }
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
          <ComboboxContent>
            <ComboboxList>
              {suggestions.map((s) => (
                <ComboboxItem
                  key={s.name}
                  value={s}
                  className="min-h-tap px-3.5 text-suggest"
                >
                  <span>{s.name}</span>
                  {s.mine > 0 ? (
                    <span className="ml-auto text-xs font-medium text-primary">
                      Frequently Used
                    </span>
                  ) : s.count !== null ? (
                    <span className="ml-auto text-tag-badge text-muted-foreground">
                      {fmtCount(s.count)}
                    </span>
                  ) : null}
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    </div>
  );
}

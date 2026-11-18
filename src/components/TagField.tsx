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
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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
// text row plus delete. Non-raw chips also get a weight slider
// (improvement #82): range −3..+3 in 0.05 steps, applied live
// through the same setChipWeight path as the chips' own [−][+]
// step zones (#34) — exactly 1.0 unwraps to a plain tag, and a
// tag inside a multi-tag section splits out at the new weight,
// with the Popover following it. A weight outside the slider's
// range shows its true value in the readout with the thumb
// pinned at the nearest end; opening the editor never changes
// the weight on its own.
// Non-raw chips also get tag suggestions while editing (#60): the
// same data as the add-tag input (fetchTagSuggestions, 250 ms
// debounce, 2-char minimum, query on the part after any prefix),
// rendered as an inline list under the input — NOT the add input's
// Combobox, whose popup is portaled outside this Popover and
// would make every suggestion tap an outside press that dismisses
// the editor (the #50 veto only exempts this field's chips). A
// pick COMMITS immediately (#65): it runs the same setChipText
// path as ✓ / Enter (prefix preserved, section split included)
// and then closes the Popover. Typing only edits the draft; ✓ /
// Enter commits the draft and closes the Popover too (#66).
function ChipEditorContent({
  chip,
  character,
  suggest,
  model,
  onApplyText,
  onPickSuggestion,
  onSetWeight,
  onPrefix,
  onDelete,
}: {
  chip: Chip;
  character: boolean;
  suggest?: boolean;
  model?: string;
  onApplyText: (t: string) => void;
  onPickSuggestion: (t: string) => void;
  onSetWeight: (w: number) => void;
  onPrefix: (p: string | null) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(chip.text);

  // --- Suggestions (improvement #60) -----------------------------------
  const suggestEnabled = !!suggest && !chip.raw;
  const [editSuggestions, setEditSuggestions] = useState<TagSuggestion[]>(
    [],
  );
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const editAbortRef = useRef<AbortController | null>(null);
  const editQueryRef = useRef("");

  const runEditQuery = (text: string) => {
    if (!suggestEnabled) return;
    // A leading source#/target#/mutual# prefix is not part of the
    // tag being searched; it is re-attached when a suggestion is
    // picked — same handling as the add-tag input (#22).
    const q = splitPrefix(text).rest;
    editQueryRef.current = q;
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    if (q.length < 2 || /[:{}[\]]/.test(q)) {
      setEditSuggestions([]);
      return;
    }
    editDebounceRef.current = setTimeout(() => {
      editAbortRef.current?.abort();
      const ctrl = new AbortController();
      editAbortRef.current = ctrl;
      void fetchTagSuggestions(
        readStored(TOKEN_KEY) ?? "",
        q,
        model ?? "",
        ctrl.signal,
      ).then((list) => {
        // Drop stale responses, mirroring the add input's guard.
        if (editQueryRef.current === q) {
          setEditSuggestions(list.slice(0, 8));
        }
      });
    }, 250);
  };

  // Drop pending suggestion work when the editor unmounts.
  useEffect(
    () => () => {
      if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
      editAbortRef.current?.abort();
    },
    [],
  );

  // A picked suggestion commits immediately (#65): the picked
  // name (with the draft's prefix re-attached) goes through the
  // same setChipText commit path as ✓ / Enter, and the Popover
  // closes — no separate apply step.
  const pickEditSuggestion = (s: TagSuggestion) => {
    const { prefix: p } = splitPrefix(draft);
    setEditSuggestions([]);
    editQueryRef.current = "";
    onPickSuggestion(p ? `${p}#${s.name}` : s.name);
  };

  const apply = () => {
    setEditSuggestions([]);
    editQueryRef.current = "";
    onApplyText(draft);
  };

  // Re-seed the draft when the popover's chip changes text through
  // another action (e.g. a prefix change rewrites the chip text).
  // Typing never touches chip.text, so this does not fight input.
  // A reseed also makes any showing suggestions stale.
  useEffect(() => {
    setDraft(chip.text);
    setEditSuggestions([]);
    editQueryRef.current = "";
  }, [chip.text]);
  const prefix = splitPrefix(chip.text).prefix;
  // Plain tags carry no weight (null) and behave as 1.0.
  const weight = chip.weight ?? 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          ref={editInputRef}
          type="text"
          value={draft}
          aria-label="Tag text"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          onChange={(e) => {
            setDraft(e.target.value);
            runEditQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          className="h-tap min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-tag outline-none focus:border-primary"
        />
        <Button
          type="button"
          variant="secondary"
          aria-label="Apply text"
          className="h-tap w-tap shrink-0 p-0"
          onClick={apply}
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
      {suggestEnabled && editSuggestions.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-md border border-border bg-background">
          {editSuggestions.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                // Don't let the tap move focus to the button
                // before the click commits the pick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickEditSuggestion(s)}
                className="flex min-h-tap w-full items-center px-3.5 text-left text-suggest active:bg-accent"
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
              </button>
            </li>
          ))}
        </ul>
      )}
      {!chip.raw && (
        <div>
          <Label className="mb-1.5 block text-sm font-medium text-muted-foreground">
            Weight{" "}
            <span className="text-lg font-semibold tabular-nums text-foreground">
              ×{fmtWeight(weight)}
            </span>
          </Label>
          <Slider
            className="px-2"
            aria-label="Tag weight"
            value={[Math.min(3, Math.max(-3, weight))]}
            min={-3}
            max={3}
            step={0.05}
            onValueChange={(v) =>
              onSetWeight(Array.isArray(v) ? v[0] : v)
            }
          />
        </div>
      )}
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
// themselves (#34): each non-raw chip is a [−][label][+][×] button
// group — the trailing × deletes the chip in one tap (#80), no
// editor needed. Tapping a chip's label opens its editor Popover (#50) with
// the text / prefix / delete controls. The field's string value
// remains the single source of truth: chips are derived from it on
// every render, and every edit rewrites it through the same setter,
// so persistence and generation payloads are untouched.
// The add-tag input doubles as the chip filter (improvement #76,
// unifying #68's separate filter box into it): typing narrows
// which chips are RENDERED (substring, case-insensitive,
// display-only — the value and the chips' original indices are
// untouched, so editing through a filtered view behaves exactly
// as unfiltered), and committing routes through one rule: a text
// that exactly matches an existing chip ACTIVATES that chip
// (opens its editor) instead of adding a duplicate; anything
// else is appended as a new tag.
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
  // The field's root element; chip activation (#76) scrolls the
  // matched chip into view through it.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // This field's chip scroller (improvement #77's capped area);
  // after an append it is scrolled to its end so the new chip —
  // appended at the end of the list — is visible (#81).
  const chipScrollerRef = useRef<HTMLDivElement | null>(null);

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

  // --- Chip filter (improvements #68 + #76) -----------------------------
  // #76 unified #68's separate filter box into this input: while
  // the user types, the chip list narrows display-only to chips
  // containing the typed text (substring, case-insensitive, on
  // the part after any source# prefix — the same part the
  // suggestion search queries). Committing clears the input, so
  // the filter never hides a just-added or just-activated chip.
  const needle = splitPrefix(addText).rest.trim().toLowerCase();
  const filtering = needle !== "";
  const visibleChips = useMemo(
    () =>
      filtering
        ? chips.filter((c) => c.text.toLowerCase().includes(needle))
        : chips,
    [chips, filtering, needle],
  );

  // --- Scroll preservation across tag adds (improvement #81) ----
  // Typing in the add input filters the chips (#76), which can
  // collapse this field's chip area to nothing; the form content
  // above the input shrinks with it, the browser clamps the form
  // scroller's position, and when the commit restores the full
  // chip list the browser's scroll anchoring rewrites the form
  // scroll position again to keep the focused input pinned. Left
  // to the browser, that cycle threw the view around on every
  // add — on the phone, all the way to the top. So the app owns
  // the position instead: while the input is NOT filtering, the
  // form scroller's position is tracked as the settled position
  // (this also captures the browser's own scroll-on-focus
  // adjustment, which happens before the first keystroke); after
  // an append, that position is restored verbatim and the chip
  // scroller is scrolled to its end so the new chip shows.
  // Activation (an exact match, #76) deliberately does NOT
  // restore: its scrollIntoView is the point.
  const formScrollerRef = useRef<HTMLElement | null>(null);
  const savedFormScrollRef = useRef<number | null>(null);
  const filteringRef = useRef(filtering);
  useEffect(() => {
    filteringRef.current = filtering;
  }, [filtering]);

  // The form's scroll container is the first scrollable ancestor
  // above the field (the chip scroller is a descendant of the
  // field root, so it is never matched here).
  const findFormScroller = (): HTMLElement | null => {
    let el = rootRef.current?.parentElement ?? null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return el;
      el = el.parentElement;
    }
    return null;
  };

  useEffect(() => {
    const scroller = findFormScroller();
    if (!scroller) return;
    formScrollerRef.current = scroller;
    if (!filteringRef.current) {
      savedFormScrollRef.current = scroller.scrollTop;
    }
    const onScroll = () => {
      if (!filteringRef.current) {
        savedFormScrollRef.current = scroller.scrollTop;
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set by the append path of commitTag; the effect below runs
  // it once the appended value has rendered (the full chip list
  // is back and the browser's anchoring adjustment for the
  // regrowth has already been applied, so this write is the one
  // that sticks — a bare requestAnimationFrame can fire before
  // the re-render lands and be overwritten by the anchoring).
  const pendingSettleRef = useRef(false);
  useEffect(() => {
    if (!pendingSettleRef.current) return;
    pendingSettleRef.current = false;
    const scroller = formScrollerRef.current ?? findFormScroller();
    if (scroller && savedFormScrollRef.current !== null) {
      scroller.scrollTop = savedFormScrollRef.current;
    }
    const cs = chipScrollerRef.current;
    if (cs) cs.scrollTop = cs.scrollHeight;
  }, [value]);

  // If the chip whose editor is open falls out of the filtered
  // view, close the editor — its anchor is no longer rendered.
  useEffect(() => {
    if (!openChip) return;
    const visible = visibleChips.some(
      (c) => c.seg === openChip.seg && c.tag === openChip.tag,
    );
    if (!visible) setOpenChip(null);
  }, [visibleChips, openChip]);

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

  // --- Unified commit (improvement #76) ---------------------------------
  // One rule for Enter / comma / suggestion picks: if the field
  // already holds a chip with this tag, ACTIVATE it (open its
  // editor, scrolled into view) instead of adding a duplicate;
  // otherwise append it as a new tag. The comparison is trimmed,
  // case-insensitive, and treats underscores as spaces (the two
  // spellings of the same tag), and a chip also matches on its
  // text without the source#/target#/mutual# prefix — so typing
  // "foo" finds an existing "source#foo" chip and vice versa.
  const tagKey = (t: string) =>
    t.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");

  const findChip = (text: string): Chip | undefined => {
    const key = tagKey(text);
    const restKey = tagKey(splitPrefix(text).rest);
    return chips.find(
      (c) =>
        tagKey(c.text) === key ||
        tagKey(splitPrefix(c.text).rest) === restKey,
    );
  };

  // Returns true when an existing chip was activated (nothing
  // was appended). Either way the input — and with it the
  // filter — clears, so the activated / newly added chip is
  // visible afterwards.
  const commitTag = (rawText: string): boolean => {
    const text = rawText.trim();
    if (!text) return false;
    const existing = findChip(text);
    setAddText("");
    setSuggestions([]);
    queryRef.current = "";
    highlightedRef.current = null;
    if (existing) {
      setOpenChip({ seg: existing.seg, tag: existing.tag });
      const key = `${existing.seg}:${existing.tag}`;
      // The chip re-renders unfiltered once the input clears;
      // scroll it into view on the next frame.
      requestAnimationFrame(() => {
        rootRef.current
          ?.querySelector(`[data-chip-key="${key}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
      return true;
    }
    appendTag(text);
    pendingSettleRef.current = true;
    return false;
  };

  const commitAdd = () => {
    commitTag(addText);
  };

  const applySuggestion = (s: TagSuggestion) => {
    const { prefix } = splitPrefix(addText);
    const activated = commitTag(prefix ? `${prefix}#${s.name}` : s.name);
    // Keep focus in the add input for consecutive additions (an
    // activation leaves focus to the chip editor instead). The
    // clear is repeated in the frame as a guard: if the Combobox
    // echoes the picked label back through onInputValueChange as
    // part of its selection handling, the input still ends empty
    // (and the stale-response guard in runQuery drops the fetch
    // that echo may have scheduled, since queryRef is reset).
    requestAnimationFrame(() => {
      setAddText("");
      setSuggestions([]);
      queryRef.current = "";
      // preventScroll (#81): the form's scroll position is owned
      // by the settle logic above; a plain focus() would let the
      // browser scroll the input into view on top of it.
      if (!activated) addRef.current?.focus({ preventScroll: true });
    });
  };

  // --- Chip weight edits (improvements #34 + #82) ---------------------
  // Both weight controls go through setChipWeight and share this
  // write + follow path: the −/+ zones on a chip step its weight
  // (#34), and the editor Popover's slider sets it absolutely,
  // live while dragging (#82). The open popover is only adjusted
  // when indices move: the edited chip itself is followed to its
  // (possibly split-out) position so its popover stays on it, and
  // an open chip pointing into/after a section that split is
  // shifted to keep pointing at the same tag.
  const applyWeightResult = (
    c: Chip,
    r: ReturnType<typeof setChipWeight>,
  ) => {
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
  const stepChip = (c: Chip, delta: number) => {
    applyWeightResult(
      c,
      setChipWeight(segs, c.seg, c.tag, (c.weight ?? 1) + delta),
    );
  };
  const applyWeight = (c: Chip, w: number) => {
    applyWeightResult(c, setChipWeight(segs, c.seg, c.tag, w));
  };
  const applyText = (c: Chip, t: string) => {
    const r = setChipText(segs, c.seg, c.tag, t);
    if (r.segs !== segs) {
      onChange(serializePrompt(r.segs));
    }
    // Committing the draft closes the Popover (#66) — it no
    // longer follows the (possibly split-out) chip. Empty text
    // deletes the chip and closes as well, as it did before.
    setOpenChip(null);
  };
  // Suggestion picks in the chip editor (#65): the same commit as
  // applyText — since #66 both paths close the Popover.
  const applySuggestionText = (c: Chip, t: string) => {
    applyText(c, t);
  };
  const applyDelete = (c: Chip) => {
    onChange(serializePrompt(deleteChip(segs, c.seg, c.tag)));
    setOpenChip(null);
  };
  // One-tap delete from the chip's own × segment (improvement
  // #80): the same deleteChip path as the editor's delete button,
  // but the editor is not involved — it closes only when the
  // deleted chip was its own, and an editor open on a later chip
  // is shifted so it keeps pointing at the same tag (mirroring
  // the stepper follow logic in stepChip). Deleting a tag from a
  // multi-tag section shifts that section's later tags by one;
  // deleting a section's only chip removes the segment and shifts
  // later segments by one.
  const removeChip = (c: Chip) => {
    const segmentRemoved =
      chips.filter((o) => o.seg === c.seg).length <= 1;
    onChange(serializePrompt(deleteChip(segs, c.seg, c.tag)));
    if (!openChip) return;
    if (openChip.seg === c.seg && openChip.tag === c.tag) {
      setOpenChip(null);
    } else if (!segmentRemoved) {
      if (openChip.seg === c.seg && openChip.tag > c.tag) {
        setOpenChip({ seg: openChip.seg, tag: openChip.tag - 1 });
      }
    } else if (openChip.seg > c.seg) {
      setOpenChip({ seg: openChip.seg - 1, tag: openChip.tag });
    }
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
      suggest={!!suggest}
      model={model}
      onApplyText={(t) => applyText(c, t)}
      onPickSuggestion={(t) => applySuggestionText(c, t)}
      onSetWeight={(w) => applyWeight(c, w)}
      onPrefix={(p) => applyPrefix(c, p)}
      onDelete={() => applyDelete(c)}
    />
  );

  // React keys for the chip Popovers (improvement #82): keyed by
  // chip text + occurrence, NOT by segment/tag coordinates. A
  // weight edit that splits a section renumbers the coordinates
  // of the chips in it; with coordinate keys the open editor's
  // Popover remounted on the split, killing the weight slider's
  // drag after its first step. Text keys survive the renumbering
  // (a split never changes the flattened chip order), so the
  // editor instance — and an in-progress drag — stays alive and
  // keeps adjusting the same tag. (The data-chip-key attribute
  // keeps the coordinates: activation #76 and the outside-press
  // veto address chips by position.)
  const chipReactKeys = new Map<Chip, string>();
  {
    const seen = new Map<string, number>();
    for (const c of visibleChips) {
      const n = seen.get(c.text) ?? 0;
      seen.set(c.text, n + 1);
      chipReactKeys.set(c, `${c.text}#${n}`);
    }
  }

  return (
    <div ref={rootRef} data-tagfield={fieldId} className="flex flex-col gap-2">
      {/* Chips: capped in height with internal scrolling
          (improvement #77) so a long field scrolls on its own
          instead of stretching the whole form — about four rows
          of chips stay visible. The add-tag input below stays
          outside the scroller. */}
      <div ref={chipScrollerRef} className="max-h-44 overflow-y-auto p-0.5">
        <div className="flex flex-wrap items-center gap-2">
        {visibleChips.map((c) => {
          const active =
            !!openChip && openChip.seg === c.seg && openChip.tag === c.tag;
          const neg = (c.weight ?? 1) < 0;
          if (c.raw) {
            // Raw chunks (brace/bracket syntax) have no weight to
            // step: the label tap opens the popover's text editing,
            // and a trailing × segment deletes the chunk in one
            // tap (#80) — the same joined-pill shape as the
            // non-raw groups below.
            return (
              <Popover
                key={chipReactKeys.get(c)}
                open={active}
                onOpenChange={handleOpenChange(c)}
              >
                <div
                  role="group"
                  data-chip
                  data-chip-key={`${c.seg}:${c.tag}`}
                  aria-label={c.text}
                  className={cn(
                    "inline-flex max-w-full items-stretch divide-x divide-border overflow-hidden rounded-full border border-dashed text-muted-foreground select-none",
                    active && "border-primary ring-1 ring-primary",
                  )}
                >
                  <PopoverTrigger className="flex min-w-0 touch-manipulation items-center px-3 py-1.5 text-tag leading-snug">
                    <span className="truncate">{c.text}</span>
                  </PopoverTrigger>
                  <button
                    type="button"
                    aria-label={`Delete ${c.text}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeChip(c);
                    }}
                    className="flex w-stepper shrink-0 touch-manipulation items-center justify-center active:bg-accent"
                  >
                    <X size={16} />
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
          }
          // Non-raw chips are a joined [−][label][+][×] button group
          // (improvement #34): the −/+ zones step the weight in
          // place; the label between them is the Popover trigger for
          // the chip editor (text / prefix / delete); the trailing
          // × deletes the chip in one tap (#80). Hand-rolled
          // rather than shadcn's ButtonGroup: that component styles
          // each button's own border and corner radius, which fights
          // this single-pill design (one container border, group-wide
          // active/negative states, truncating label).
          return (
            <Popover
              key={chipReactKeys.get(c)}
              open={active}
              onOpenChange={handleOpenChange(c)}
            >
              <div
                role="group"
                data-chip
                data-chip-key={`${c.seg}:${c.tag}`}
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
                  <Minus size={16} />
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
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${c.text}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChip(c);
                  }}
                  className="flex w-stepper shrink-0 touch-manipulation items-center justify-center active:bg-accent"
                >
                  <X size={16} />
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
        {filtering && visibleChips.length === 0 && (
          <p className="w-full text-sm text-muted-foreground">
            No tags match
          </p>
        )}
        </div>
      </div>
      {/* Add-tag combobox (improvement #54): shadcn's Combobox
            (Base UI) renders the suggestions; the data layer is
            unchanged — the debounced /api/tags relay fills
            `suggestions` and the server's ordering is
            authoritative, so the Combobox's own filtering is
            disabled (filter={null}) and the list shows exactly
            what the fetch returned. Selecting an item commits
            its name; Enter / comma with nothing highlighted
            commits the typed text instead — both go through the
            unified activate-or-append rule (#76). The input itself is
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
            // Base UI also resets the input to the selected
            // value's label when the popup finishes closing
            // (reason "input-clear"): a selection-echo cleanup
            // that assumes the text is a transient filter over
            // a selection. Here value is pinned to null — picks
            // are consumed as tag commits, never stored as a
            // selection — so the label is always "" and any blur
            // would wipe the typed text (and the #76 chip
            // filter with it). This input's text is owned by
            // the app; its only clears are the app's own paths:
            // a commit, Escape, and the × button (#79).
            if (details.reason === "input-clear") return;
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
                    requestAnimationFrame(() =>
                      addRef.current?.focus({ preventScroll: true }),
                    );
                  }}
                >
                  <X className="size-4" />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          {/* Suggestions always open BELOW the input
              (improvement #78): with the default flip collision
              handling, the on-screen keyboard eats the space
              under the field and Base UI flips the popup up over
              the chip area, hiding the very tags the typing is
              filtering. collisionAvoidance side:none disables
              the flip middleware entirely; the popup instead
              shrinks to --available-height and the list scrolls
              internally. */}
          <ComboboxContent
            side="bottom"
            collisionAvoidance={{ side: "none" }}
          >
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
  );
}

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, Ellipsis, X } from "lucide-react";
import { cn } from "cn";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

// The weight editor (improvement #82, rehoused in #92): a
// Popover holding ONLY the weight slider — range −3..+3 in 0.05
// steps, applied live through setChipWeight; exactly 1.0 unwraps
// to a plain tag, and a tag inside a multi-tag section splits
// out at the new weight, with the Popover following it. A weight
// outside the slider's range shows its true value in the readout
// with the thumb pinned at the nearest end; opening the Popover
// never changes the weight on its own. The Popover's trigger is
// the chip's weight badge, which every non-raw chip renders
// since #92 (1 shown muted; the number carries no × prefix).
// Text editing left the Popover in #92:
// it is inline in the chip now (see the edit session in TagField
// below), and the suggestions that #60/#90 rendered inside the
// Popover render in flow under the editing chip instead.
function ChipWeightContent({
  chip,
  onSetWeight,
}: {
  chip: Chip;
  onSetWeight: (w: number) => void;
}) {
  // Plain tags carry no weight (null) and behave as 1.0.
  const weight = chip.weight ?? 1;
  return (
    <div>
      <Label className="mb-1.5 block text-sm font-medium text-muted-foreground">
        Weight{" "}
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {fmtWeight(weight)}
        </span>
      </Label>
      <Slider
        className="px-2"
        aria-label="Tag weight"
        value={[Math.min(3, Math.max(-3, weight))]}
        min={-3}
        max={3}
        step={0.05}
        onValueChange={(v) => onSetWeight(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}


// A prompt field edited ONLY through its tag chips (improvements #21,
// #28): the chips plus an inline "add tag" input with the
// suggestion combobox (#22, #54) are the whole editing UI — there is no
// free-text textarea anymore. Each chip is a joined pill —
// [badge][label][menu] for non-raw chips, [label][menu] for
// raw chunks. The trailing segment opens the chip menu (#89:
// Delete and, in character fields, Prefix). Tapping the label
// edits the text inline in the chip (#92; until then it opened
// an editor Popover, #50), and the weight badge — shown on every
// non-raw chip since #92 — opens the weight Popover holding
// the #82 slider, still the only weight control (the [−][+]
// step zones from #34 were removed in #83). The field's
// string value
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

  // Which chip's weight Popover is open, if any. Until #92 the
  // Popover held the whole chip editor; now it holds only the
  // weight slider, and text editing is inline in the chip (the
  // edit session below). Local to the field; the follow logic
  // below keeps it bound to the same tag when an edit splits a
  // section and indices shift.
  const [weightChip, setWeightChip] = useState<{
    seg: number;
    tag: number;
  } | null>(null);

  // --- Inline chip text editing (improvement #92) -------------------
  // Tapping a chip's label edits its text IN the chip: the label
  // segment is replaced by an input holding the draft below, and
  // the tag suggestions render in flow directly under the chip
  // (no floating overlay). Enter / ✓ / focus leaving commits
  // through applyText (the same setChipText path the old Popover
  // editor used, split-out included); Escape cancels; committing
  // empty text deletes the chip. The draft lives here, not in
  // the input, so a tap on another chip can commit this session
  // before starting that chip's.
  const [editChip, setEditChip] = useState<{
    seg: number;
    tag: number;
  } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);
  // Suggestions for the inline editor: the same relay data as
  // the add-tag input and the old Popover editor (#60) —
  // fetchTagSuggestions, 250 ms debounce, 2-char minimum, query
  // on the part after any prefix, stale responses dropped.
  const [editSuggestions, setEditSuggestions] = useState<TagSuggestion[]>(
    [],
  );
  // Whether the last completed edit query came back empty —
  // drives the list's no-results row. Cleared on any draft
  // change, so it never shows for a query not yet run.
  const [editNoResults, setEditNoResults] = useState(false);
  // Arrow-key highlight within the edit suggestions: Enter picks
  // the highlighted item ONLY after deliberate arrow navigation
  // (mirroring #54 / #90); a plain Enter commits the draft.
  const [editHighlight, setEditHighlight] = useState(-1);
  const editNavRef = useRef(false);
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const editAbortRef = useRef<AbortController | null>(null);
  const editQueryRef = useRef("");
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

  // If the chip whose weight Popover is open — or the chip
  // being edited inline — falls out of the filtered view, close
  // it: its anchor is no longer rendered.
  useEffect(() => {
    if (
      weightChip &&
      !visibleChips.some(
        (c) => c.seg === weightChip.seg && c.tag === weightChip.tag,
      )
    ) {
      setWeightChip(null);
    }
    if (
      editChip &&
      !visibleChips.some(
        (c) => c.seg === editChip.seg && c.tag === editChip.tag,
      )
    ) {
      setEditChip(null);
    }
  }, [visibleChips, weightChip, editChip]);

  // Focus the inline editor's input when a session starts, with
  // the cursor at the end of the chip's text (#92).
  useEffect(() => {
    if (!editChip) return;
    const el = editInputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const n = el.value.length;
    try {
      el.setSelectionRange(n, n);
    } catch {
      /* focus alone is enough if selection is rejected */
    }
  }, [editChip]);

  // Drop pending edit-suggestion work when the field unmounts.
  useEffect(
    () => () => {
      if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
      editAbortRef.current?.abort();
    },
    [],
  );

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
  // already holds a chip with this tag, ACTIVATE it (start
  // editing it inline, scrolled into view) instead of adding a duplicate;
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
      startEdit(existing);
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
    // activation leaves focus to the chip's inline editor instead). The
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

  // --- Chip weight edits (improvement #82) ---------------------------
  // The weight Popover's slider is the only weight control (the
  // chips' −/+ step zones from #34 were removed in #83). It sets
  // the weight absolutely through setChipWeight, live while
  // dragging, via this write + follow path. A tracked chip (the
  // weight Popover's anchor, or the inline edit session) is only
  // adjusted when indices move: the edited chip itself is
  // followed to its (possibly split-out) position so it stays
  // bound to the same tag, and a chip pointing into/after a
  // section that split is shifted to keep pointing at its tag.
  const followWeightEdit = (
    st: { seg: number; tag: number } | null,
    c: Chip,
    r: ReturnType<typeof setChipWeight>,
  ): { seg: number; tag: number } | null => {
    if (!st) return st;
    if (st.seg === c.seg && st.tag === c.tag) {
      return r.select ?? null;
    }
    if (r.segs.length !== segs.length) {
      if (st.seg === c.seg && st.tag > c.tag) {
        // Same section: the tracked tag stays in the remaining
        // section, one index earlier now that c.tag left it.
        return { seg: st.seg, tag: st.tag - 1 };
      }
      if (st.seg > c.seg) {
        return { seg: st.seg + 1, tag: st.tag };
      }
    }
    return st;
  };
  const applyWeightResult = (
    c: Chip,
    r: ReturnType<typeof setChipWeight>,
  ) => {
    if (r.segs === segs) return;
    onChange(serializePrompt(r.segs));
    setWeightChip((st) => followWeightEdit(st, c, r));
    setEditChip((st) => followWeightEdit(st, c, r));
  };
  const applyWeight = (c: Chip, w: number) => {
    applyWeightResult(c, setChipWeight(segs, c.seg, c.tag, w));
  };
  const applyText = (c: Chip, t: string) => {
    const r = setChipText(segs, c.seg, c.tag, t);
    if (r.segs !== segs) {
      onChange(serializePrompt(r.segs));
    }
    // Committing the draft ends the inline edit session (#92;
    // the Popover close of #66 before it) — it does not follow
    // the (possibly split-out) chip. Empty text deletes the
    // chip and ends the session as well, as it did before.
    clearEditSession();
  };

  // --- Inline edit session operations (improvement #92) -------------
  const editingChipObj = (): Chip | undefined =>
    editChip
      ? chips.find((c) => c.seg === editChip.seg && c.tag === editChip.tag)
      : undefined;

  const clearEditSession = () => {
    setEditChip(null);
    setEditDraft("");
    setEditSuggestions([]);
    setEditNoResults(false);
    setEditHighlight(-1);
    editNavRef.current = false;
    editQueryRef.current = "";
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    editAbortRef.current?.abort();
  };

  // Start editing a chip inline. A session already open on
  // another chip commits first (the input's blur normally beats
  // the tap to it and commits there; this keeps the rule in one
  // place). The weight Popover closes: the two never share a
  // chip session.
  const startEdit = (c: Chip) => {
    if (editChip && (editChip.seg !== c.seg || editChip.tag !== c.tag)) {
      commitEdit();
    }
    setWeightChip(null);
    setEditChip({ seg: c.seg, tag: c.tag });
    setEditDraft(c.text);
    setEditSuggestions([]);
    setEditNoResults(false);
    setEditHighlight(-1);
    editNavRef.current = false;
    editQueryRef.current = "";
  };

  const commitEdit = () => {
    const c = editingChipObj();
    if (!c) {
      clearEditSession();
      return;
    }
    applyText(c, editDraft);
  };

  const cancelEdit = () => {
    clearEditSession();
  };

  // A picked edit suggestion commits immediately (#65, kept
  // from the Popover editor): the picked name — with the
  // draft's prefix re-attached — goes through the same commit
  // as Enter, and the session ends.
  const pickEditSuggestion = (sg: TagSuggestion) => {
    const c = editingChipObj();
    if (!c) return;
    const { prefix: pre } = splitPrefix(editDraft);
    applyText(c, pre ? `${pre}#${sg.name}` : sg.name);
  };

  const runEditQuery = (text: string) => {
    if (!suggest) return;
    // A leading source#/target#/mutual# prefix is not part of
    // the tag being searched; it is re-attached when a
    // suggestion is picked — same handling as the add-tag
    // input (#22).
    const q = splitPrefix(text).rest;
    editQueryRef.current = q;
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    if (q.length < 2 || /[:{}[\]]/.test(q)) {
      setEditSuggestions([]);
      setEditNoResults(false);
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
          setEditNoResults(list.length === 0);
        }
      });
    }, 250);
  };

  const onEditDraftChange = (v: string) => {
    setEditDraft(v);
    editNavRef.current = false;
    setEditHighlight(-1);
    runEditQuery(v);
  };
  // Keep a tracked chip (the weight Popover's anchor, or the
  // inline edit session) pointing at the same tag across a
  // deletion: deleting a tag from a multi-tag section shifts
  // that section's later tags by one; deleting a section's only
  // chip removes the segment and shifts later segments by one;
  // deleting the tracked chip itself clears it.
  const followDelete = (
    st: { seg: number; tag: number } | null,
    c: Chip,
    segmentRemoved: boolean,
  ): { seg: number; tag: number } | null => {
    if (!st) return st;
    if (st.seg === c.seg && st.tag === c.tag) return null;
    if (!segmentRemoved) {
      if (st.seg === c.seg && st.tag > c.tag) {
        return { seg: st.seg, tag: st.tag - 1 };
      }
    } else if (st.seg > c.seg) {
      return { seg: st.seg - 1, tag: st.tag };
    }
    return st;
  };
  // Delete from the chip menu (improvement #89; its trigger
  // segment was the one-tap × from #80, and this is the only
  // delete path since the editor's own delete button was
  // removed in #84). Tracked chips follow the deletion via
  // followDelete; deleting the chip being edited ends its
  // session outright (draft included).
  const removeChip = (c: Chip) => {
    const segmentRemoved =
      chips.filter((o) => o.seg === c.seg).length <= 1;
    onChange(serializePrompt(deleteChip(segs, c.seg, c.tag)));
    setWeightChip((st) => followDelete(st, c, segmentRemoved));
    if (editChip && editChip.seg === c.seg && editChip.tag === c.tag) {
      clearEditSession();
    } else {
      setEditChip((st) => followDelete(st, c, segmentRemoved));
    }
  };
  const applyPrefix = (c: Chip, prefix: string | null) => {
    onChange(
      serializePrompt(setChipPrefix(segs, c.seg, c.tag, prefix)),
    );
  };

  // Weight Popover open-state routing for one chip. Base UI's
  // dismissal replaces the old hand-rolled outside-tap listener
  // (#36), with one exemption carried over from it: an outside
  // press that lands on one of THIS field's chips is vetoed — a
  // menu tap (Delete) must run removeChip's follow logic above
  // (which may shift or close the selection), a label tap starts
  // that chip's inline edit (which closes this Popover itself),
  // and a badge tap on another chip opens that chip's Popover
  // instead; none should be pre-empted by this popover closing.
  // Presses anywhere else (including other fields' chips) close it.
  const handleOpenChange =
    (c: Chip) =>
    (
      open: boolean,
      details: { reason: string; event: Event; cancel: () => void },
    ) => {
      if (open) {
        setWeightChip({ seg: c.seg, tag: c.tag });
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
      setWeightChip(null);
    };

  const weightContentFor = (c: Chip) => (
    <ChipWeightContent chip={c} onSetWeight={(w) => applyWeight(c, w)} />
  );

  // The chip's trailing segment is a menu trigger (improvement
  // #89; it was the one-tap × delete added in #80). The menu
  // holds Delete — the same removeChip path the × ran — and,
  // for non-raw chips in character fields only, the Prefix
  // radio group that used to live in the chip editor, wired to
  // the same applyPrefix path. The Prefix label renders inside
  // the RadioGroup: Base UI's GroupLabel throws (its error #31)
  // without a Menu.Group / Menu.RadioGroup context ancestor,
  // which kept the character-field menu from opening at all
  // (#91). Menu picks land outside the weight Popover, so a
  // Popover open on this chip closes through its normal
  // dismissal; removeChip's follow logic keeps any tracked
  // chip consistent.
  const chipMenu = (c: Chip) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Tag menu: ${c.text}`}
        className="flex w-stepper shrink-0 touch-manipulation items-center justify-center active:bg-accent"
      >
        <Ellipsis size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!!character && !c.raw && (
          <>
            <DropdownMenuRadioGroup
              value={splitPrefix(c.text).prefix ?? ""}
              onValueChange={(v) =>
                applyPrefix(
                  c,
                  typeof v === "string" && v !== "" ? v : null,
                )
              }
            >
              <DropdownMenuLabel>Prefix</DropdownMenuLabel>
              <DropdownMenuRadioItem value="">
                No prefix
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="source">
                source#
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="target">
                target#
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mutual">
                mutual#
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          variant="destructive"
          onClick={() => removeChip(c)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // React keys for the chips (improvement #82): keyed by chip
  // text + occurrence, NOT by segment/tag coordinates. A weight
  // edit that splits a section renumbers the coordinates of the
  // chips in it; with coordinate keys the open weight Popover
  // remounted on the split, killing the slider's drag after its
  // first step. Text keys survive the renumbering (a split never
  // changes the flattened chip order), so the Popover instance —
  // and an in-progress drag — stays alive and keeps adjusting
  // the same tag. (The data-chip-key attribute keeps the
  // coordinates: activation #76 and the outside-press veto
  // address chips by position.)
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
          const weightActive =
            !!weightChip && weightChip.seg === c.seg && weightChip.tag === c.tag;
          const editing =
            !!editChip && editChip.seg === c.seg && editChip.tag === c.tag;
          const active = weightActive || editing;
          const neg = (c.weight ?? 1) < 0;
          const weight = c.weight ?? 1;

          // The label segment — or, while this chip is being
          // edited, the inline editor (#92): an input holding
          // the draft, plus a ✓ segment that commits it. Enter
          // commits (or picks an arrow-highlighted suggestion),
          // Escape cancels, and the input losing focus commits —
          // see the edit session helpers above. While editing,
          // the pill takes the full row so the input has room.
          const labelOrEditor = editing ? (
            <>
              <span className="flex min-w-0 flex-1">
                <input
                  ref={editInputRef}
                  type="text"
                  value={editDraft}
                  aria-label="Tag text"
                  enterKeyHint="done"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => onEditDraftChange(e.target.value)}
                  onBlur={() => commitEdit()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      if (editNavRef.current && editHighlight >= 0) {
                        const sg = editSuggestions[editHighlight];
                        if (sg) {
                          pickEditSuggestion(sg);
                          return;
                        }
                      }
                      commitEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelEdit();
                    } else if (
                      e.key === "ArrowDown" ||
                      e.key === "ArrowUp"
                    ) {
                      if (editSuggestions.length === 0) return;
                      e.preventDefault();
                      editNavRef.current = true;
                      setEditHighlight((h) =>
                        e.key === "ArrowDown"
                          ? Math.min(editSuggestions.length - 1, h + 1)
                          : Math.max(0, h < 0 ? 0 : h - 1),
                      );
                    }
                  }}
                  className={cn(
                    "min-w-0 flex-1 bg-transparent px-3 text-tag leading-snug outline-none",
                    c.raw ? "py-1.5" : "h-full",
                  )}
                />
              </span>
              <button
                type="button"
                aria-label="Apply text"
                className="flex w-stepper shrink-0 touch-manipulation items-center justify-center active:bg-accent"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => commitEdit()}
              >
                <Check size={16} />
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={c.text}
              onClick={() => startEdit(c)}
              className={cn(
                "flex min-w-0 touch-manipulation items-center px-3 text-tag leading-snug",
                c.raw && "py-1.5",
              )}
            >
              <span className="truncate">{c.text}</span>
            </button>
          );

          // The weight badge (non-raw chips only): the weight
          // Popover's trigger, leading the pill since #92 —
          // mirroring NovelAI's own weight-first syntax
          // (1.3:: tag::) — and rendered on every chip
          // (1 shown muted) — before, the weight showed only on
          // already-weighted chips, inside the label.
          const badge = !c.raw ? (
            <PopoverTrigger
              aria-label={`Tag weight: ${c.text}`}
              className={cn(
                "flex shrink-0 touch-manipulation items-center px-2 text-tag-badge font-semibold active:bg-accent",
                neg
                  ? "text-err"
                  : weight === 1
                    ? "text-muted-foreground"
                    : "text-foreground",
              )}
            >
              {fmtWeight(weight)}
            </PopoverTrigger>
          ) : null;

          // The edit suggestions, in flow directly under the
          // editing chip (#92): a full-width row of the same
          // relay items the Popover editor showed (#60), capped
          // at three rows with internal scrolling (#85). A pick
          // commits immediately (#65); the pointer-down is
          // default-prevented so the input keeps focus until the
          // pick itself commits (its blur would commit the
          // draft first otherwise).
          const editList =
            editing &&
            !!suggest &&
            !c.raw &&
            (editSuggestions.length > 0 || editNoResults) ? (
              <div className="max-h-27 w-full overflow-y-auto rounded-md border border-border bg-background">
                {editNoResults ? (
                  <p className="px-3.5 py-3 text-suggest text-muted-foreground">
                    No suggestions
                  </p>
                ) : (
                  editSuggestions.map((sg, i) => (
                    <button
                      key={sg.name}
                      type="button"
                      className={cn(
                        "flex min-h-tap w-full items-center px-3.5 text-left",
                        i === editHighlight && "bg-accent",
                      )}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        pickEditSuggestion(sg);
                      }}
                    >
                      <span className="text-suggest">{sg.name}</span>
                      {sg.mine > 0 ? (
                        <span className="ml-auto text-xs font-medium text-primary">
                          Frequently Used
                        </span>
                      ) : sg.count !== null ? (
                        <span className="ml-auto text-tag-badge text-muted-foreground">
                          {fmtCount(sg.count)}
                        </span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            ) : null;

          if (c.raw) {
            // Raw chunks (brace/bracket syntax) have no weight:
            // the pill is [label][menu] — the label tap edits
            // the text inline (#92), and the trailing segment
            // opens the chip menu (#89).
            return (
              <Fragment key={chipReactKeys.get(c)}>
                <div
                  role="group"
                  data-chip
                  data-chip-key={`${c.seg}:${c.tag}`}
                  aria-label={c.text}
                  className={cn(
                    "inline-flex max-w-full items-stretch divide-x divide-border overflow-hidden rounded-full border border-dashed text-muted-foreground select-none",
                    editing && "w-full",
                    active && "border-primary ring-1 ring-primary",
                  )}
                >
                  {labelOrEditor}
                  {chipMenu(c)}
                </div>
                {editList}
              </Fragment>
            );
          }
          // Non-raw chips are a joined [badge][label][menu]
          // pill: the badge opens the weight Popover (#82
          // slider), the label tap edits the text inline (#92),
          // and the trailing segment opens the chip menu (#89).
          // Hand-rolled rather than shadcn's ButtonGroup: that
          // component styles each button's own border and corner
          // radius, which fights this single-pill design (one
          // container border, group-wide active/negative states,
          // truncating label).
          return (
            <Fragment key={chipReactKeys.get(c)}>
              <Popover
                open={weightActive}
                onOpenChange={handleOpenChange(c)}
              >
                <div
                  role="group"
                  data-chip
                  data-chip-key={`${c.seg}:${c.tag}`}
                  aria-label={c.text}
                  className={cn(
                    "inline-flex h-tap max-w-full items-stretch divide-x overflow-hidden rounded-full border bg-card select-none",
                    neg
                      ? "divide-err/30 border-err/50 text-err"
                      : "divide-border border-border",
                    editing && "w-full",
                    active && "border-primary ring-1 ring-primary",
                  )}
                >
                  {badge}
                  {labelOrEditor}
                  {chipMenu(c)}
                </div>
                <PopoverContent
                  sideOffset={6}
                  className="w-[min(320px,90vw)]"
                >
                  {weightContentFor(c)}
                </PopoverContent>
              </Popover>
              {editList}
            </Fragment>
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

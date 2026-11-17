import { useMemo, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface Props {
  id?: string;
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
}

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// A prompt textarea with a tag chip editor under it (improvement #21)
// and a tag suggestion strip while typing (improvement #22). The
// textarea text is the single source of truth: chips are derived from
// the current value on every render, and chip edits rewrite the value
// through the same setter the textarea uses, so persistence and
// generation payloads are untouched.
export function TagField({
  id,
  value,
  onChange,
  placeholder,
  className,
  character,
  suggest,
  model,
}: Props) {
  const [sel, setSel] = useState<{ seg: number; tag: number } | null>(null);
  const segs = useMemo(() => parsePrompt(value), [value]);
  const chips = useMemo(() => listChips(segs), [segs]);
  const selChip = sel
    ? chips.find((c) => c.seg === sel.seg && c.tag === sel.tag)
    : undefined;
  const effWeight = selChip ? (selChip.weight ?? 1) : 1;

  // --- Suggestions ------------------------------------------------------
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const elRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef("");

  const scheduleSuggest = (text: string, cursor: number) => {
    if (!suggest) return;
    const token = findToken(text, cursor);
    queryRef.current = token.query;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (token.query.length < 2 || /[:{}[\]]/.test(token.query)) {
      setSuggestions([]);
      return;
    }
    const q = token.query;
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
        if (queryRef.current === q) setSuggestions(list.slice(0, 8));
      });
    }, 250);
  };

  const applySuggestion = (s: TagSuggestion) => {
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

  // --- Chip editor --------------------------------------------------------
  const applyWeight = (w: number) => {
    if (!selChip) return;
    const r = setChipWeight(segs, selChip.seg, selChip.tag, w);
    if (r.segs !== segs) {
      onChange(serializePrompt(r.segs));
      if (r.select) setSel(r.select);
    }
  };
  const applyDelete = () => {
    if (!selChip) return;
    onChange(serializePrompt(deleteChip(segs, selChip.seg, selChip.tag)));
    setSel(null);
  };
  const applyPrefix = (prefix: string | null) => {
    if (!selChip) return;
    onChange(
      serializePrompt(setChipPrefix(segs, selChip.seg, selChip.tag, prefix)),
    );
  };

  return (
    <div>
      <Textarea
        id={id}
        placeholder={placeholder}
        className={className}
        value={value}
        onChange={(e) => {
          elRef.current = e.currentTarget;
          onChange(e.target.value);
          // Indices may shift under a manual edit; drop the selection
          // rather than risk acting on the wrong tag.
          setSel(null);
          scheduleSuggest(e.target.value, e.currentTarget.selectionStart ?? 0);
        }}
        onSelect={(e) => {
          elRef.current = e.currentTarget;
          scheduleSuggest(value, e.currentTarget.selectionStart ?? 0);
        }}
        onKeyUp={(e) => {
          elRef.current = e.currentTarget;
          scheduleSuggest(value, e.currentTarget.selectionStart ?? 0);
        }}
        onClick={(e) => {
          elRef.current = e.currentTarget;
        }}
        onBlur={() => {
          // Small delay so a tap on a suggestion lands first (the
          // buttons also preventDefault on pointer down).
          setTimeout(() => setSuggestions([]), 150);
        }}
      />

      {suggestions.length > 0 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {suggestions.map((s) => (
            <button
              key={s.name}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                applySuggestion(s);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs whitespace-nowrap"
            >
              <span>{s.name}</span>
              {s.mine > 0 ? (
                <span className="font-medium text-primary">よく使う</span>
              ) : s.count !== null ? (
                <span className="text-muted-foreground">
                  {fmtCount(s.count)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const active = !!sel && sel.seg === c.seg && sel.tag === c.tag;
            const neg = (c.weight ?? 1) < 0;
            return (
              <button
                key={`${c.seg}:${c.tag}`}
                type="button"
                onClick={() => setSel(active ? null : { seg: c.seg, tag: c.tag })}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
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
                      "shrink-0 font-semibold",
                      neg ? "text-err" : "text-muted-foreground",
                    )}
                  >
                    ×{fmtWeight(c.weight)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selChip && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card p-2">
          <span className="max-w-[140px] truncate text-xs text-muted-foreground">
            {selChip.text}
          </span>
          {selChip.raw ? (
            <span className="text-[11px] text-muted-foreground">
              括弧などの記法は直接編集してください
            </span>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-2 text-xs"
                onClick={() => applyWeight(effWeight - 0.1)}
              >
                −0.1
              </Button>
              <span className="min-w-9 text-center text-sm font-semibold">
                ×{fmtWeight(effWeight)}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-2 text-xs"
                onClick={() => applyWeight(effWeight + 0.1)}
              >
                +0.1
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-2 text-xs"
                onClick={() =>
                  applyWeight(effWeight === 0 ? -1 : -effWeight)
                }
              >
                {effWeight > 0 ? "マイナス化" : "プラス化"}
              </Button>
              {character && (
                <select
                  aria-label="接頭辞"
                  value={splitPrefix(selChip.text).prefix ?? ""}
                  onChange={(e) =>
                    applyPrefix(e.target.value === "" ? null : e.target.value)
                  }
                  className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"
                >
                  <option value="">接頭辞なし</option>
                  <option value="source">source#</option>
                  <option value="target">target#</option>
                  <option value="mutual">mutual#</option>
                </select>
              )}
            </>
          )}
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            aria-label="このタグを削除"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={applyDelete}
          >
            <Trash2 size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label="タグ編集を閉じる"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={() => setSel(null)}
          >
            <X size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

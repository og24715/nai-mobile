import { useEffect, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { fmtWeight } from "@/lib/promptTags";
import type { ChipEditorState } from "@/components/TagField";

// The shared chip editor bar (improvements #21 + #26 + #28).
// GenerateForm renders exactly one of these, stuck to the bottom of
// the form drawer, whenever any TagField reports a selected chip —
// so the controls are always reachable without scrolling, no matter
// how many tags the field has. All actions delegate back to the
// owning field through the ChipEditorState snapshot.
//
// Since #28 removed free-text editing, the bar's top row is a text
// field holding the chip's own text: Enter or ✓ applies it through
// setChipText (in place for plain/single-tag chips, split-out for a
// tag inside a multi-tag section, verbatim body replacement for raw
// chunks; empty text deletes the chip). Raw chunks get ONLY that row
// — no weight stepper or prefix selector. There is no sign-flip
// button (#33): the ±0.1 stepper moves the signed weight linearly
// across zero (0.1 -> 0 -> -0.1 ...), so negative weights are
// reached by stepping down.
export function ChipEditorBar({ editor }: { editor: ChipEditorState }) {
  const effWeight = editor.weight;
  const [draft, setDraft] = useState(editor.text);
  // Re-seed the draft when a different chip is selected (or the same
  // chip's text changed through another action). Typing never touches
  // editor.text, so this does not fight the user's input.
  useEffect(() => {
    setDraft(editor.text);
  }, [editor.fieldId, editor.text]);

  const applyText = () => editor.onText(draft);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          aria-label="タグのテキスト"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyText();
            }
          }}
          className="h-tap min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-tag outline-none focus:border-primary"
        />
        <Button
          type="button"
          variant="secondary"
          aria-label="テキストを適用"
          className="h-tap w-tap shrink-0 p-0"
          onClick={applyText}
        >
          <Check size={18} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="このタグを削除"
          className="h-tap w-tap shrink-0 p-0 text-muted-foreground"
          onClick={editor.onDelete}
        >
          <Trash2 size={16} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="タグ編集を閉じる"
          className="h-tap w-tap shrink-0 p-0 text-muted-foreground"
          onClick={editor.onClose}
        >
          <X size={16} />
        </Button>
      </div>
      {!editor.raw && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="h-tap px-3 text-sm"
            onClick={() => editor.onWeight(effWeight - 0.1)}
          >
            −0.1
          </Button>
          <span
            className={cn(
              "min-w-11 text-center text-tag font-semibold",
              effWeight < 0 && "text-err",
            )}
          >
            ×{fmtWeight(effWeight)}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="h-tap px-3 text-sm"
            onClick={() => editor.onWeight(effWeight + 0.1)}
          >
            +0.1
          </Button>
          {editor.character && (
            <select
              aria-label="接頭辞"
              value={editor.prefix ?? ""}
              onChange={(e) =>
                editor.onPrefix(e.target.value === "" ? null : e.target.value)
              }
              className="h-tap rounded-md border border-input bg-background px-1.5 text-sm"
            >
              <option value="">接頭辞なし</option>
              <option value="source">source#</option>
              <option value="target">target#</option>
              <option value="mutual">mutual#</option>
            </select>
          )}
        </div>
      )}
    </div>
  );
}

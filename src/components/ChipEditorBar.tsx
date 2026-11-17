import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { fmtWeight } from "@/lib/promptTags";
import type { ChipEditorState } from "@/components/TagField";

// The shared chip editor bar (improvements #21 + #26). GenerateForm
// renders exactly one of these, stuck to the bottom of the form
// drawer, whenever any TagField reports a selected chip — so the
// weight controls are always reachable without scrolling, no matter
// how many tags the field has. All actions delegate back to the
// owning field through the ChipEditorState snapshot.
export function ChipEditorBar({ editor }: { editor: ChipEditorState }) {
  const effWeight = editor.weight;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="max-w-[110px] truncate text-sm text-muted-foreground">
        {editor.text}
      </span>
      {editor.raw ? (
        <span className="text-xs text-muted-foreground">
          括弧などの記法は「テキストで編集」から編集してください
        </span>
      ) : (
        <>
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
          <Button
            type="button"
            variant="secondary"
            className="h-tap px-3 text-sm"
            onClick={() => editor.onWeight(effWeight === 0 ? -1 : -effWeight)}
          >
            {effWeight > 0 ? "マイナス化" : "プラス化"}
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
        </>
      )}
      <span className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        aria-label="このタグを削除"
        className="h-tap w-tap p-0 text-muted-foreground"
        onClick={editor.onDelete}
      >
        <Trash2 size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        aria-label="タグ編集を閉じる"
        className="h-tap w-tap p-0 text-muted-foreground"
        onClick={editor.onClose}
      >
        <X size={16} />
      </Button>
    </div>
  );
}

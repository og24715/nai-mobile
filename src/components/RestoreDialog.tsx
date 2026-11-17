import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";
import { MODELS, SAMPLERS, SIZES } from "@/lib/options";
import type { RestoredForm } from "@/lib/pngSettings";

// Which restore groups the user chose to apply (improvement #31).
export interface RestoreSelection {
  prompt: boolean;
  negative: boolean;
  chars: boolean;
  settings: boolean;
  seed: boolean;
}

interface Props {
  // The parsed + mapped form values from the picked image, or null
  // when no restore is pending. A fresh object per restore resets
  // the checkbox defaults below.
  restored: RestoredForm | null;
  onApply: (sel: RestoreSelection) => void;
  onCancel: () => void;
}

const snippet = (s: string, n = 60) =>
  s.length > n ? s.slice(0, n) + "…" : s;

function settingsSummary(r: RestoredForm): string {
  const parts: string[] = [];
  if (r.model) {
    parts.push(MODELS.find((m) => m.value === r.model)?.label ?? r.model);
  }
  if (r.size) {
    parts.push(SIZES.find((s) => s.value === r.size)?.label ?? r.size);
  }
  if (r.steps) parts.push(`steps ${r.steps}`);
  if (r.scale) parts.push(`scale ${r.scale}`);
  if (r.sampler) {
    parts.push(SAMPLERS.find((s) => s.value === r.sampler)?.label ?? r.sampler);
  }
  return parts.join(" / ");
}

interface GroupDef {
  key: keyof RestoreSelection;
  label: string;
  present: boolean;
  preview: string;
}

function groupsOf(r: RestoredForm): GroupDef[] {
  const hasSettings =
    r.model !== undefined ||
    r.size !== undefined ||
    r.steps !== undefined ||
    r.scale !== undefined ||
    r.sampler !== undefined;
  return [
    {
      key: "prompt",
      label: "プロンプト",
      present: r.prompt !== undefined,
      preview: r.prompt !== undefined ? snippet(r.prompt) : "",
    },
    {
      key: "negative",
      label: "ネガティブ",
      present: r.negative !== undefined,
      preview: r.negative !== undefined ? snippet(r.negative) : "",
    },
    {
      key: "chars",
      label: "キャラクター",
      present: r.chars !== undefined,
      preview:
        r.chars !== undefined
          ? `${r.chars.length}件` +
            (r.chars[0]?.prompt ? `: ${snippet(r.chars[0].prompt)}` : "")
          : "",
    },
    {
      key: "settings",
      label: "基本設定",
      present: hasSettings,
      preview: hasSettings ? settingsSummary(r) : "",
    },
    {
      key: "seed",
      label: "seed",
      present: r.seed !== undefined,
      preview: r.seed ?? "",
    },
  ];
}

// Selective restore (improvement #31): after a device image is
// parsed, the user picks which setting groups to import instead of
// applying everything at once. Defaults: everything present is ON
// except seed (restoring a seed unintentionally reproduces the same
// image, so it is opt-in). Groups the image does not contain are
// shown disabled with a 「なし」 note. Cancelling changes nothing.
export function RestoreDialog({ restored, onApply, onCancel }: Props) {
  const [sel, setSel] = useState<RestoreSelection>({
    prompt: true,
    negative: true,
    chars: true,
    settings: true,
    seed: false,
  });
  // Fresh defaults for every new restore (MainPage hands us a new
  // RestoredForm object each time a file is picked).
  useEffect(() => {
    if (restored) {
      setSel({
        prompt: true,
        negative: true,
        chars: true,
        settings: true,
        seed: false,
      });
    }
  }, [restored]);

  const groups = restored ? groupsOf(restored) : [];

  return (
    <Dialog
      open={restored !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl">画像から復元</DialogTitle>
          <DialogDescription>
            取り込む項目を選んでください。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {groups.map((g) => (
            <label
              key={g.key}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2",
                !g.present && "cursor-default opacity-50",
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={g.present && sel[g.key]}
                disabled={!g.present}
                onChange={(e) =>
                  setSel((prev) => ({ ...prev, [g.key]: e.target.checked }))
                }
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {g.label}
                  {!g.present && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      なし
                    </span>
                  )}
                </span>
                {g.present && g.preview && (
                  <span className="block text-sm break-words whitespace-pre-wrap text-muted-foreground">
                    {g.preview}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="button" onClick={() => onApply(sel)}>
            取り込む
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODELS } from "@/lib/options";

interface Props {
  open: boolean;
  // The form's currently selected model. It is the dialog's
  // default when it is one of the V5 models; otherwise V5 Full.
  defaultModel: string;
  onExecute: (model: string, blurSigma: number) => void;
  onCancel: () => void;
}

// The standalone upscaler accepts only the V5 models.
const V5_MODELS = MODELS.filter((m) => m.value.startsWith("nai-diffusion-5"));

// declared_blur_sigma takes only these discrete values. The
// select works in strings; labels show the two-decimal form the
// official client uses.
const BLUR_SIGMAS = [
  { value: "0", label: "0" },
  { value: "0.3", label: "0.30" },
  { value: "0.35", label: "0.35" },
  { value: "0.4", label: "0.40" },
  { value: "0.45", label: "0.45" },
  { value: "0.5", label: "0.50" },
];

const labelCls = "mb-1.5 block text-sm font-medium text-muted-foreground";

// Upscale parameters (improvement #41): the hero context menu's
// アップスケール item opens this dialog instead of firing at
// once. Choices are per-run only — nothing is persisted.
export function UpscaleDialog({ open, defaultModel, onExecute, onCancel }: Props) {
  const [model, setModel] = useState("nai-diffusion-5-full");
  const [sigma, setSigma] = useState("0");

  // Fresh defaults every time the dialog opens.
  useEffect(() => {
    if (open) {
      setModel(
        V5_MODELS.some((m) => m.value === defaultModel)
          ? defaultModel
          : "nai-diffusion-5-full",
      );
      setSigma("0");
    }
  }, [open, defaultModel]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl">アップスケール</DialogTitle>
          <DialogDescription>
            V5専用（V4.5以下は非対応）
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-[18px]">
          <div>
            <Label className={labelCls}>モデル</Label>
            <Select
              items={V5_MODELS}
              value={model}
              onValueChange={(v) => v && setModel(v)}
            >
              <SelectTrigger className="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {V5_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className={labelCls}>ブラーシグマ</Label>
            <Select
              items={BLUR_SIGMAS}
              value={sigma}
              onValueChange={(v) => v && setSigma(v)}
            >
              <SelectTrigger className="h-11 w-full text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BLUR_SIGMAS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={() => onExecute(model, Number(sigma))}
          >
            アップスケール
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

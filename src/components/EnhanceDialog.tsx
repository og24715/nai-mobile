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
import { Slider } from "@/components/ui/slider";
import { cn } from "cn";

export type EnhanceScale = number | "max";

interface Props {
  open: boolean;
  // Natural size of the hero image the enhance will run on.
  sourceWidth: number;
  sourceHeight: number;
  // The form's currently selected model — MAX is a V5-only mode,
  // offered only when this is a V5 model.
  formModel: string;
  onExecute: (scale: EnhanceScale, strength: number, noise: number) => void;
  onCancel: () => void;
}

// Official scale rule: a numeric scale is offered only if the
// scaled size (each dimension rounded to a multiple of 64) stays
// within the total-pixel cap. MAX (upscaled_enhance) is offered
// only for V5 models on sources below 0.8 × the cap.
const PX_CAP = 3_145_728;
const MAX_SRC_LIMIT = 2_516_582;
const round64 = (n: number) => Math.max(64, Math.round(n / 64) * 64);

function numericScales(w: number, h: number): number[] {
  if (!w || !h) return [1];
  return [2, 1.5, 1].filter(
    (s) => round64(w * s) * round64(h * s) <= PX_CAP,
  );
}

const labelCls = "mb-1.5 block text-sm font-medium text-muted-foreground";
const chipCls = (selected: boolean) =>
  cn(
    "cursor-pointer rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
    selected
      ? "border-primary bg-primary text-primary-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );

// Enhance parameters (improvement #42): scale chips computed
// from the hero's natural size, plus strength / noise sliders.
// The server rebuilds the generation from the source image's own
// stored parameters — the form's prompt/settings play no part.
// Choices are per-run only — nothing is persisted.
export function EnhanceDialog({
  open,
  sourceWidth,
  sourceHeight,
  formModel,
  onExecute,
  onCancel,
}: Props) {
  const scales = numericScales(sourceWidth, sourceHeight);
  const maxAvailable =
    formModel.startsWith("nai-diffusion-5") &&
    sourceWidth > 0 &&
    sourceWidth * sourceHeight < MAX_SRC_LIMIT;

  const [scaleSel, setScaleSel] = useState<EnhanceScale>(1);
  const [strength, setStrength] = useState(0.5);
  const [noise, setNoise] = useState(0);

  // Fresh defaults every time the dialog opens: the largest
  // numeric scale, strength 0.5, noise 0 (MAX is never the
  // default).
  useEffect(() => {
    if (open) {
      setScaleSel(scales[0] ?? 1);
      setStrength(0.5);
      setNoise(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceWidth, sourceHeight]);

  const sizePreview =
    scaleSel === "max"
      ? "Auto maximize (V5 only)"
      : `${round64(sourceWidth * scaleSel)} × ${round64(sourceHeight * scaleSel)}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl">Enhance</DialogTitle>
          <DialogDescription>
            Regenerates with the source image's own prompt settings. Uses Anlas.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-[18px]">
          <div>
            <Label className={labelCls}>Scale</Label>
            <div className="flex flex-wrap gap-2">
              {scales.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={chipCls(scaleSel === s)}
                  onClick={() => setScaleSel(s)}
                >
                  {s}x
                </button>
              ))}
              {maxAvailable && (
                <button
                  type="button"
                  className={chipCls(scaleSel === "max")}
                  onClick={() => setScaleSel("max")}
                >
                  MAX
                </button>
              )}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {sizePreview}
            </div>
          </div>

          {/* Sliders stacked vertically, one full-width row each
              (the standing mobile rule). */}
          <div>
            <Label className={labelCls}>
              Strength{" "}
              <span className="text-lg font-semibold tabular-nums text-foreground">
                {strength.toFixed(2)}
              </span>
            </Label>
            <Slider
              value={[strength]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) =>
                setStrength(Array.isArray(v) ? v[0] : v)
              }
            />
          </div>

          <div>
            <Label className={labelCls}>
              Noise{" "}
              <span className="text-lg font-semibold tabular-nums text-foreground">
                {noise.toFixed(2)}
              </span>
            </Label>
            <Slider
              value={[noise]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) => setNoise(Array.isArray(v) ? v[0] : v)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onExecute(scaleSel, strength, noise)}
          >
            Enhance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

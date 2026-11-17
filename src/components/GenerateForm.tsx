import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { MODELS, SAMPLERS, SIZES } from "@/lib/options";
import { MAX_CHARS, type CharPrompt } from "@/hooks/useCharacters";

export interface FormState {
  prompt: string;
  negative: string;
  model: string;
  size: string;
  steps: string;
  scale: string;
  sampler: string;
  seed: string;
  chars: CharPrompt[];
  setPrompt: (v: string) => void;
  setNegative: (v: string) => void;
  setModel: (v: string) => void;
  setSize: (v: string) => void;
  setSteps: (v: string) => void;
  setScale: (v: string) => void;
  setSampler: (v: string) => void;
  setSeed: (v: string) => void;
  updateChars: (next: CharPrompt[]) => void;
}

const labelCls = "mb-1.5 block text-[13px] font-normal text-muted-foreground";

function numOr(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// The whole generation form. Rendered inside the full-screen modal;
// every field auto-saves to localStorage on change, so the ▶ FAB can
// generate from these values without the modal being open.
export function GenerateForm({ form }: { form: FormState }) {
  const stepsNum = numOr(form.steps, 28);
  const scaleNum = numOr(form.scale, 5);
  // On Opus, generations are free up to 28 steps; past that they
  // consume Anlas. The steps UI turns amber as the warning signal.
  const stepsOver = stepsNum > 28;

  const setChar = (i: number, patch: Partial<CharPrompt>) =>
    form.updateChars(form.chars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeChar = (i: number) =>
    form.updateChars(form.chars.filter((_, j) => j !== i));
  const addChar = () => {
    if (form.chars.length < MAX_CHARS) {
      form.updateChars([...form.chars, { prompt: "", negative: "" }]);
    }
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <Label htmlFor="prompt" className={labelCls}>
          プロンプト
        </Label>
        <Textarea
          id="prompt"
          placeholder="1girl, ..."
          className="min-h-[84px] text-base"
          value={form.prompt}
          onChange={(e) => form.setPrompt(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="negative" className={labelCls}>
          ネガティブ (UC)
        </Label>
        <Textarea
          id="negative"
          className="min-h-[56px] text-base"
          value={form.negative}
          onChange={(e) => form.setNegative(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className={labelCls}>モデル</Label>
          <Select
            items={MODELS}
            value={form.model}
            onValueChange={(v) => v && form.setModel(v)}
          >
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className={labelCls}>サイズ</Label>
          <Select
            items={SIZES}
            value={form.size}
            onValueChange={(v) => v && form.setSize(v)}
          >
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Sliders are always stacked vertically, one full-width row
          each — never side by side (hard to operate on a phone). */}
      <div>
        <Label className={labelCls}>
          Steps{" "}
          <span
            className={cn(
              "font-semibold text-foreground",
              stepsOver && "text-amber-500",
            )}
          >
            {Math.round(stepsNum)}
          </span>
          {stepsOver && (
            <span className="ml-1.5 text-[11px] font-medium text-amber-500">
              Anlas消費
            </span>
          )}
        </Label>
        <Slider
          value={[stepsNum]}
          min={1}
          max={50}
          step={1}
          className={cn(
            stepsOver &&
              "[&_[data-slot=slider-range]]:bg-amber-500 [&_[data-slot=slider-thumb]]:border-amber-500",
          )}
          onValueChange={(v) => form.setSteps(String(Array.isArray(v) ? v[0] : v))}
        />
      </div>

      <div>
        <Label className={labelCls}>
          Scale (CFG) <span className="font-semibold text-foreground">{scaleNum.toFixed(1)}</span>
        </Label>
        <Slider
          value={[scaleNum]}
          min={0}
          max={20}
          step={0.1}
          onValueChange={(v) => form.setScale(String(Array.isArray(v) ? v[0] : v))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className={labelCls}>Sampler</Label>
          <Select
            items={SAMPLERS}
            value={form.sampler}
            onValueChange={(v) => v && form.setSampler(v)}
          >
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SAMPLERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="seed" className={labelCls}>
            Seed（空=ランダム）
          </Label>
          <Input
            id="seed"
            type="number"
            placeholder="random"
            className="h-11 text-base"
            value={form.seed}
            onChange={(e) => form.setSeed(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label className={labelCls}>キャラクタープロンプト（V4以降）</Label>
        {form.chars.map((c, i) => (
          <div key={i} className="mt-4 rounded-xl border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">キャラ{i + 1}</span>
              <Button
                type="button"
                variant="secondary"
                aria-label={`キャラ${i + 1}を削除`}
                onClick={() => removeChar(i)}
                className="h-9 w-9 rounded-full border border-border p-0 text-base"
              >
                ×
              </Button>
            </div>
            <Label className={`${labelCls} mt-2`}>プロンプト</Label>
            <Textarea
              className="min-h-[48px] text-base"
              value={c.prompt}
              onChange={(e) => setChar(i, { prompt: e.target.value })}
            />
            <Label className={`${labelCls} mt-[18px]`}>ネガティブ</Label>
            <Input
              className="text-base"
              value={c.negative}
              onChange={(e) => setChar(i, { negative: e.target.value })}
            />
          </div>
        ))}
        {form.chars.length < MAX_CHARS && (
          <Button
            type="button"
            variant="secondary"
            onClick={addChar}
            className="mt-6 h-[52px] w-full rounded-full border border-border text-base"
          >
            ＋ キャラ追加
          </Button>
        )}
      </div>
    </div>
  );
}

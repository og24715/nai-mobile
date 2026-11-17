import { useCallback, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import {
  TagField,
  type ChipEditorState,
  type ChipSel,
} from "@/components/TagField";
import { ChipEditorBar } from "@/components/ChipEditorBar";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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

const labelCls = "mb-1.5 block text-sm font-medium text-muted-foreground";

function numOr(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Accordion sections in the form modal, collapsible by category so the
// modal needs less scrolling. The open set persists in localStorage
// under "nai.accordion" (JSON array of section values); first-ever use
// opens only the prompt section.
const SECTION_VALUES = ["prompt", "settings", "characters"] as const;

function loadOpenSections(): string[] {
  try {
    const raw = localStorage.getItem("nai.accordion");
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (v): v is string =>
            typeof v === "string" &&
            (SECTION_VALUES as readonly string[]).includes(v),
        );
      }
    }
  } catch {
    // Corrupt value — fall through to the default.
  }
  return ["prompt"];
}

const sectionContentCls = "flex flex-col gap-[18px] pt-1 pb-2";

// The whole generation form. Rendered inside the bottom drawer;
// every field auto-saves to localStorage on change, so the ▶ FAB can
// generate from these values without the sheet being open.
export function GenerateForm({ form }: { form: FormState }) {
  const stepsNum = numOr(form.steps, 28);
  const scaleNum = numOr(form.scale, 5);
  // On Opus, generations are free up to 28 steps; past that they
  // consume Anlas. The steps UI turns amber as the warning signal.
  const stepsOver = stepsNum > 28;

  const [openSections, setOpenSections] = useState<string[]>(loadOpenSections);
  const toggleSections = (next: string[]) => {
    setOpenSections(next);
    try {
      localStorage.setItem("nai.accordion", JSON.stringify(next));
    } catch {
      // Storage unavailable — the in-memory state still applies.
    }
  };

  // --- Lifted chip selection + shared editor bar (improvement #26) ----
  // The selected chip lives here, not inside TagField, so ONE editor
  // bar can be rendered stuck to the bottom of the drawer scroll area:
  // with many tags the editor controls stay reachable without
  // scrolling to the field's own inline bar. Each TagField reports a
  // ChipEditorState snapshot for its selected chip; re-reports whose
  // display fields are unchanged are ignored (the snapshot's actions
  // delegate to the field's latest closures, so it never goes stale).
  const [activeChip, setActiveChip] = useState<
    ({ fieldId: string } & ChipSel) | null
  >(null);
  const [chipEditor, setChipEditor] = useState<ChipEditorState | null>(null);

  const handleChipSelect = useCallback(
    (fieldId: string, sel: ChipSel | null) => {
      setActiveChip(sel ? { fieldId, seg: sel.seg, tag: sel.tag } : null);
      if (!sel) {
        setChipEditor((prev) =>
          prev && prev.fieldId === fieldId ? null : prev,
        );
      }
    },
    [],
  );
  const handleChipEditor = useCallback(
    (fieldId: string, ed: ChipEditorState | null) => {
      setChipEditor((prev) => {
        if (!ed) return prev && prev.fieldId === fieldId ? null : prev;
        if (
          prev &&
          prev.fieldId === ed.fieldId &&
          prev.text === ed.text &&
          prev.raw === ed.raw &&
          prev.character === ed.character &&
          prev.prefix === ed.prefix
        ) {
          return prev;
        }
        return ed;
      });
    },
    [],
  );
  const chipProps = (fieldId: string) => ({
    fieldId,
    chipSelection:
      activeChip && activeChip.fieldId === fieldId
        ? { seg: activeChip.seg, tag: activeChip.tag }
        : null,
    onChipSelect: handleChipSelect,
    onChipEditor: handleChipEditor,
  });

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
    <div className={chipEditor ? "pb-36" : undefined}>
    <Accordion multiple value={openSections} onValueChange={toggleSections}>
      <AccordionItem value="prompt">
        <AccordionTrigger className="py-3.5 text-xl font-semibold">
          プロンプト
        </AccordionTrigger>
        <AccordionContent>
          <div className={sectionContentCls}>
            {/* Positive / negative are tabs, like the official client:
                the negative prompt is rarely edited, so it lives one
                tap away instead of taking vertical space. Both fields
                stay controlled from the lifted form state, so switching
                tabs never loses either text. */}
            <Tabs defaultValue="positive">
              <TabsList className="h-10 w-full">
                <TabsTrigger value="positive">ポジティブ</TabsTrigger>
                <TabsTrigger value="negative">ネガティブ</TabsTrigger>
              </TabsList>
              <TabsContent value="positive">
                <TagField
                  suggest
                  model={form.model}
                  value={form.prompt}
                  onChange={form.setPrompt}
                  {...chipProps("prompt")}
                />
              </TabsContent>
              <TabsContent value="negative">
                <TagField
                  suggest
                  model={form.model}
                  value={form.negative}
                  onChange={form.setNegative}
                  {...chipProps("negative")}
                />
              </TabsContent>
            </Tabs>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="settings">
        <AccordionTrigger className="py-3.5 text-xl font-semibold">
          基本設定
        </AccordionTrigger>
        <AccordionContent>
          <div className={sectionContentCls}>
            {/* Basic settings are a single full-width column —
                every field stacked vertically, never side by side. */}
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

            {/* Sliders are always stacked vertically, one full-width row
                each — never side by side (hard to operate on a phone). */}
            <div>
              <Label className={labelCls}>
                Steps{" "}
                <span
                  className={cn(
                    "text-lg font-semibold tabular-nums text-foreground",
                    stepsOver && "text-amber-500",
                  )}
                >
                  {Math.round(stepsNum)}
                </span>
                {stepsOver && (
                  <span className="ml-1.5 text-xs font-medium text-amber-500">
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
                Scale (CFG) <span className="text-lg font-semibold tabular-nums text-foreground">{scaleNum.toFixed(1)}</span>
              </Label>
              <Slider
                value={[scaleNum]}
                min={0}
                max={20}
                step={0.1}
                onValueChange={(v) => form.setScale(String(Array.isArray(v) ? v[0] : v))}
              />
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
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="characters">
        <AccordionTrigger className="py-3.5 text-xl font-semibold">
          キャラクター
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            （V4以降）
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="pb-2">
            {form.chars.map((c, i) => (
              <div key={i} className="mt-4 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">キャラ{i + 1}</span>
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
                {/* Same tabs pattern as the main prompt section (#17),
                    in a compact size for these repeated blocks: the
                    character negative is rarely edited, so it lives
                    one tap away. Both fields stay controlled from the
                    chars state (useCharacters / "nai.chars"), so
                    switching tabs never loses either text. The
                    selected tab is not persisted. */}
                <Tabs defaultValue="positive" className="mt-2">
                  <TabsList className="h-9 w-full">
                    <TabsTrigger value="positive">ポジティブ</TabsTrigger>
                    <TabsTrigger value="negative">ネガティブ</TabsTrigger>
                  </TabsList>
                  <TabsContent value="positive">
                    <TagField
                      suggest
                      model={form.model}
                      character
                      value={c.prompt}
                      onChange={(v) => setChar(i, { prompt: v })}
                      {...chipProps(`char-${i}-prompt`)}
                    />
                  </TabsContent>
                  <TabsContent value="negative">
                    <TagField
                      suggest
                      model={form.model}
                      character
                      value={c.negative}
                      onChange={(v) => setChar(i, { negative: v })}
                      {...chipProps(`char-${i}-negative`)}
                    />
                  </TabsContent>
                </Tabs>
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
        </AccordionContent>
      </AccordionItem>
    </Accordion>

    {/* Shared chip editor bar: stuck to the bottom of the drawer
        scroll area (above the ⚙ footer in FormModal) while any chip
        is selected, so the editor controls are reachable without
        scrolling however many tags the field has. The wrapper's extra
        bottom padding while it is visible lets the last chips scroll
        clear of the bar. */}
    {chipEditor && (
      <div className="sticky bottom-0 z-10 -mx-5 mt-3 border-t border-border bg-background px-5 py-2.5">
        <ChipEditorBar editor={chipEditor} />
      </div>
    )}
    </div>
  );
}

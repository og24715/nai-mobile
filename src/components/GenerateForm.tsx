import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { X } from "lucide-react";
import { TagField } from "@/components/TagField";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "cn";
import { MODELS, SAMPLERS, SIZES } from "@/lib/options";
import { modelCaps } from "@/lib/capabilities";
import { MAX_CHARS, type CharPrompt } from "@/hooks/useCharacters";

export interface FormState {
  // Restore settings from a device image (improvements #23 +
  // #31): the entry button lives at the bottom of this form
  // since #70 (moved into the form in #47); MainPage owns the
  // parse + selection-dialog flow.
  onRestoreFile: (f: File) => void;
  prompt: string;
  negative: string;
  model: string;
  size: string;
  steps: string;
  scale: string;
  sampler: string;
  seed: string;
  chars: CharPrompt[];
  // img2img (improvement #43): the attached base image is session
  // state in MainPage (a File cannot persist); only its display
  // name + thumbnail URL reach the form. strength / noise are
  // persisted fields like the others.
  baseImage: { name: string; url: string } | null;
  onPickBaseImage: (f: File) => void;
  onClearBaseImage: () => void;
  strength: string;
  noise: string;
  setStrength: (v: string) => void;
  setNoise: (v: string) => void;
  // Reference images (improvements #44/#45): session state in
  // MainPage (Files cannot persist). Vibe entries carry their
  // encode parameters; the encoded strings themselves are cached
  // in MainPage and never reach the form.
  vibes: {
    id: number;
    name: string;
    url: string;
    strength: number;
    info: number;
  }[];
  onAddVibe: (files: File[]) => void;
  onRemoveVibe: (id: number) => void;
  onUpdateVibe: (id: number, patch: { strength?: number; info?: number }) => void;
  refs: {
    id: number;
    name: string;
    url: string;
    type: string;
    strength: number;
    fidelity: number;
  }[];
  onAddRef: (files: File[]) => void;
  onRemoveRef: (id: number) => void;
  onUpdateRef: (
    id: number,
    patch: { type?: string; strength?: number; fidelity?: number },
  ) => void;
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

// Precise Reference types (improvement #45): the value is the
// API's description base_caption string; the label is the UI text.
const REF_TYPES = [
  { value: "character", label: "Character" },
  { value: "style", label: "Style" },
  { value: "character&style", label: "Both" },
];

function numOr(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Accordion sections in the form modal, collapsible by category so the
// modal needs less scrolling. The accordion is exclusive (improvement
// #69): at most one section is open at a time, and tapping the open
// section's header closes it again. The open section persists in
// localStorage under "nai.accordion" (a JSON array holding zero or one
// section value); arrays stored by the earlier multi-open version load
// as their first entry only. First-ever use opens only the prompt
// section.
const SECTION_VALUES = ["prompt", "settings", "characters", "references"] as const;

function loadOpenSections(): string[] {
  try {
    const raw = localStorage.getItem("nai.accordion");
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (v): v is string =>
            typeof v === "string" &&
            (SECTION_VALUES as readonly string[]).includes(v),
        );
        // Exclusive accordion (#69): keep at most the first stored
        // section; longer arrays come from the multi-open era.
        return valid.slice(0, 1);
      }
    }
  } catch {
    // Corrupt value — fall through to the default.
  }
  return ["prompt"];
}

const sectionContentCls = "flex flex-col gap-6 pt-2 pb-4";

// The whole generation form. Rendered inside the bottom drawer;
// every field auto-saves to localStorage on change, so the ▶ FAB can
// generate from these values without the sheet being open.
export function GenerateForm({ form }: { form: FormState }) {
  const stepsNum = numOr(form.steps, 28);
  const scaleNum = numOr(form.scale, 5);
  const strengthNum = numOr(form.strength, 0.7);
  const noiseNum = numOr(form.noise, 0);
  // Reference-feature availability for the selected model
  // (capability table in src/lib/capabilities.ts).
  const caps = modelCaps(form.model);
  // On Opus, generations are free up to 28 steps; past that they
  // consume Anlas. The steps UI turns amber as the warning signal.
  const stepsOver = stepsNum > 28;

  const [openSections, setOpenSections] = useState<string[]>(loadOpenSections);
  const toggleSections = (next: string[]) => {
    // Exclusive accordion (#69): with multiple off, Base UI reports at
    // most one open section; cap defensively anyway so a longer value
    // can never reach state or storage (last entry = newest intent).
    const single = next.slice(-1);
    setOpenSections(single);
    try {
      localStorage.setItem("nai.accordion", JSON.stringify(single));
    } catch {
      // Storage unavailable — the in-memory state still applies.
    }
  };

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
    <div>
    {/* Section headers stick to the top of the drawer scroll area
        (improvement #57, custom CSS — shadcn has no built-in
        support): each trigger's header is sticky with an opaque
        background matching the drawer surface and its own hairline
        divider, so an open section's title stays visible while its
        content scrolls, until the next section pushes it away.
        The stick offset is -12px, not 0 (#59): the scroll area's
        top padding otherwise leaves a ~10px band above the stuck
        header where scrolled content stays visible and flickers
        through; sticking the header slightly above the scrollport
        top lets its opaque box cover that band completely. The
        negative offset has no effect while a header is not stuck,
        so the resting layout is unchanged. */}
    <Accordion multiple={false} value={openSections} onValueChange={toggleSections}>
      <AccordionItem value="prompt">
        <AccordionTrigger className="py-3.5 text-xl font-semibold" headerClassName="sticky top-[-12px] z-20 border-b border-border bg-background">
          Prompt
        </AccordionTrigger>
        <AccordionContent>
          <div className={sectionContentCls}>
            {/* Positive / negative are tabs, like the official client:
                the negative prompt is rarely edited, so it lives one
                tap away instead of taking vertical space. Both fields
                stay controlled from the lifted form state, so switching
                tabs never loses either text. */}
            <Tabs defaultValue="positive">
              <TabsList variant="line" className="h-10 w-full">
                <TabsTrigger value="positive">Positive</TabsTrigger>
                <TabsTrigger value="negative">Negative</TabsTrigger>
              </TabsList>
              <TabsContent value="positive">
                <TagField
                  fieldId="prompt"
                  suggest
                  model={form.model}
                  value={form.prompt}
                  onChange={form.setPrompt}
                />
              </TabsContent>
              <TabsContent value="negative">
                <TagField
                  fieldId="negative"
                  suggest
                  model={form.model}
                  value={form.negative}
                  onChange={form.setNegative}
                />
              </TabsContent>
            </Tabs>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="settings">
        <AccordionTrigger className="py-3.5 text-xl font-semibold" headerClassName="sticky top-[-12px] z-20 border-b border-border bg-background">
          Settings
        </AccordionTrigger>
        <AccordionContent>
          <div className={sectionContentCls}>
            {/* Basic settings are a single full-width column —
                every field stacked vertically, never side by side. */}
            <div>
              <Label className={labelCls}>Model</Label>
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
              <Label className={labelCls}>Size</Label>
              {/* Size is a radio group of choice cards (improvement
                  #86, the shadcn radio-group choice-card pattern):
                  the dimensions are the card title, the orientation
                  the description, and the selected card takes the
                  primary border via has-data-checked on the label
                  wrapping the item. The stored value is the same
                  "832x1216" string the Select used to write. */}
              <RadioGroup
                value={form.size}
                onValueChange={(v) => {
                  if (typeof v === "string" && v) form.setSize(v);
                }}
                className="gap-3"
              >
                {SIZES.map((s) => {
                  const [title, rest] = s.label.split(" (");
                  const desc = rest?.replace(/\)$/, "") ?? "";
                  return (
                    <label
                      key={s.value}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3.5 transition-colors has-data-checked:border-primary has-data-checked:bg-primary/5"
                    >
                      <span className="flex flex-1 flex-col">
                        <span className="text-base font-medium">{title}</span>
                        <span className="text-sm text-muted-foreground">
                          {desc}
                        </span>
                      </span>
                      <RadioGroupItem value={s.value} />
                    </label>
                  );
                })}
              </RadioGroup>
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
                    Uses Anlas
                  </span>
                )}
              </Label>
              <Slider
                value={[stepsNum]}
                min={1}
                max={50}
                step={1}
                className={cn(
                  "px-2",
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
              <Slider className="px-2"
                value={[scaleNum]}
                min={0}
                max={20}
                step={0.1}
                onValueChange={(v) => form.setScale(String(Array.isArray(v) ? v[0] : v))}
              />
            </div>

            <div>
              <Label htmlFor="seed" className={labelCls}>
                Seed (blank = random)
              </Label>
              {/* Clear button (improvement #48): the x lives
                  inline at the end of the field via InputGroup and
                  only exists while a seed is typed; clearing back
                  to blank means NovelAI picks the seed (#24). */}
              <InputGroup className="h-11">
                <InputGroupInput
                  id="seed"
                  type="number"
                  placeholder="random"
                  value={form.seed}
                  onChange={(e) => form.setSeed(e.target.value)}
                />
                {form.seed !== "" && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-sm"
                      aria-label="Clear seed"
                      onClick={() => form.setSeed("")}
                    >
                      <X className="size-4" />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>

            {/* img2img base image (improvement #43): a device file
                only. While one is attached, generation becomes an
                img2img run on this image (cover-cropped to the
                selected size at send time); the img2img badge by
                the label is the mode cue. The attachment stays in
                place after a generation so he can iterate; the
                sliders below it only exist while attached. */}
            <div>
              <Label className={labelCls}>
                Base Image
                {form.baseImage && (
                  <span className="ml-1.5 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                    img2img
                  </span>
                )}
              </Label>
              {form.baseImage ? (
                <Attachment
                  orientation="vertical"
                  className="w-full has-data-[slot=attachment-content]:w-full"
                >
                  <AttachmentMedia variant="image">
                    <img src={form.baseImage.url} alt="" />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{form.baseImage.name}</AttachmentTitle>
                    <AttachmentDescription>
                      Generate from this image
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label="Remove base image"
                      onClick={form.onClearBaseImage}
                    >
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ) : (
                <label className="flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-border bg-secondary text-base text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                  Choose Image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) form.onPickBaseImage(f);
                    }}
                  />
                </label>
              )}
            </div>

            {form.baseImage && (
              <div>
                <Label className={labelCls}>
                  Strength{" "}
                  <span className="text-lg font-semibold tabular-nums text-foreground">
                    {strengthNum.toFixed(2)}
                  </span>
                </Label>
                <Slider className="px-2"
                  value={[strengthNum]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => form.setStrength(String(Array.isArray(v) ? v[0] : v))}
                />
              </div>
            )}

            {form.baseImage && (
              <div>
                <Label className={labelCls}>
                  Noise{" "}
                  <span className="text-lg font-semibold tabular-nums text-foreground">
                    {noiseNum.toFixed(2)}
                  </span>
                </Label>
                <Slider className="px-2"
                  value={[noiseNum]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => form.setNoise(String(Array.isArray(v) ? v[0] : v))}
                />
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="characters">
        <AccordionTrigger className="py-3.5 text-xl font-semibold" headerClassName="sticky top-[-12px] z-20 border-b border-border bg-background">
          Characters
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            (V4 and up)
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="pb-2">
            {form.chars.map((c, i) => (
              <div key={i} className="mt-4 rounded-xl border border-border p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Char {i + 1}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Remove character ${i + 1}`}
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
                  <TabsList variant="line" className="h-9 w-full">
                    <TabsTrigger value="positive">Positive</TabsTrigger>
                    <TabsTrigger value="negative">Negative</TabsTrigger>
                  </TabsList>
                  <TabsContent value="positive">
                    <TagField
                      fieldId={`char-${i}-prompt`}
                      suggest
                      model={form.model}
                      character
                      value={c.prompt}
                      onChange={(v) => setChar(i, { prompt: v })}
                    />
                  </TabsContent>
                  <TabsContent value="negative">
                    <TagField
                      fieldId={`char-${i}-negative`}
                      suggest
                      model={form.model}
                      character
                      value={c.negative}
                      onChange={(v) => setChar(i, { negative: v })}
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
                + Add Character
              </Button>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="references">
        <AccordionTrigger className="py-3.5 text-xl font-semibold" headerClassName="sticky top-[-12px] z-20 border-b border-border bg-background">
          Reference Images
        </AccordionTrigger>
        <AccordionContent>
          <div className={sectionContentCls}>
            {/* Vibe Transfer (improvement #44): 0–4 reference
                images whose "vibe" steers the generation. Each
                image is encoded once via /ai/encode-vibe (2 Anlas,
                cached per file + model + information extracted in
                MainPage) and sent as reference_image_multiple.
                On models without the capability the block renders
                inert with a note — it is never hidden. Entries are
                grouped in one AttachmentGroup (#53); since #58 they
                stack in a single full-width column with generous
                gaps — at half width the sliders were cramped, their
                tracks cut off at the cell edge and their thumbs
                flush against it, which felt easy to mis-tap. */}
            <div>
              <Label className={labelCls}>Vibe Transfer</Label>
              {!caps.vibeTransfer && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Not available for this model
                </p>
              )}
              <div
                className={cn(
                  "flex flex-col gap-6",
                  !caps.vibeTransfer && "pointer-events-none opacity-50",
                )}
                aria-disabled={!caps.vibeTransfer}
              >
                {form.vibes.length > 0 && (
                  <AttachmentGroup className="flex flex-col gap-10 overflow-x-visible py-0">
                    {form.vibes.map((v) => (
                      <div key={v.id} className="flex min-w-0 flex-col gap-6">
                    <Attachment
                      orientation="vertical"
                      className="w-full has-data-[slot=attachment-content]:w-full"
                    >
                      <AttachmentMedia variant="image">
                        <img src={v.url} alt="" />
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{v.name}</AttachmentTitle>
                      </AttachmentContent>
                      <AttachmentActions>
                        <AttachmentAction
                          aria-label="Remove reference image"
                          onClick={() => form.onRemoveVibe(v.id)}
                        >
                          <X />
                        </AttachmentAction>
                      </AttachmentActions>
                    </Attachment>
                    <div>
                      <Label className={labelCls}>
                        Strength{" "}
                        <span className="text-lg font-semibold tabular-nums text-foreground">
                          {v.strength.toFixed(2)}
                        </span>
                      </Label>
                      <Slider className="px-2"
                        value={[v.strength]}
                        min={0}
                        max={1}
                        step={0.05}
                        onValueChange={(val) => form.onUpdateVibe(v.id, { strength: Array.isArray(val) ? val[0] : val })}
                      />
                    </div>
                    <div>
                      <Label className={labelCls}>
                        Information Extracted{" "}
                        <span className="text-lg font-semibold tabular-nums text-foreground">
                          {v.info.toFixed(2)}
                        </span>
                      </Label>
                      <Slider className="px-2"
                        value={[v.info]}
                        min={0}
                        max={1}
                        step={0.05}
                        onValueChange={(val) => form.onUpdateVibe(v.id, { info: Array.isArray(val) ? val[0] : val })}
                      />
                    </div>
                      </div>
                    ))}
                  </AttachmentGroup>
                )}
                {form.vibes.length < 4 && (
                  <label className="flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-border bg-secondary text-base text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                    + Add Reference
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files
                          ? Array.from(e.target.files)
                          : [];
                        e.target.value = "";
                        if (files.length) form.onAddVibe(files);
                      }}
                    />
                  </label>
                )}
                <p className="text-xs text-muted-foreground">
                  Encoding costs 2 Anlas per image (first time only)
                </p>
              </div>
            </div>

            {/* Precise Reference (improvement #45): 0–4 director
                reference images (V4.5 only). Each entry's image is
                downscaled client-side to a 1024px long side at
                generation time and sent in the five
                director_reference_* arrays; Fidelity is inverted
                into the secondary strength on the server. Same
                inert-with-note treatment on unsupported models.
                Entries are grouped in one AttachmentGroup laid out
                in a single full-width column (#53, #58), like the
                Vibe block. */}
            <div>
              <Label className={labelCls}>Precise Reference</Label>
              {!caps.preciseReference && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Not available for this model
                </p>
              )}
              <div
                className={cn(
                  "flex flex-col gap-6",
                  !caps.preciseReference && "pointer-events-none opacity-50",
                )}
                aria-disabled={!caps.preciseReference}
              >
                {form.refs.length > 0 && (
                  <AttachmentGroup className="flex flex-col gap-10 overflow-x-visible py-0">
                    {form.refs.map((r) => (
                      <div key={r.id} className="flex min-w-0 flex-col gap-6">
                    <Attachment
                      orientation="vertical"
                      className="w-full has-data-[slot=attachment-content]:w-full"
                    >
                      <AttachmentMedia variant="image">
                        <img src={r.url} alt="" />
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{r.name}</AttachmentTitle>
                      </AttachmentContent>
                      <AttachmentActions>
                        <AttachmentAction
                          aria-label="Remove reference image"
                          onClick={() => form.onRemoveRef(r.id)}
                        >
                          <X />
                        </AttachmentAction>
                      </AttachmentActions>
                    </Attachment>
                    <div>
                      <Label className={labelCls}>Type</Label>
                      <Select
                        items={REF_TYPES}
                        value={r.type}
                        onValueChange={(v) => v && form.onUpdateRef(r.id, { type: v })}
                      >
                        <SelectTrigger className="h-11 w-full text-base">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REF_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className={labelCls}>
                        Strength{" "}
                        <span className="text-lg font-semibold tabular-nums text-foreground">
                          {r.strength.toFixed(2)}
                        </span>
                      </Label>
                      <Slider className="px-2"
                        value={[r.strength]}
                        min={0}
                        max={1}
                        step={0.05}
                        onValueChange={(val) => form.onUpdateRef(r.id, { strength: Array.isArray(val) ? val[0] : val })}
                      />
                    </div>
                    <div>
                      <Label className={labelCls}>
                        Fidelity{" "}
                        <span className="text-lg font-semibold tabular-nums text-foreground">
                          {r.fidelity.toFixed(2)}
                        </span>
                      </Label>
                      <Slider className="px-2"
                        value={[r.fidelity]}
                        min={0}
                        max={1}
                        step={0.05}
                        onValueChange={(val) => form.onUpdateRef(r.id, { fidelity: Array.isArray(val) ? val[0] : val })}
                      />
                    </div>
                      </div>
                    ))}
                  </AttachmentGroup>
                )}
                {form.refs.length < 4 && (
                  <label className="flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-border bg-secondary text-base text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                    + Add Reference
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files
                          ? Array.from(e.target.files)
                          : [];
                        e.target.value = "";
                        if (files.length) form.onAddRef(files);
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
    {/* Restore from a device image (#23 + #31; the entry point
        moved from under the hero into the form in #47, and to the
        bottom of the form, below the last accordion section, in
        #70): picking a file parses its embedded NovelAI settings
        locally and opens the group-selection dialog; applying
        leaves this drawer open with the restored values in place. */}
    <label className="mt-4 flex h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-border bg-background text-base font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
      Restore from Image
      <input
        type="file"
        accept="image/png,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) form.onRestoreFile(f);
        }}
      />
    </label>
    </div>
  );
}

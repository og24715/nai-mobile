import { useCallback, useEffect, useRef, useState } from "react";
import { AllowanceBars } from "@/components/AllowanceBar";
import { FabRow } from "@/components/FabRow";
import { FormModal } from "@/components/FormModal";
import { GenerateForm, type FormState } from "@/components/GenerateForm";
import { RestoreDialog, type RestoreSelection } from "@/components/RestoreDialog";
import { UpscaleDialog } from "@/components/UpscaleDialog";
import { EnhanceDialog, type EnhanceScale } from "@/components/EnhanceDialog";
import { Viewer, type StatusState } from "@/components/Viewer";
import { useCharacters } from "@/hooks/useCharacters";
import { usePersistedField } from "@/hooks/usePersistedField";
import {
  fetchRecent,
  fetchSubscription,
  requestEncodeVibe,
  requestEnhance,
  requestGenerate,
  requestUpscale,
  type GenerateRequest,
  type RecentItem,
  type SubscriptionInfo,
} from "@/lib/api";
import { DEFAULT_NEGATIVE } from "@/lib/options";
import { fileToBase64, fileToCoverPngBase64, fileToDownscaledPngBase64 } from "@/lib/baseImage";
import { modelCaps } from "@/lib/capabilities";
import {
  mapSettingsToForm,
  readNaiSettings,
  type RestoredForm,
} from "@/lib/pngSettings";
import { TOKEN_KEY, readStored } from "@/lib/storage";

export default function MainPage() {
  // Form fields, each persisted to localStorage under "nai.<name>".
  const [prompt, setPrompt] = usePersistedField("prompt", "");
  const [negative, setNegative] = usePersistedField("negative", DEFAULT_NEGATIVE);
  const [model, setModel] = usePersistedField("model", "nai-diffusion-4-5-full");
  const [size, setSize] = usePersistedField("size", "832x1216");
  const [steps, setSteps] = usePersistedField("steps", "28");
  const [scale, setScale] = usePersistedField("scale", "5");
  const [sampler, setSampler] = usePersistedField("sampler", "k_euler_ancestral");
  const [seed, setSeed] = usePersistedField("seed", "");
  const [chars, updateChars] = useCharacters();
  // img2img (improvement #43): strength / noise persist like the
  // other fields ("nai.strength" / "nai.noise"); the base image
  // itself is a File and cannot persist, so it is session state
  // only — it survives drawer open/close and stays attached after
  // a generation until removed.
  const [strength, setStrength] = usePersistedField("strength", "0.7");
  const [noise, setNoise] = usePersistedField("noise", "0");
  const [baseImage, setBaseImage] = useState<{ file: File; url: string } | null>(null);
  const pickBaseImage = (f: File) => {
    setBaseImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { file: f, url: URL.createObjectURL(f) };
    });
  };
  const clearBaseImage = () => {
    setBaseImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };
  // Vibe Transfer (improvement #44): reference entries are
  // session state (Files cannot persist). Encoded vibes are
  // cached in a ref keyed by file identity + model + information
  // extracted, so re-generating with unchanged entries is free;
  // changing the model or an entry's Information Extracted slider
  // misses the cache and re-encodes that entry (2 Anlas) at the
  // next generation.
  interface VibeEntry {
    id: number;
    file: File;
    url: string;
    strength: number;
    info: number;
  }
  const [vibes, setVibes] = useState<VibeEntry[]>([]);
  const vibeCache = useRef(new Map<string, string>());
  const vibeSeq = useRef(0);
  const vibeKey = (v: VibeEntry, m: string) =>
    `${v.file.name}:${v.file.size}:${v.file.lastModified}|${m}|${v.info}`;
  // Multi-select add (improvement #52): every picked file becomes
  // its own entry in pick order, up to the 4-entry cap; files past
  // the cap are dropped with a note in the status line.
  const addVibe = (files: File[]) => {
    const take = files.slice(0, Math.max(0, 4 - vibes.length));
    if (take.length < files.length) {
      setStatus({ kind: "", text: "Up to 4 reference images" });
    }
    if (take.length > 0) {
      setVibes([
        ...vibes,
        ...take.map((f) => ({
          id: ++vibeSeq.current,
          file: f,
          url: URL.createObjectURL(f),
          strength: 0.6,
          info: 1,
        })),
      ]);
    }
  };
  const removeVibe = (id: number) => {
    setVibes((prev) => {
      const hit = prev.find((v) => v.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((v) => v.id !== id);
    });
  };
  const updateVibe = (id: number, patch: { strength?: number; info?: number }) => {
    setVibes((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  };
  // Precise Reference (improvement #45): same session-state
  // pattern as vibes. The downscaled PNG base64 is prepared at
  // generation time (only for V4.5 models — elsewhere the server
  // strips the parameters anyway).
  interface RefEntry {
    id: number;
    file: File;
    url: string;
    type: string;
    strength: number;
    fidelity: number;
  }
  const [refs, setRefs] = useState<RefEntry[]>([]);
  const refSeq = useRef(0);
  // Multi-select add (improvement #52): same pattern as vibes.
  const addRef = (files: File[]) => {
    const take = files.slice(0, Math.max(0, 4 - refs.length));
    if (take.length < files.length) {
      setStatus({ kind: "", text: "Up to 4 reference images" });
    }
    if (take.length > 0) {
      setRefs([
        ...refs,
        ...take.map((f) => ({
          id: ++refSeq.current,
          file: f,
          url: URL.createObjectURL(f),
          type: "character",
          strength: 0.7,
          fidelity: 0.5,
        })),
      ]);
    }
  };
  const removeRef = (id: number) => {
    setRefs((prev) => {
      const hit = prev.find((r) => r.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((r) => r.id !== id);
    });
  };
  const updateRef = (id: number, patch: { type?: string; strength?: number; fidelity?: number }) => {
    setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const [heroUrl, setHeroUrl] = useState("");
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [items, setItems] = useState<RecentItem[]>([]);
  const [status, setStatus] = useState<StatusState>({ kind: "", text: "" });
  const [generating, setGenerating] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Parsed settings from a picked device image, waiting for the
  // user to choose which groups to import (improvement #31).
  const [pendingRestore, setPendingRestore] = useState<RestoredForm | null>(null);
  // Upscale parameter dialog (improvement #41): opened from the
  // hero context menu; the run itself happens on execute.
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  // Enhance parameter dialog + run state (improvement #42), and
  // the hero image's natural size (reported by the <img> onLoad),
  // which the dialog's scale chips are computed from. Keyed by
  // URL so a stale size is never used for a different hero.
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [heroSize, setHeroSize] = useState<{ url: string; w: number; h: number } | null>(null);
  // True while a history entry pushed by openModal is on the stack.
  const modalHist = useRef(false);

  const refreshRecent = useCallback(async () => {
    try {
      const list = await fetchRecent();
      setItems(list);
      setHeroUrl(list.length ? list[0].url : "");
    } catch {
      /* leave the viewer as-is */
    }
  }, []);

  // Subscription allowances for the thin bars at the very top of
  // the screen. Any failure leaves the info null and the bars
  // simply aren't rendered; each bar also hides itself when its
  // own source field is absent from the response.
  const refreshSubscription = useCallback(async () => {
    const token = readStored(TOKEN_KEY);
    if (!token) {
      setSubscription(null);
      return;
    }
    const info = await fetchSubscription(token);
    setSubscription(info);
  }, []);

  // Unregistered (no token in this browser): go to the setup page.
  useEffect(() => {
    if (!readStored(TOKEN_KEY)) {
      location.replace("setup");
      return;
    }
    void refreshRecent();
    void refreshSubscription();
  }, [refreshRecent, refreshSubscription]);

  // Modal <-> browser Back integration: opening pushes a history
  // entry, Back (popstate) closes the modal, and × / Esc consume the
  // pushed entry via history.back().
  useEffect(() => {
    if (history.state && history.state.naiModal) {
      history.replaceState(null, "");
    }
    const onPop = () => {
      if (modalHist.current) {
        modalHist.current = false;
        setModalOpen(false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openModal = () => {
    if (modalOpen) return;
    setModalOpen(true);
    if (!modalHist.current) {
      modalHist.current = true;
      history.pushState({ naiModal: true }, "");
    }
  };

  const closeModal = () => {
    if (!modalOpen) return;
    if (modalHist.current) {
      history.back();
    } else {
      setModalOpen(false);
    }
  };

  // Restore settings from a device image (improvements #23 + #31):
  // parse the PNG's embedded NovelAI metadata locally, show the
  // selection dialog, apply only the checked groups through the
  // normal persisted setters, then open the drawer so the user can
  // review before generating. Cancelling the dialog changes nothing.
  const restoreFromFile = async (file: File) => {
    const settings = await readNaiSettings(file).catch(() => null);
    if (!settings) {
      setStatus({ kind: "err", text: "This image has no settings embedded" });
      return;
    }
    setPendingRestore(mapSettingsToForm(settings, model));
  };

  // Restore settings from the history image currently shown as the
  // hero (improvement #10): fetch the file from the app's own
  // outputs/ serving path (the same URL the <img> uses) and feed it
  // through the exact same parse flow as a device-picked file, so
  // the mapping and the selection dialog are fully shared.
  const restoreFromHero = async () => {
    if (!heroUrl) return;
    let file: File;
    try {
      const r = await fetch(heroUrl);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const blob = await r.blob();
      const name = decodeURIComponent(heroUrl.split("/").pop() || "image.png");
      file = new File([blob], name, { type: blob.type || "image/png" });
    } catch (e) {
      setStatus({ kind: "err", text: "Network error: " + e });
      return;
    }
    await restoreFromFile(file);
  };

  const applyRestore = (sel: RestoreSelection) => {
    const r = pendingRestore;
    if (!r) return;
    if (sel.prompt && r.prompt !== undefined) setPrompt(r.prompt);
    if (sel.negative && r.negative !== undefined) setNegative(r.negative);
    if (sel.chars && r.chars !== undefined) updateChars(r.chars);
    if (sel.settings) {
      if (r.model !== undefined) setModel(r.model);
      if (r.size !== undefined) setSize(r.size);
      if (r.steps !== undefined) setSteps(r.steps);
      if (r.scale !== undefined) setScale(r.scale);
      if (r.sampler !== undefined) setSampler(r.sampler);
    }
    if (sel.seed && r.seed !== undefined) setSeed(r.seed);
    setPendingRestore(null);
    setStatus({ kind: "ok", text: "Settings restored from the image" });
    openModal();
  };

  const selectThumb = (url: string) => {
    setHeroUrl(url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Upscale the hero image (improvements #39 + #41): the context
  // menu item first opens the parameter dialog (V5 model +
  // blur sigma); on execute the server relays the outputs/ file
  // to NovelAI's standalone upscaler and saves the result as a
  // new outputs/ entry, which then becomes the hero. Upscaling
  // consumes Anlas, so the allowance bars are refreshed alongside
  // the recent list.
  const upscaleHero = async (upModel: string, blurSigma: number) => {
    if (!heroUrl || upscaling) return;
    const token = readStored(TOKEN_KEY);
    if (!token) {
      location.replace("setup");
      return;
    }
    const name = decodeURIComponent(heroUrl.split("/").pop() || "");
    if (!name) return;
    setUpscaling(true);
    setStatus({ kind: "", text: "Upscaling…" });
    try {
      const { status: httpStatus, json: j } = await requestUpscale(token, name, upModel, blurSigma);
      if (!j.ok) {
        setStatus({ kind: "err", text: "Error: " + (j.error || httpStatus) });
      } else {
        setStatus({ kind: "ok", text: "Upscaled" });
        if (j.item) setHeroUrl(j.item.url);
        void refreshRecent();
        void refreshSubscription();
      }
    } catch (e) {
      setStatus({ kind: "err", text: "Network error: " + e });
    }
    setUpscaling(false);
  };

  // Enhance the hero image (improvement #42): the context menu
  // item opens the parameter dialog (scale + strength + noise);
  // on execute the server rebuilds an img2img generation from
  // the hero's own stored parameters and saves the result as a
  // new outputs/ entry, which then becomes the hero. Mirrors the
  // upscale flow, including the allowance refresh (Anlas is
  // consumed).
  const enhanceHero = async (enhScale: EnhanceScale, strength: number, noise: number) => {
    if (!heroUrl || enhancing) return;
    const token = readStored(TOKEN_KEY);
    if (!token) {
      location.replace("setup");
      return;
    }
    const name = decodeURIComponent(heroUrl.split("/").pop() || "");
    if (!name) return;
    setEnhancing(true);
    setStatus({ kind: "", text: "Enhancing…" });
    try {
      const { status: httpStatus, json: j } = await requestEnhance(token, name, enhScale, strength, noise);
      if (!j.ok) {
        setStatus({ kind: "err", text: "Error: " + (j.error || httpStatus) });
      } else {
        setStatus({ kind: "ok", text: "Enhanced" });
        if (j.item) setHeroUrl(j.item.url);
        void refreshRecent();
        void refreshSubscription();
      }
    } catch (e) {
      setStatus({ kind: "err", text: "Network error: " + e });
    }
    setEnhancing(false);
  };

  const generate = async () => {
    const token = readStored(TOKEN_KEY);
    if (!token) {
      location.replace("setup");
      return;
    }
    closeModal();
    window.scrollTo(0, 0);
    setStatus({ kind: "", text: "Generating… (this can take a while)" });
    setGenerating(true);
    const [w, h] = size.split("x").map(Number);
    // img2img (#43): with a base image attached, convert it to a
    // PNG at the selected size (cover-fit) and send it along; the
    // server then builds an img2img request instead of generate.
    let image: string | undefined;
    if (baseImage) {
      try {
        image = await fileToCoverPngBase64(baseImage.file, w, h);
      } catch {
        setStatus({ kind: "err", text: "Could not load the base image" });
        setGenerating(false);
        return;
      }
    }
    // Vibe Transfer (#44): encode any entry not cached for the
    // current model + information extracted, then generate with
    // the encoded set. Entries are skipped entirely on models
    // without the capability (the server would strip them too).
    let vibePayload: GenerateRequest["vibes"];
    if (modelCaps(model).vibeTransfer && vibes.length) {
      const encoded: NonNullable<GenerateRequest["vibes"]> = [];
      for (const v of vibes) {
        const key = vibeKey(v, model);
        let enc = vibeCache.current.get(key);
        if (!enc) {
          setStatus({ kind: "", text: "Encoding vibes…" });
          try {
            const b64 = await fileToBase64(v.file);
            const { status: hs, json: j } = await requestEncodeVibe(token, b64, model, v.info);
            if (!j.ok || !j.vibe) {
              setStatus({ kind: "err", text: "Error: " + (j.error || hs) });
              setGenerating(false);
              return;
            }
            enc = j.vibe;
            vibeCache.current.set(key, enc);
          } catch (e) {
            setStatus({ kind: "err", text: "Network error: " + e });
            setGenerating(false);
            return;
          }
        }
        encoded.push({ encoded: enc, strength: v.strength, informationExtracted: v.info });
      }
      vibePayload = encoded;
      setStatus({ kind: "", text: "Generating… (this can take a while)" });
    }
    // Precise Reference (#45): downscale each entry to a 1024px
    // long side and send the set; the server expands it into
    // the director_reference_* arrays. V4.5 models only.
    let refPayload: GenerateRequest["references"];
    if (modelCaps(model).preciseReference && refs.length) {
      try {
        refPayload = [];
        for (const r of refs) {
          const b64 = await fileToDownscaledPngBase64(r.file, 1024);
          refPayload.push({ image: b64, type: r.type, strength: r.strength, fidelity: r.fidelity });
        }
      } catch {
        setStatus({ kind: "err", text: "Could not load a reference image" });
        setGenerating(false);
        return;
      }
    }
    const body: GenerateRequest = {
      prompt,
      negative,
      model,
      width: w,
      height: h,
      steps: Number(steps),
      scale: Number(scale),
      sampler,
      // Empty seed = the server omits the seed and NovelAI chooses
      // one; the seed that was actually used comes back in the
      // response and is only shown in the status line — it is never
      // written back into the seed field or localStorage.
      seed: seed === "" ? null : Number(seed),
      characters: chars.map((c) => ({ prompt: c.prompt, negative: c.negative })),
      ...(image ? { image, strength: Number(strength), noise: Number(noise) } : {}),
      ...(vibePayload ? { vibes: vibePayload } : {}),
      ...(refPayload ? { references: refPayload } : {}),
    };
    try {
      const { status: httpStatus, json: j } = await requestGenerate(token, body);
      if (!j.ok) {
        setStatus({ kind: "err", text: "Error: " + (j.error || httpStatus) });
      } else {
        setStatus({ kind: "ok", text: j.seed != null ? "Done seed=" + j.seed : "Done" });
        if (j.images && j.images.length) setHeroUrl(j.images[0]);
        void refreshRecent();
        void refreshSubscription();
      }
    } catch (e) {
      setStatus({ kind: "err", text: "Network error: " + e });
    }
    setGenerating(false);
  };

  const form: FormState = {
    onRestoreFile: restoreFromFile,
    prompt,
    negative,
    model,
    size,
    steps,
    scale,
    sampler,
    seed,
    chars,
    baseImage: baseImage
      ? { name: baseImage.file.name, url: baseImage.url }
      : null,
    onPickBaseImage: pickBaseImage,
    onClearBaseImage: clearBaseImage,
    strength,
    noise,
    setStrength,
    setNoise,
    vibes: vibes.map((v) => ({
      id: v.id,
      name: v.file.name,
      url: v.url,
      strength: v.strength,
      info: v.info,
    })),
    onAddVibe: addVibe,
    onRemoveVibe: removeVibe,
    onUpdateVibe: updateVibe,
    refs: refs.map((r) => ({
      id: r.id,
      name: r.file.name,
      url: r.url,
      type: r.type,
      strength: r.strength,
      fidelity: r.fidelity,
    })),
    onAddRef: addRef,
    onRemoveRef: removeRef,
    onUpdateRef: updateRef,
    setPrompt,
    setNegative,
    setModel,
    setSize,
    setSteps,
    setScale,
    setSampler,
    setSeed,
    updateChars,
  };

  return (
    <>
      {subscription && <AllowanceBars subscription={subscription} />}
      <Viewer heroUrl={heroUrl} status={status} busy={generating || upscaling || enhancing} items={items} onSelect={selectThumb} onRestoreHero={restoreFromHero} onUpscale={() => setUpscaleOpen(true)} upscaling={upscaling} onEnhance={() => setEnhanceOpen(true)} enhancing={enhancing} onHeroLoad={(w, h) => setHeroSize({ url: heroUrl, w, h })} />
      <FabRow generating={generating} onGenerate={generate} onOpenForm={openModal} />
      <FormModal open={modalOpen} onRequestClose={closeModal}>
        <GenerateForm form={form} />
      </FormModal>
      <RestoreDialog
        restored={pendingRestore}
        onApply={applyRestore}
        onCancel={() => setPendingRestore(null)}
      />
      <UpscaleDialog
        open={upscaleOpen}
        defaultModel={model}
        onCancel={() => setUpscaleOpen(false)}
        onExecute={(upModel, blurSigma) => {
          setUpscaleOpen(false);
          void upscaleHero(upModel, blurSigma);
        }}
      />
      <EnhanceDialog
        open={enhanceOpen}
        sourceWidth={heroSize && heroSize.url === heroUrl ? heroSize.w : 0}
        sourceHeight={heroSize && heroSize.url === heroUrl ? heroSize.h : 0}
        formModel={model}
        onCancel={() => setEnhanceOpen(false)}
        onExecute={(enhScale, strength, noise) => {
          setEnhanceOpen(false);
          void enhanceHero(enhScale, strength, noise);
        }}
      />
    </>
  );
}

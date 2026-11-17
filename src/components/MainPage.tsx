import { useCallback, useEffect, useRef, useState } from "react";
import { AllowanceBar } from "@/components/AllowanceBar";
import { FabRow } from "@/components/FabRow";
import { FormModal } from "@/components/FormModal";
import { GenerateForm, type FormState } from "@/components/GenerateForm";
import { RestoreDialog, type RestoreSelection } from "@/components/RestoreDialog";
import { Viewer, type StatusState } from "@/components/Viewer";
import { useCharacters } from "@/hooks/useCharacters";
import { usePersistedField } from "@/hooks/usePersistedField";
import {
  fetchRecent,
  fetchSubscription,
  requestGenerate,
  type GenerateRequest,
  type RecentItem,
  type SubscriptionUsage,
} from "@/lib/api";
import { DEFAULT_NEGATIVE } from "@/lib/options";
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

  const [heroUrl, setHeroUrl] = useState("");
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  const [items, setItems] = useState<RecentItem[]>([]);
  const [status, setStatus] = useState<StatusState>({ kind: "", text: "" });
  const [generating, setGenerating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // Parsed settings from a picked device image, waiting for the
  // user to choose which groups to import (improvement #31).
  const [pendingRestore, setPendingRestore] = useState<RestoredForm | null>(null);
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

  // Allowance for the thin bar at the very top of the screen. Any failure
  // (or a non-Opus account without a usage allowance) leaves it
  // null and the bar simply isn't rendered.
  const refreshSubscription = useCallback(async () => {
    const token = readStored(TOKEN_KEY);
    if (!token) {
      setUsage(null);
      return;
    }
    const info = await fetchSubscription(token);
    setUsage(info ? info.usage : null);
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
      setStatus({ kind: "err", text: "この画像に設定が入っていません" });
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
      setStatus({ kind: "err", text: "通信エラー: " + e });
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
    setStatus({ kind: "ok", text: "画像から設定を復元しました" });
    openModal();
  };

  const selectThumb = (url: string) => {
    setHeroUrl(url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const generate = async () => {
    const token = readStored(TOKEN_KEY);
    if (!token) {
      location.replace("setup");
      return;
    }
    closeModal();
    window.scrollTo(0, 0);
    setStatus({ kind: "", text: "生成中…（数十秒かかることがあります）" });
    setGenerating(true);
    const [w, h] = size.split("x").map(Number);
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
    };
    try {
      const { status: httpStatus, json: j } = await requestGenerate(token, body);
      if (!j.ok) {
        setStatus({ kind: "err", text: "エラー: " + (j.error || httpStatus) });
      } else {
        setStatus({ kind: "ok", text: j.seed != null ? "完了 seed=" + j.seed : "完了" });
        if (j.images && j.images.length) setHeroUrl(j.images[0]);
        void refreshRecent();
        void refreshSubscription();
      }
    } catch (e) {
      setStatus({ kind: "err", text: "通信エラー: " + e });
    }
    setGenerating(false);
  };

  const form: FormState = {
    prompt,
    negative,
    model,
    size,
    steps,
    scale,
    sampler,
    seed,
    chars,
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
      {usage && <AllowanceBar usage={usage} />}
      <Viewer heroUrl={heroUrl} status={status} items={items} onSelect={selectThumb} onRestoreFile={restoreFromFile} onRestoreHero={restoreFromHero} />
      <FabRow generating={generating} onGenerate={generate} onOpenForm={openModal} />
      <FormModal open={modalOpen} onRequestClose={closeModal}>
        <GenerateForm form={form} />
      </FormModal>
      <RestoreDialog
        restored={pendingRestore}
        onApply={applyRestore}
        onCancel={() => setPendingRestore(null)}
      />
    </>
  );
}

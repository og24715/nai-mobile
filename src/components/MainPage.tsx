import { useCallback, useEffect, useRef, useState } from "react";
import { FabRow } from "@/components/FabRow";
import { FormModal } from "@/components/FormModal";
import { GenerateForm, type FormState } from "@/components/GenerateForm";
import { Viewer, type StatusState } from "@/components/Viewer";
import { useCharacters } from "@/hooks/useCharacters";
import { usePersistedField } from "@/hooks/usePersistedField";
import {
  fetchRecent,
  requestGenerate,
  type GenerateRequest,
  type RecentItem,
} from "@/lib/api";
import { DEFAULT_NEGATIVE } from "@/lib/options";
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
  const [items, setItems] = useState<RecentItem[]>([]);
  const [status, setStatus] = useState<StatusState>({ kind: "", text: "" });
  const [generating, setGenerating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
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

  // Unregistered (no token in this browser): go to the setup page.
  useEffect(() => {
    if (!readStored(TOKEN_KEY)) {
      location.replace("setup");
      return;
    }
    void refreshRecent();
  }, [refreshRecent]);

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
      // Empty seed = a fresh random roll on the server. The seed that
      // was actually used is only shown in the status line; it is
      // never written back into the seed field or localStorage.
      seed: seed === "" ? null : Number(seed),
      characters: chars.map((c) => ({ prompt: c.prompt, negative: c.negative })),
    };
    try {
      const { status: httpStatus, json: j } = await requestGenerate(token, body);
      if (!j.ok) {
        setStatus({ kind: "err", text: "エラー: " + (j.error || httpStatus) });
      } else {
        setStatus({ kind: "ok", text: "完了 seed=" + j.seed });
        if (j.images && j.images.length) setHeroUrl(j.images[0]);
        void refreshRecent();
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
      <Viewer heroUrl={heroUrl} status={status} items={items} onSelect={selectThumb} />
      <FabRow generating={generating} onGenerate={generate} onOpenForm={openModal} />
      <FormModal open={modalOpen} onRequestClose={closeModal}>
        <GenerateForm form={form} />
      </FormModal>
    </>
  );
}

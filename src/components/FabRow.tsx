import { Button } from "@/components/ui/button";

interface Props {
  generating: boolean;
  onGenerate: () => void;
  onOpenForm: () => void;
}

// Bottom-right floating buttons: ▶ generates immediately with the
// current (auto-saved) form values, ✎ opens the form modal.
export function FabRow({ generating, onGenerate, onOpenForm }: Props) {
  return (
    <div className="fixed right-5 bottom-5 z-40 flex gap-3">
      <Button
        type="button"
        aria-label="生成する"
        disabled={generating}
        onClick={onGenerate}
        className="h-[60px] w-[60px] rounded-full p-0 text-2xl shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
      >
        ▶
      </Button>
      <Button
        type="button"
        variant="secondary"
        aria-label="生成フォームを開く"
        onClick={onOpenForm}
        className="h-[60px] w-[60px] rounded-full border border-border p-0 text-2xl shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
      >
        ✎
      </Button>
    </div>
  );
}

import { Button } from "@/components/ui/button";

interface Props {
  generating: boolean;
  onGenerate: () => void;
  onOpenForm: () => void;
}

// Bottom-right floating buttons: ▶ generates immediately with the
// current (auto-saved) form values, ✎ opens the form modal. The
// glyph size is pinned to 24px (the pre-#35 text-2xl rendering): it
// is an icon size, not typography, so it stays out of the #35 scale.
export function FabRow({ generating, onGenerate, onOpenForm }: Props) {
  return (
    <div className="fixed right-5 bottom-5 z-40 flex gap-3">
      <Button
        type="button"
        aria-label="Generate"
        disabled={generating}
        onClick={onGenerate}
        className="h-[60px] w-[60px] rounded-full p-0 text-[24px] shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
      >
        ▶
      </Button>
      <Button
        type="button"
        variant="secondary"
        aria-label="Open the generation form"
        onClick={onOpenForm}
        className="h-[60px] w-[60px] rounded-full border border-border p-0 text-[24px] shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
      >
        ✎
      </Button>
    </div>
  );
}

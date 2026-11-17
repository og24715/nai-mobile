import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Props {
  open: boolean;
  // Called when the dialog asks to close (× button, Esc, backdrop).
  // The parent routes this through history.back() so the modal also
  // closes on browser Back; it must not set open=false directly.
  onRequestClose: () => void;
  children: ReactNode;
}

// Full-screen form modal (no margins). Input only — generation is
// triggered from the ▶ FAB on the main screen.
export function FormModal({ open, onRequestClose, children }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onRequestClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="inset-0 top-0 left-0 block h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-0 bg-background p-0 data-open:zoom-in-100 sm:max-w-none"
      >
        <div className="mx-auto max-w-[640px] px-5 pt-5 pb-16">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold">生成</DialogTitle>
            <Button
              type="button"
              variant="secondary"
              aria-label="閉じる"
              onClick={onRequestClose}
              className="h-11 w-11 rounded-full border border-border p-0 text-[22px]"
            >
              ×
            </Button>
          </div>
          <div className="mt-6">{children}</div>
          <div className="mt-8 flex items-center gap-3">
            <a
              href="setup"
              className="inline-block rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] text-muted-foreground no-underline"
            >
              ⚙ 設定
            </a>
            <ThemeToggle />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

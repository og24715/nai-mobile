import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Props {
  open: boolean;
  // Called when the drawer asks to close (× button, Esc, overlay tap,
  // swipe down). The parent routes this through history.back() so the
  // sheet also closes on browser Back; it must not set open=false
  // directly.
  onRequestClose: () => void;
  children: ReactNode;
}

// Bottom sheet form (Drawer, ~92dvh, drag handle, rounded top corners,
// content scrolls inside). Input only — generation is triggered from
// the ▶ FAB on the main screen.
export function FormModal({ open, onRequestClose, children }: Props) {
  return (
    <Drawer
      open={open}
      showSwipeHandle
      onOpenChange={(next) => {
        if (!next) onRequestClose();
      }}
    >
      <DrawerContent className="bg-background [--drawer-content-max-height:92dvh] [--drawer-height:92dvh]">
        <div className="mx-auto min-h-0 w-full max-w-[640px] flex-1 overflow-y-auto px-5 pt-2 pb-16">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-2xl font-semibold">Generate</DrawerTitle>
            <Button
              type="button"
              variant="secondary"
              aria-label="Close"
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
              className="inline-block rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground no-underline"
            >
              ⚙ Settings
            </a>
            <ThemeToggle />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

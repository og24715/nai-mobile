import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_KEY, writeStored } from "@/lib/storage";

// Light/dark toggle. The theme itself lives as the "dark" class on
// <html> (set before first paint by the inline script in index.html);
// this button just flips it and persists the choice to "nai.theme".
// In dark mode it shows a Sun (tap for light), and vice versa.
export function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains("dark"),
  );

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    writeStored(THEME_KEY, next ? "dark" : "light");
  };

  return (
    <Button
      type="button"
      variant="secondary"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
      className="h-9 w-9 rounded-full border border-border p-0"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

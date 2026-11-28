import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Eraser, Paintbrush } from "lucide-react";
import { cn } from "cn";
import { fileToCoverPngBase64 } from "@/lib/baseImage";

interface Props {
  open: boolean;
  // The attached base image file and the selected generation
  // size. The mask is painted on the cover-cropped rendering of
  // the file at exactly this size — the same pixels the generate
  // request sends as its image — so mask and image always align.
  file: File | null;
  width: number;
  height: number;
  // Previously painted mask (black-and-white PNG base64, no data:
  // prefix), restored as the starting overlay when present.
  initialMask: string | null;
  // Done reports the painted mask, or null when nothing is
  // painted (which simply means plain img2img).
  onDone: (mask: string | null) => void;
  onClose: () => void;
}

const labelCls = "mb-1.5 block text-sm font-medium text-muted-foreground";

// Full-screen mask painter for inpainting (improvement #111).
// Strokes land on an overlay canvas in solid accent color (the
// canvas element is CSS-translucent, so overlaps stay uniform);
// erasing cuts them back out with destination-out. On Done the
// overlay's coverage is thresholded into the black-and-white PNG
// NovelAI's infill expects (white = repaint, black = keep) — the
// mask itself is strictly two-valued, with no feathering.
export function MaskEditor({ open, file, width, height, initialMask, onDone, onClose }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [brush, setBrush] = useState(48);
  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [painted, setPainted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  // Prepare the cover-cropped base image whenever the editor
  // opens (or the file / size changes while it is open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSrc(null);
    setPainted(false);
    setMode("paint");
    (async () => {
      if (!file) return;
      try {
        const b64 = await fileToCoverPngBase64(file, width, height);
        if (!cancelled) setSrc("data:image/png;base64," + b64);
      } catch {
        if (!cancelled) onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file, width, height]);

  // Size the overlay canvas and restore a previously painted
  // mask (recolored from white-on-black to accent-with-alpha).
  useEffect(() => {
    if (!src) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!initialMask) return;
    const img = new Image();
    img.onload = () => {
      const t = document.createElement("canvas");
      t.width = width;
      t.height = height;
      const tctx = t.getContext("2d");
      if (!tctx) return;
      tctx.drawImage(img, 0, 0, width, height);
      const data = tctx.getImageData(0, 0, width, height);
      const d = data.data;
      let any = false;
      for (let i = 0; i < d.length; i += 4) {
        const on = d[i] > 127;
        if (on) any = true;
        d[i] = 233;
        d[i + 1] = 69;
        d[i + 2] = 96;
        d[i + 3] = on ? 255 : 0;
      }
      tctx.putImageData(data, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(t, 0, 0);
      setPainted(any);
    };
    img.src = "data:image/png;base64," + initialMask;
  }, [src, width, height, initialMask]);

  const refreshPainted = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) {
        setPainted(true);
        return;
      }
    }
    setPainted(false);
  };

  const posOf = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * canvas.width) / r.width,
      y: ((e.clientY - r.top) * canvas.height) / r.height,
    };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0, 0, 0, 1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#e94560";
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y + 0.01);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  };

  const clearAll = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setPainted(false);
  };

  const finish = () => {
    const canvas = canvasRef.current;
    if (!canvas || !painted) {
      onDone(null);
      return;
    }
    // Flatten the overlay onto black and threshold the coverage
    // into a pure black-and-white mask PNG.
    const t = document.createElement("canvas");
    t.width = width;
    t.height = height;
    const tctx = t.getContext("2d");
    if (!tctx) {
      onDone(null);
      return;
    }
    tctx.fillStyle = "#000";
    tctx.fillRect(0, 0, width, height);
    tctx.drawImage(canvas, 0, 0);
    const data = tctx.getImageData(0, 0, width, height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] > 40 ? 255 : 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    tctx.putImageData(data, 0, 0);
    onDone(t.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-xl font-semibold">Paint Mask</DialogTitle>
          <DialogDescription>
            Paint the area to repaint. Everything else stays as-is.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={mode === "paint" ? "default" : "secondary"}
              className="h-11 flex-1 rounded-xl text-base"
              onClick={() => setMode("paint")}
            >
              <Paintbrush /> Paint
            </Button>
            <Button
              type="button"
              variant={mode === "erase" ? "default" : "secondary"}
              className="h-11 flex-1 rounded-xl text-base"
              onClick={() => setMode("erase")}
            >
              <Eraser /> Erase
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded-xl px-4 text-base"
              onClick={clearAll}
            >
              Clear
            </Button>
          </div>
          <div>
            <Label className={labelCls}>
              Brush Size{" "}
              <span className="text-lg font-semibold tabular-nums text-foreground">{brush}</span>
            </Label>
            <Slider
              className="px-2"
              value={[brush]}
              min={8}
              max={160}
              step={4}
              onValueChange={(v) => setBrush(Array.isArray(v) ? v[0] : v)}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-4">
          {src ? (
            <div
              className="relative w-full"
              style={{
                maxWidth: `calc((100dvh - 330px) * ${width / height})`,
                aspectRatio: `${width} / ${height}`,
              }}
            >
              <img
                src={src}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full select-none"
              />
              <canvas
                ref={canvasRef}
                className={cn("absolute inset-0 h-full w-full touch-none opacity-60")}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drawingRef.current = true;
                  const p = posOf(e);
                  lastRef.current = p;
                  stroke(p, p);
                }}
                onPointerMove={(e) => {
                  if (!drawingRef.current || !lastRef.current) return;
                  const p = posOf(e);
                  stroke(lastRef.current, p);
                  lastRef.current = p;
                }}
                onPointerUp={() => {
                  drawingRef.current = false;
                  lastRef.current = null;
                  refreshPainted();
                }}
                onPointerCancel={() => {
                  drawingRef.current = false;
                  lastRef.current = null;
                }}
              />
            </div>
          ) : (
            <p className="text-base text-muted-foreground">Loading…</p>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-5 py-4">
          <Button
            type="button"
            variant="secondary"
            className="h-11 flex-1 rounded-xl text-base"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 flex-1 rounded-xl text-base"
            onClick={finish}
          >
            {painted ? "Done" : "Done (no mask)"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

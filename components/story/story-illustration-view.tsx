import { useRef, useState } from "react";
import { X } from "lucide-react";
import { ShownImage } from "@/components/ui/shown-image";
import type { StoryIllustration } from "@/lib/story-storage";

export function StoryIllustrationView({ illustration, pending, onRetry, selecting }: {
  illustration?: StoryIllustration; pending: boolean; onRetry: () => void; selecting: boolean;
}) {
  const viewer = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  if (pending) return <div className="story-illustration story-illustration-pending" role="status">画面生成中…</div>;
  if (illustration?.state === "failed") return <div className="story-illustration-failure">
    <span>剧情图未生成</span>
    {!selecting && <button type="button" onPointerDown={event => event.stopPropagation()} onClick={onRetry}>重试图片</button>}
  </div>;
  if (illustration?.state !== "ready") return null;
  return <>
    <button className="story-illustration story-illustration-preview" type="button" aria-label="查看剧情图片原图"
      disabled={selecting} onPointerDown={event => event.stopPropagation()}
      onClick={() => { viewer.current?.showModal(); setOpen(true); }}>
      <ShownImage mediaRef={illustration.mediaRef} alt="本轮剧情插图" />
    </button>
    <dialog className="story-illustration-viewer" ref={viewer} aria-label="剧情图片原图" onClose={() => setOpen(false)}
      onPointerDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) viewer.current?.close(); }}>
      <button type="button" onClick={() => viewer.current?.close()} aria-label="关闭原图"><X size={20} /></button>
      {open && <ShownImage mediaRef={illustration.mediaRef} alt="剧情图片原图" />}
    </dialog>
  </>;
}

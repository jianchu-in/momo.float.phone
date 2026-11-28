import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, BookOpen } from "lucide-react";

export function FacingStoryDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const title = useId(), description = useId(), panel = useRef<HTMLElement>(null);
  const pending = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="facing-overlay facing-overlay-center facing-story-overlay" onClick={event => {
    if (event.target === event.currentTarget && !pending.current) onClose();
  }} onKeyDown={event => {
    if (event.key === "Escape" && !pending.current) { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") {
      const buttons = [...panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []];
      if (!buttons.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    }
  }}>
    <section ref={panel} className="facing-sheet facing-story-dialog" role="dialog" aria-modal="true" aria-labelledby={title} aria-describedby={description}>
      <span className="facing-story-emblem" aria-hidden="true"><BookOpen size={25} /></span>
      <h2 id={title}>前往剧情继续对话？</h2>
      <p id={description}>将当前角色、场景和已保存的对话带入一条新的剧情分线。你可以在那里继续故事，原来的面对面记录也会保留。</p>
      {error && <p role="alert">{error}</p>}
      <div className="facing-story-actions">
        <button type="button" className="facing-soft" disabled={busy} onClick={onClose}>留在这里</button>
        <button type="button" className="facing-primary" disabled={busy} onClick={() => {
          if (pending.current) return;
          pending.current = true; setBusy(true); setError("");
          void onConfirm().catch(cause => {
            pending.current = false; setBusy(false);
            setError(cause instanceof Error ? cause.message : "暂时无法前往剧情，请重试。");
          });
        }}>{busy ? "正在前往…" : <>前往剧情<ArrowRight size={16} /></>}</button>
      </div>
    </section>
  </div>;
}

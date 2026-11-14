"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Ellipsis, FileText, MessagesSquare, SlidersHorizontal, X } from "lucide-react";
import { DebugPromptPanel } from "@/components/debug-prompt-panel";
import { QuickActionFloat } from "@/components/quick-action-float";
import { CHAT_APP_SETTINGS_UPDATED_EVENT, loadChatAppSettings } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import { getMascotContext, subscribeMascotContext, type MascotPageContext } from "@/lib/mascot-context";
import {
  DISCUSSION_STYLES, discussRoleplay, getDiscussionCharacterIds, loadDiscussionPrompt, OPEN_FLOATING_TOOL,
  saveDiscussionPrompt, type DiscussionStyle, type DiscussionTurn,
} from "@/lib/roleplay-discussion";

function Discussion({ context, onClose }: { context: MascotPageContext; onClose: () => void }) {
  const [style, setStyle] = useState<DiscussionStyle>("model");
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(() => loadDiscussionPrompt("model"));
  const [characters] = useState(() => {
    const available = loadCharacters();
    const ids = getDiscussionCharacterIds(context);
    return ids.flatMap(id => available.filter(character => character.id === id));
  });
  const [characterId, setCharacterId] = useState(characters[0]?.id || "");
  const [turns, setTurns] = useState<DiscussionTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [turns]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function changeStyle(next: DiscussionStyle) {
    setStyle(next);
    setPrompt(loadDiscussionPrompt(next));
    setTurns([]);
    setError("");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || controller.current) return;
    const run = new AbortController();
    controller.current = run;
    const next: DiscussionTurn[] = [...turns, { role: "user", content: draft.trim() }];
    setTurns(next);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const content = await discussRoleplay(context, characterId, style, next, run.signal);
      if (!run.signal.aborted) setTurns([...next, { role: "assistant", content }]);
    } catch (cause) {
      if (!run.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "发送失败。");
        setDraft(next.at(-1)?.content || "");
        setTurns(turns);
      }
    } finally {
      if (!run.signal.aborted) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return <div className="roleplay-discussion-backdrop" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="破壁聊天" className="roleplay-discussion" onClick={event => event.stopPropagation()}>
      <header>
        <div><h2>破壁聊天</h2><p>{context.label}{characters.length === 1 ? ` · ${characters[0].name}` : ""}</p></div>
        <button type="button" onClick={onClose} aria-label="关闭破壁聊天"><X size={20} /></button>
      </header>
      <div className="roleplay-discussion-controls">
        <select aria-label="对话风格" value={style} disabled={busy} onChange={event => changeStyle(event.target.value as DiscussionStyle)}>
          {Object.entries(DISCUSSION_STYLES).map(([id, option]) => <option key={id} value={id}>{option.label}</option>)}
        </select>
        {characters.length > 1 && <select aria-label="本次讨论的角色" value={characterId} disabled={busy} onChange={event => {
          setCharacterId(event.target.value);
          setTurns([]);
          setError("");
        }}>
          {characters.map(character => <option value={character.id} key={character.id}>{character.name}</option>)}
        </select>}
        <button type="button" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "收起提示词" : "编辑提示词"}</button>
      </div>
      {editing && <div className="roleplay-discussion-edit">
        <textarea rows={4} aria-label="风格提示词" maxLength={4000} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} />
        <button type="button" disabled={busy} onClick={() => setPrompt(DISCUSSION_STYLES[style].prompt)}>恢复默认</button>
        <button type="button" disabled={busy} onClick={() => {
          saveDiscussionPrompt(style, prompt);
          setPrompt(loadDiscussionPrompt(style));
          setEditing(false);
        }}>保存提示词</button>
      </div>}
      <div className="roleplay-discussion-transcript" ref={transcript} aria-live="polite">
        {!turns.length && <p className="roleplay-discussion-empty">可以聊角色为什么这么做，或讨论下一段怎么演。</p>}
        {turns.map((turn, index) => <div key={index} data-role={turn.role}>{turn.content}</div>)}
        {busy && <p role="status">正在回复…</p>}
      </div>
      {error && <p className="roleplay-discussion-error" role="alert">{error}</p>}
      <form onSubmit={send}>
        <textarea ref={input} rows={2} aria-label="讨论内容" placeholder="聊聊你想怎么演…" maxLength={4000} value={draft}
          disabled={busy} onChange={event => setDraft(event.target.value)} />
        <button type="submit" disabled={busy || !draft.trim()}>发送</button>
      </form>
    </section>
  </div>;
}

const floatItems = [
  { id: "prompt-viewer", label: "提示词查看器", Icon: FileText, offset: [-88, 0] },
  { id: "quick-action", label: "快捷操作", Icon: SlidersHorizontal, offset: [-64, -64] },
  { id: "discussion", label: "破壁聊天", Icon: MessagesSquare, offset: [0, -88] },
] as const;

export function FloatingTools() {
  const [settings, setSettings] = useState(loadChatAppSettings);
  const [expanded, setExpanded] = useState(false);
  const [discussion, setDiscussion] = useState<MascotPageContext | null>(null);
  const context = useSyncExternalStore(subscribeMascotContext, getMascotContext, getMascotContext);
  const fan = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      const current = loadChatAppSettings();
      setSettings(current);
      if (!current.combinedFloatingTools) setExpanded(false);
      if (!current.roleplayDiscussionEnabled) setDiscussion(null);
    };
    sync();
    window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (!fan.current?.contains(event.target as Node)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  const enabled = [settings.promptViewerEnabled, settings.quickActionEnabled, settings.roleplayDiscussionEnabled];
  const combined = settings.combinedFloatingTools === true;
  return <>
    <DebugPromptPanel combined={combined} />
    <QuickActionFloat combined={combined} />
    {combined && enabled.some(Boolean) && !discussion && <div className="phone-tools-radial" ref={fan}>
      {expanded && floatItems.map(({ id, label, Icon, offset }, index) => enabled[index] && <button type="button"
        className="phone-tools-satellite" key={id} aria-label={label} title={label}
        style={{ transform: `translate(${offset[0]}px, ${offset[1]}px)` }} onClick={() => {
          setExpanded(false);
          if (id === "discussion") setDiscussion(context);
          else window.dispatchEvent(new CustomEvent(OPEN_FLOATING_TOOL, { detail: id }));
        }}><Icon size={20} /></button>)}
      <button type="button" aria-label="三合一悬浮球" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? <X size={21} /> : <Ellipsis size={25} />}
      </button>
    </div>}
    {!combined && settings.roleplayDiscussionEnabled && !discussion && <button type="button" className="phone-tools-discussion-ball"
      aria-label="打开破壁聊天" onClick={() => setDiscussion(context)}><MessagesSquare size={21} /></button>}
    {discussion && <Discussion context={discussion} onClose={() => setDiscussion(null)} />}
  </>;
}

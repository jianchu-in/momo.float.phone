"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BookOpenText, ChevronLeft, Eye, Send, X } from "lucide-react";
import { ChatFallbackAvatar } from "@/components/chat/chat-fallback-avatar";
import { loadCharacters } from "@/lib/character-storage";
import { resolveChatCharacterAvatar } from "@/lib/chat-storage";
import { loadPersonalNotes, type PersonalNote, type PersonalNoteKind } from "@/lib/personal-notes-storage";
import {
  DEFAULT_NOTE_REACTION_PREMISE, createNoteReactionId, generatePersonalNoteReaction, loadPersonalNoteContacts,
  loadPersonalNoteReactions, personalNoteTitle, savePersonalNoteReaction, sharePersonalNotes, type NoteReaction,
} from "@/lib/personal-note-reactions";

type Mode = "peek" | "share";
export type NoteAction = { mode: Mode; selectedId?: string; kind: PersonalNoteKind };

type ReactionPresentation = Pick<NoteReaction, "characterName" | "notes" | "premise" | "text"> & {
  createdAt?: string; stopped?: boolean;
};

function ReactionPaper({ entry, running = false }: { entry: ReactionPresentation; running?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const node = scroller.current;
    if (running && node && follow.current) node.scrollTop = node.scrollHeight;
  }, [entry.text, running]);
  return (
    <>
      <div className="note-reaction-heading">
        <span className="note-reaction-eye" aria-hidden="true"><Eye size={21} strokeWidth={1.6} /></span>
        <div>
          <h2>{entry.characterName}的心声</h2>
          {entry.createdAt && <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</time>}
        </div>
      </div>
      <div className="note-reaction-context">
        <p>{entry.premise}</p>
        <details>
          <summary>{`看了 ${entry.notes.length} 条手记`}</summary>
          <ul>{entry.notes.map(note => <li key={note.id}><time dateTime={note.date}>{note.date}</time> {note.title}</li>)}</ul>
        </details>
      </div>
      <div ref={scroller} className="note-reaction-writing" tabIndex={0} aria-label="心声正文" onScroll={event => {
        const node = event.currentTarget;
        follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
      }}>
        {entry.text ? <p>{entry.text}</p> : <p className="note-reaction-soft">正在翻看手记…</p>}
        {running && <span className="note-reaction-caret" aria-hidden="true" />}
        {entry.stopped && <small>已停止生成</small>}
      </div>
    </>
  );
}

function NoteSelection({ notes, kind, selected, onSelect }: {
  notes: PersonalNote[]; kind: PersonalNoteKind;
  selected: Set<string>; onSelect: (ids: string[]) => void;
}) {
  const [tab, setTab] = useState(kind);
  const visible = notes.filter(note => note.kind === tab);
  const dates = new Map<string, PersonalNote[]>();
  if (tab === "diary") {
    for (const note of visible) {
      const group = dates.get(note.date) ?? [];
      group.push(note);
      dates.set(note.date, group);
    }
  }
  const row = (note: PersonalNote) => (
    <label key={note.id} className="note-action-check">
      <input type="checkbox" checked={selected.has(note.id)} onChange={() => onSelect([note.id])} />
      <span>{personalNoteTitle(note)}</span>
      {tab === "memo" && <time dateTime={note.date}>{note.date}</time>}
    </label>
  );
  return (
    <fieldset className="note-action-selection">
      <legend>选择手记</legend>
      <div className="note-action-tabs">
        <button type="button" aria-pressed={tab === "diary"} onClick={() => setTab("diary")}>按日记日期</button>
        <button type="button" aria-pressed={tab === "memo"} onClick={() => setTab("memo")}>备忘录</button>
      </div>
      <div className="note-action-notes">
        {!visible.length && <p className="note-reaction-soft">这里还没有手记</p>}
        {tab === "memo" ? visible.map(row) : [...dates].map(([date, group]) => (
          <div key={date}>
            <label className="note-action-check note-action-date">
              <input type="checkbox" checked={group.every(note => selected.has(note.id))}
                ref={node => {
                  if (node) node.indeterminate = group.some(note => selected.has(note.id)) && !group.every(note => selected.has(note.id));
                }}
                onChange={() => onSelect(group.map(note => note.id))} />
              <time dateTime={date}>{date}</time>
            </label>
            {group.length > 1 ? <div className="note-action-date-items">{group.map(row)}</div>
              : <span className="note-action-date-title">{personalNoteTitle(group[0])}</span>}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function PersonalNoteActionDialog({ action, identityId, onClose, onNotice }: {
  action: NoteAction; identityId: string | null; onClose: () => void; onNotice?: (notice: string) => void;
}) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const liveText = useRef("");
  const [selection, setSelection] = useState(() => new Set(action.selectedId ? [action.selectedId] : []));
  const [characterId, setCharacterId] = useState("");
  const [query, setQuery] = useState("");
  const [premiseInput, setPremise] = useState("");
  const [remember, setRemember] = useState(true);
  const [stage, setStage] = useState<"select" | "running" | "result">("select");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ReactionPresentation | null>(null);
  const [pendingSave, setPendingSave] = useState<NoteReaction | null>(null);
  const [error, setError] = useState("");
  const isPeek = action.mode === "peek";
  const [catalog] = useState(() => {
    try {
      const notes = [...loadPersonalNotes(identityId, "diary"), ...loadPersonalNotes(identityId, "memo")];
      const characters = isPeek ? loadCharacters().map(character => ({
        id: character.id, name: character.name, originalName: character.name, avatar: resolveChatCharacterAvatar(character),
      })) : loadPersonalNoteContacts(identityId);
      return { notes, characters, error: "" };
    } catch (reason) {
      return { notes: [], characters: [], error: reason instanceof Error ? reason.message : "读取手记失败。" };
    }
  });
  const { notes, characters } = catalog;
  const recipient = characters.find(character => character.id === characterId);
  const shownCharacters = characters.filter(character => `${character.name} ${character.originalName}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    const node = overlay.current;
    const shell = node?.parentElement;
    const viewport = window.visualViewport;
    const fitViewport = () => {
      if (!node || !shell || !viewport) return;
      const rect = shell.getBoundingClientRect();
      const scale = rect.height / (shell.offsetHeight || 1) || 1;
      node.style.top = `${Math.max(0, (viewport.offsetTop - rect.top) / scale)}px`;
      node.style.bottom = `${Math.max(0, (rect.bottom - viewport.offsetTop - viewport.height) / scale)}px`;
    };
    fitViewport();
    viewport?.addEventListener("resize", fitViewport);
    viewport?.addEventListener("scroll", fitViewport);
    return () => {
      controller.current?.abort();
      viewport?.removeEventListener("resize", fitViewport);
      viewport?.removeEventListener("scroll", fitViewport);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const close = () => { if (!locked.current && !pendingSave) onClose(); };
  const toggleSelection = (ids: string[]) => setSelection(previous => {
    const next = new Set(previous);
    if (ids.every(id => next.has(id))) ids.forEach(id => next.delete(id));
    else ids.forEach(id => next.add(id));
    return next;
  });

  const persist = async (entry: NoteReaction) => {
    controller.current = null;
    setResult(entry);
    setPendingSave(entry);
    await savePersonalNoteReaction(entry, remember);
    setPendingSave(null);
  };

  const start = async () => {
    if (!recipient || !selection.size || locked.current) return;
    const ids = [...selection];
    locked.current = true;
    setError("");
    if (!isPeek) {
      setSending(true);
      try {
        const name = await sharePersonalNotes(identityId, ids, recipient.id);
        onNotice?.(`已发给 ${name}`);
        onClose();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "发送失败，请重试。");
      } finally {
        setSending(false);
        locked.current = false;
      }
      return;
    }

    const run = new AbortController();
    controller.current = run;
    liveText.current = "";
    const entry = {
      characterName: recipient.name,
      notes: notes.filter(note => selection.has(note.id)).map(note => ({ id: note.id, kind: note.kind, title: personalNoteTitle(note), date: note.date })),
      premise: premiseInput.trim() || DEFAULT_NOTE_REACTION_PREMISE, text: "",
    };
    setResult(entry);
    setStage("running");
    try {
      const reaction = await generatePersonalNoteReaction(identityId, ids, recipient.id, entry.premise, run.signal, text => {
        if (run.signal.aborted) return;
        liveText.current = text;
        setResult(previous => previous ? { ...previous, text } : previous);
      });
      await persist(reaction);
      setStage("result");
    } catch (reason) {
      if (run.signal.aborted) {
        if (!liveText.current) {
          setResult(null);
          setStage("select");
        } else {
          const partial = {
            ...entry, id: createNoteReactionId(), characterId: recipient.id, identityId,
            createdAt: new Date().toISOString(), text: liveText.current, stopped: true,
          };
          try { await persist(partial); }
          catch (saveError) { setError(saveError instanceof Error ? saveError.message : "保存失败，请重试。"); }
          setStage("result");
        }
      } else {
        setError(reason instanceof Error ? reason.message : "生成失败，请重试。");
        setStage("result");
      }
    } finally {
      controller.current = null;
      locked.current = false;
    }
  };

  const retrySave = async () => {
    if (!pendingSave || locked.current) return;
    locked.current = true;
    setSending(true);
    try {
      await persist(pendingSave);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请重试。");
    } finally {
      locked.current = false;
      setSending(false);
    }
  };

  return (
    <div ref={overlay} className="nw-modal-backdrop note-action-overlay" onClick={close}>
      <section className={`note-action-dialog ${stage !== "select" ? "note-reaction-paper" : ""}`}
        role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        <header className="note-action-header">
          <h2 id={titleId}>{stage !== "select" ? "偷看观后感" : isPeek ? "让角色偷看" : "发给角色"}</h2>
          <button ref={closeButton} type="button" className="diary-icon-btn" aria-label="关闭" onClick={close}
            disabled={stage === "running" || sending || Boolean(pendingSave)}><X size={19} /></button>
        </header>
        {stage === "select" ? (
          <div className="note-action-body">
            {!catalog.error && <NoteSelection notes={notes} kind={action.kind} selected={selection} onSelect={toggleSelection} />}
            <label className="note-action-field">选择角色
              <input type="search" placeholder="搜索角色" value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <div className="note-action-characters">
              {shownCharacters.map(character => <button type="button" key={character.id}
                aria-pressed={characterId === character.id} onClick={() => setCharacterId(character.id)}>
                <span className="chat-contact-avatar">{character.avatar ? <img src={character.avatar} alt="" /> : <ChatFallbackAvatar />}</span>
                <span>{character.name}</span>
              </button>)}
              {shownCharacters.length === 0 && <p className="note-reaction-soft">{characters.length ? "没有匹配的角色" : "暂无可选角色"}</p>}
            </div>
            {isPeek && <>
              <label className="note-action-field">偷看的情境
                <textarea maxLength={240} rows={2} placeholder={DEFAULT_NOTE_REACTION_PREMISE}
                  value={premiseInput} onChange={event => setPremise(event.target.value)} />
              </label>
              <label className="note-action-check note-action-remember">
                <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> 记入角色的短期记忆
              </label>
            </>}
          </div>
        ) : result && <ReactionPaper entry={result} running={stage === "running"} />}
        {(error || catalog.error) && <p className="note-action-error" role="alert">{error || catalog.error}</p>}
        <footer className="note-action-footer">
          {stage === "select" ? <>
            <span>已选 {selection.size} 条</span>
            <button type="button" className="diary-entry-confirm-btn" disabled={!recipient || !selection.size || sending} onClick={() => void start()}>
              {isPeek ? <Eye size={16} /> : <Send size={16} />}
              {sending ? "发送中…" : isPeek ? "生成心声" : "发送到私聊"}
            </button>
          </> : stage === "running" ? <>
            <span role="status">{pendingSave ? "正在保存" : "正在生成心声"}</span>
            <button type="button" className="diary-entry-confirm-btn" disabled={Boolean(pendingSave)} onClick={() => controller.current?.abort()}>停止</button>
          </> : <>
            {error && !pendingSave && <button type="button" className="note-action-back" onClick={() => { setStage("select"); setError(""); }}>返回选择</button>}
            {pendingSave ? <button type="button" className="diary-entry-confirm-btn" disabled={sending} onClick={() => void retrySave()}>重试保存</button>
              : <button type="button" className="diary-entry-confirm-btn" onClick={close}>关闭</button>}
          </>}
        </footer>
      </section>
    </div>
  );
}

export function PersonalNoteReactionHistory({ identityId, onBack }: { identityId: string | null; onBack: () => void }) {
  const [active, setActive] = useState<NoteReaction | null>(null);
  let items: NoteReaction[] = [];
  let error = "";
  try { items = loadPersonalNoteReactions(identityId); }
  catch (reason) { error = reason instanceof Error ? reason.message : "读取失败，请重试。"; }
  return (
    <section className="diary-app diary-entry-app note-reaction-history">
      <header className="diary-app-header" inert={Boolean(active)}>
        <button type="button" className="diary-icon-btn" onClick={onBack} aria-label="返回"><ChevronLeft size={20} /></button>
        <div><h1>他的偷看观后感</h1></div>
      </header>
      <main className="diary-entry-main" inert={Boolean(active)}>
        {error ? <p className="note-action-error" role="alert">{error}</p> : items.length
          ? <div className="diary-entry-list">
            {items.map(entry => <button type="button" className="diary-entry-card" key={entry.id} onClick={() => setActive(entry)}>
              <strong>{entry.characterName}</strong>
              <span className="diary-entry-card-text">{entry.text.slice(0, 95)}</span>
              <span className="diary-entry-card-meta">
                <span>{entry.notes.length} 条手记</span>
                <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString("zh-CN")}</time>
              </span>
            </button>)}
          </div> : <div className="diary-entry-empty"><BookOpenText size={32} strokeWidth={1.5} /><h2>还没有偷看观后感</h2></div>}
      </main>
      {active && <div className="nw-modal-backdrop note-action-overlay" onClick={() => setActive(null)}>
        <section className="note-action-dialog note-reaction-paper" role="dialog" aria-modal="true" aria-label="偷看观后感"
          onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") setActive(null); }}>
          <header className="note-action-header"><h2>偷看观后感</h2>
            <button type="button" className="diary-icon-btn" aria-label="关闭" autoFocus onClick={() => setActive(null)}><X size={19} /></button>
          </header>
          <ReactionPaper entry={active} />
        </section>
      </div>}
    </section>
  );
}

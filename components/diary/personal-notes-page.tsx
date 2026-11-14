"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpenText, ChevronLeft, Eye, Plus, Send, StickyNote, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/modal";
import { formatIsoDate } from "@/lib/calendar-utils";
import { loadDiaryEntryFontAssetId, loadDiaryEntryFontScale } from "@/lib/diary-entry-storage";
import { getThemeAssetDataUrl } from "@/lib/theme-storage";
import { PersonalNoteActionDialog, type NoteAction } from "./personal-note-actions";
import { useDiaryPaperFont } from "./use-diary-paper-font";
import {
  DEFAULT_MEMO_STYLE,
  deletePersonalNote,
  loadPersonalNotes,
  savePersonalNote,
  type MemoStyle,
  type PersonalNote,
  type PersonalNoteKind,
} from "@/lib/personal-notes-storage";

type Draft = Omit<PersonalNote, "updatedAt">;

const PAPER_LABELS: Record<MemoStyle["paper"], string> = {
  plain: "空白", lined: "横线", grid: "方格", dotted: "点阵",
};

function listMarker(numbering: MemoStyle["numbering"], index: number): string {
  if (numbering === "bullet") return "•";
  if (numbering === "number") return `${index + 1}.`;
  if (numbering !== "letter") return "";
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value--;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return `${label}.`;
}

function MemoEditor({ draft, onChange, busy }: {
  draft: Draft;
  onChange: (next: Draft) => void;
  busy: boolean;
}) {
  const style = draft.memoStyle ?? DEFAULT_MEMO_STYLE;
  const lines = draft.body.split("\n");
  const list = style.mode === "todo" || style.numbering !== "none";
  const itemInputs = useRef<Array<HTMLInputElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (focusIndex === null) return;
    itemInputs.current[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex]);

  const updateStyle = (patch: Partial<MemoStyle>) => onChange({ ...draft, memoStyle: { ...style, ...patch } });
  const updateItems = (next: string[], checked = style.checked) =>
    onChange({ ...draft, body: next.join("\n"), memoStyle: { ...style, checked } });

  const insertItems = (index: number, values: string[]) => {
    const next = [...lines];
    next.splice(index, 0, ...values);
    updateItems(next, style.checked.map(item => item >= index ? item + values.length : item));
    setFocusIndex(index + values.length - 1);
  };

  const removeItem = (index: number) => {
    const next = lines.filter((_, item) => item !== index);
    updateItems(next, style.checked.filter(item => item !== index).map(item => item > index ? item - 1 : item));
    setFocusIndex(Math.max(0, index - 1));
  };

  return (
    <>
      <fieldset className="personal-note-paper-picker" disabled={busy}>
        <legend>纸张</legend>
        {(Object.keys(PAPER_LABELS) as MemoStyle["paper"][]).map(paper => (
          <button key={paper} type="button" aria-pressed={paper === style.paper} onClick={() => updateStyle({ paper })}>
            <span className="personal-note-paper-pattern" data-paper={paper} aria-hidden="true" />
            {PAPER_LABELS[paper]}
          </button>
        ))}
      </fieldset>
      <div className="personal-note-format">
        <label>内容<select value={style.mode} disabled={busy}
          onChange={event => updateStyle({ mode: event.target.value as MemoStyle["mode"] })}>
          <option value="text">正文</option>
          <option value="todo">待办</option>
        </select></label>
        <label>序号<select value={style.numbering} disabled={busy}
          onChange={event => updateStyle({ numbering: event.target.value as MemoStyle["numbering"] })}>
          <option value="none">无序号</option>
          <option value="bullet">• 圆点</option>
          <option value="number">1. 2. 3.</option>
          <option value="letter">A. B. C.</option>
        </select></label>
      </div>
      {list ? <>
        <ul className="personal-note-items personal-note-paper-pattern" data-paper={style.paper}>
          {lines.map((line, index) => {
            const done = style.checked.includes(index);
            return <li key={index} data-complete={style.mode === "todo" && done || undefined}>
              {style.mode === "todo" && <input aria-label={`完成第 ${index + 1} 项`} type="checkbox" checked={done}
                disabled={busy || !line.trim()} onChange={event => updateStyle({
                  checked: event.target.checked ? [...style.checked, index] : style.checked.filter(item => item !== index),
                })} />}
              {style.numbering !== "none" && <span className="personal-note-item-marker" aria-hidden="true">{listMarker(style.numbering, index)}</span>}
              <input ref={node => { itemInputs.current[index] = node; }} aria-label={`第 ${index + 1} 项`}
                placeholder={index === 0 ? "添加一项…" : undefined} value={line} disabled={busy}
                onChange={event => {
                  const value = event.target.value;
                  updateItems(lines.map((item, position) => position === index ? value : item),
                    value.trim() ? style.checked : style.checked.filter(item => item !== index));
                }}
                onKeyDown={event => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
                  event.preventDefault();
                  insertItems(index + 1, [""]);
                }}
                onPaste={event => {
                  const values = event.clipboardData.getData("text/plain").split(/\r\n?|\n/g);
                  if (values.length < 2) return;
                  event.preventDefault();
                  const start = event.currentTarget.selectionStart ?? line.length;
                  const end = event.currentTarget.selectionEnd ?? start;
                  values[0] = line.slice(0, start) + values[0];
                  values[values.length - 1] += line.slice(end);
                  const next = [...lines];
                  next.splice(index, 1, ...values);
                  updateItems(next, style.checked.filter(item => item !== index).map(item => item > index ? item + values.length - 1 : item));
                  setFocusIndex(index + values.length - 1);
                }} />
              <button type="button" className="personal-note-item-remove" aria-label={`移除第 ${index + 1} 项`}
                disabled={busy || (lines.length === 1 && !line)} onClick={() => removeItem(index)}><X size={16} /></button>
            </li>;
          })}
        </ul>
        <button type="button" className="personal-note-add-item" disabled={busy} onClick={() => {
          if (lines[lines.length - 1].trim()) insertItems(lines.length, [""]);
          else setFocusIndex(lines.length - 1);
        }}><Plus size={16} /> 添加一项</button>
      </> : (
        <textarea className="personal-note-writing personal-note-paper-pattern" data-paper={style.paper} aria-label="正文"
          placeholder="记点什么…" value={draft.body} disabled={busy} onChange={event => {
            const body = event.target.value;
            const next = body.split("\n");
            onChange({ ...draft, body, memoStyle: { ...style, checked: style.checked.filter(index => lines[index] === next[index]) } });
          }} />
      )}
    </>
  );
}

export function PersonalNotesPage({ kind, identityId, onBack, onNotice }: {
  kind: PersonalNoteKind;
  identityId: string | null;
  onBack: () => void;
  onNotice?: (notice: string) => void;
}) {
  const isDiary = kind === "diary";
  const title = isDiary ? "我的日记" : "备忘录";
  const itemName = isDiary ? "日记" : "备忘录";
  const Icon = isDiary ? BookOpenText : StickyNote;
  const [fontDataUrl, setFontDataUrl] = useState<string | null>(null);
  const fontStyle = useDiaryPaperFont(fontDataUrl, isDiary ? loadDiaryEntryFontScale() : 1);
  const [notes, setNotes] = useState<PersonalNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [action, setAction] = useState<NoteAction | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "discard" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const overlay = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const editorOpen = Boolean(draft);

  useEffect(() => {
    try {
      setNotes(loadPersonalNotes(identityId, kind));
      setLoaded(true);
    } catch {
      setError("手记读取失败，请退出后重试。");
    }
  }, [identityId, kind]);

  useEffect(() => {
    const assetId = isDiary ? loadDiaryEntryFontAssetId() : null;
    if (!assetId) return;
    let active = true;
    void getThemeAssetDataUrl(assetId).then(url => {
      if (active) setFontDataUrl(url);
    }).catch(() => {});
    return () => { active = false; };
  }, [isDiary]);

  useEffect(() => {
    if (!editorOpen) {
      returnFocus.current?.focus({ preventScroll: true });
      returnFocus.current = null;
      return;
    }
    closeButton.current?.focus({ preventScroll: true });
    const node = overlay.current;
    const viewport = window.visualViewport;
    const shell = node?.parentElement;
    if (!node || !viewport || !shell) return;
    const fitViewport = () => {
      const rect = shell.getBoundingClientRect();
      const scale = rect.height / (shell.offsetHeight || 1) || 1;
      const top = Math.max(0, (viewport.offsetTop - rect.top) / scale);
      const bottom = Math.max(0, (rect.bottom - viewport.offsetTop - viewport.height) / scale);
      node.style.top = `${top}px`;
      node.style.bottom = `${bottom}px`;
    };
    fitViewport();
    viewport.addEventListener("resize", fitViewport);
    viewport.addEventListener("scroll", fitViewport);
    return () => {
      viewport.removeEventListener("resize", fitViewport);
      viewport.removeEventListener("scroll", fitViewport);
    };
  }, [editorOpen]);

  const existing = notes.find(note => note.id === draft?.id);
  const hasEdits = draft && (draft.title !== (existing?.title ?? "") || draft.body !== (existing?.body ?? "")
    || (existing && draft.date !== existing.date)
    || (existing && JSON.stringify(draft.memoStyle ?? DEFAULT_MEMO_STYLE) !== JSON.stringify(existing.memoStyle ?? DEFAULT_MEMO_STYLE)));
  const back = () => {
    if (saving.current || confirm) return;
    if (!draft) {
      onBack();
      return;
    }
    if (hasEdits) {
      setConfirm("discard");
      return;
    }
    setDraft(null);
    setError("");
  };

  const open = (note: Draft) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError("");
    setDraft(note);
  };

  const create = () => open({
    id: globalThis.crypto?.randomUUID?.() ?? `note_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    identityId, kind, title: "", body: "", date: formatIsoDate(new Date()),
  });

  const finish = async (operation: () => Promise<void>, errorMessage: string) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      setNotes(loadPersonalNotes(identityId, kind));
      setDraft(null);
    } catch {
      setError(errorMessage);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const canSave = draft && (draft.title.trim() || draft.body.trim()) && (!isDiary || draft.date);
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !canSave) return;
    void finish(() => savePersonalNote(draft), "保存失败，内容仍在编辑框里，请重试。");
  };

  return (
    <section className={`diary-app diary-entry-app personal-notes-app ${isDiary ? "personal-diary-app" : "personal-memo-app"}`} style={fontStyle}>
      <header className="diary-app-header" inert={editorOpen || Boolean(action)}>
        <button type="button" className="diary-icon-btn" onClick={onBack} aria-label="返回"><ChevronLeft size={20} /></button>
        <div><h1>{title}</h1></div>
        {loaded && <button type="button" className="diary-icon-btn personal-notes-add" onClick={create} aria-label={`新建${itemName}`}>
          <Plus size={22} />
        </button>}
      </header>

      <main className="diary-entry-main personal-notes-main" inert={editorOpen || Boolean(action)}>
        {!draft && error ? <p className="personal-notes-error" role="alert">{error}</p> : loaded && (
          notes.length ? <>
            <div className="personal-note-list-actions">
              <button type="button" onClick={() => setAction({ mode: "share", kind })}><Send size={15} /> 发给角色</button>
              <button type="button" onClick={() => setAction({ mode: "peek", kind })}><Eye size={17} /> 让角色偷看</button>
            </div>
            <div className="diary-entry-list">
              {notes.map(note => {
                const style = note.memoStyle ?? DEFAULT_MEMO_STYLE;
                const date = isDiary ? note.date : formatIsoDate(new Date(note.updatedAt));
                const preview = note.body.trim().replace(/\s+/g, " ");
                return <button type="button" key={note.id} className="diary-entry-card" onClick={() => open(note)}>
                  {!isDiary && <span className="personal-memo-preview personal-note-paper-pattern" data-paper={style.paper} aria-hidden="true" />}
                  <strong>{note.title || preview.slice(0, 32)}</strong>
                  {preview && <span className="diary-entry-card-text">{preview}</span>}
                  <span className="diary-entry-card-meta">
                    {!isDiary && style.mode === "todo" && <span>{style.checked.length}/{note.body.split("\n").filter(line => line.trim()).length} 项完成</span>}
                    <time dateTime={date}>{date}</time>
                  </span>
                </button>;
              })}
            </div>
          </> : <div className="diary-entry-empty">
            <Icon size={34} strokeWidth={1.5} />
            <h2>{`还没有${itemName}`}</h2>
            <button type="button" onClick={create}>{`新建${itemName}`}</button>
          </div>
        )}
      </main>

      {draft && <div ref={overlay} className="nw-modal-backdrop personal-note-overlay" onClick={back}>
        <form className="diary-entry-detail-paper personal-note-editor" role="dialog" aria-modal="true" aria-label={`${existing ? "编辑" : "新建"}${itemName}`}
          onClick={event => event.stopPropagation()} onSubmit={save} inert={Boolean(confirm || action)}
          onKeyDown={event => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.stopPropagation();
              back();
            }
          }}>
          <span className="diary-entry-paper-clip" aria-hidden="true" />
          <div className="diary-entry-detail-scroll">
            <header>
              <div>
                {isDiary && <input className="personal-note-date" type="date" aria-label="日期" required value={draft.date} disabled={busy}
                  onChange={event => setDraft({ ...draft, date: event.target.value })} />}
                <input className="personal-note-title" aria-label="标题" placeholder="标题（选填）" value={draft.title} disabled={busy}
                  onChange={event => setDraft({ ...draft, title: event.target.value })} />
              </div>
              <button ref={closeButton} type="button" onClick={back} disabled={busy} aria-label="关闭"><X size={19} /></button>
            </header>
            {isDiary ? (
              <textarea className="personal-note-writing diary-entry-paragraph" aria-label="正文" value={draft.body} disabled={busy}
                placeholder="写下今天的事…" onChange={event => setDraft({ ...draft, body: event.target.value })} />
            ) : <MemoEditor draft={draft} busy={busy} onChange={setDraft} />}
            {error && <p className="personal-notes-error" role="alert">{error}</p>}
          </div>
          {existing && <div className="personal-note-list-actions personal-note-editor-actions">
            <button type="button" onClick={() => setAction({ mode: "share", selectedId: existing.id, kind })} disabled={busy || Boolean(hasEdits)}><Send size={15} /> 发给角色</button>
            <button type="button" onClick={() => setAction({ mode: "peek", selectedId: existing.id, kind })} disabled={busy || Boolean(hasEdits)}><Eye size={17} /> 让角色偷看</button>
            {hasEdits && <small>保存后可发送或生成心声</small>}
          </div>}
          <footer className="personal-notes-actions">
            {existing && <button type="button" className="personal-note-delete" onClick={() => setConfirm("delete")} disabled={busy}><Trash2 size={15} /> 删除</button>}
            <button type="submit" className="diary-entry-confirm-btn" disabled={busy || !canSave}>{busy ? "处理中…" : "保存"}</button>
          </footer>
        </form>
      </div>}

      {action && <PersonalNoteActionDialog action={action} identityId={identityId} onClose={() => {
        setAction(null);
        if (editorOpen) requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
      }} onNotice={onNotice} />}

      {confirm && <ConfirmDialog
        title={confirm === "delete" ? `删除这条${itemName}？` : "放弃本次编辑？"}
        message={confirm === "delete" ? "删除后无法恢复。" : "未保存的改动会丢失。"}
        variant="danger"
        confirmLabel={confirm === "delete" ? "删除" : "放弃"}
        onCancel={() => { setConfirm(null); requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true })); }}
        onConfirm={() => {
          setConfirm(null);
          if (confirm === "delete" && existing) {
            void finish(() => deletePersonalNote(existing.id, identityId, kind), "删除失败，请重试。");
          } else {
            setDraft(null);
            setError("");
          }
        }}
      />}
    </section>
  );
}

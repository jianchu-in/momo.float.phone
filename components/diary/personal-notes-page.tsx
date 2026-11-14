"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpenText, ChevronLeft, Plus, StickyNote, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/modal";
import { formatIsoDate } from "@/lib/calendar-utils";
import { deletePersonalNote, loadPersonalNotes, savePersonalNote, type PersonalNote, type PersonalNoteKind } from "@/lib/personal-notes-storage";

type Draft = Omit<PersonalNote, "updatedAt">;

export function PersonalNotesPage({ kind, identityId, onBack }: {
  kind: PersonalNoteKind;
  identityId: string | null;
  onBack: () => void;
}) {
  const isDiary = kind === "diary";
  const title = isDiary ? "我的日记" : "备忘录";
  const itemName = isDiary ? "日记" : "备忘录";
  const Icon = isDiary ? BookOpenText : StickyNote;
  const [notes, setNotes] = useState<PersonalNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "discard" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);

  const refresh = () => {
    setNotes(loadPersonalNotes(identityId, kind));
    setLoaded(true);
  };

  useEffect(() => {
    try {
      setNotes(loadPersonalNotes(identityId, kind));
      setLoaded(true);
    } catch {
      setError("手记读取失败，请退出后重试。");
    }
  }, [identityId, kind]);

  const existing = notes.find(note => note.id === draft?.id);
  const back = () => {
    if (saving.current) return;
    if (!draft) {
      onBack();
      return;
    }
    if (draft.title !== (existing?.title ?? "") || draft.body !== (existing?.body ?? "")
      || (existing && draft.date !== existing.date)) {
      setConfirm("discard");
      return;
    }
    setDraft(null);
    setError("");
  };

  const create = () => {
    setError("");
    setDraft({
      id: globalThis.crypto?.randomUUID?.() ?? `note_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      identityId, kind, title: "", body: "", date: formatIsoDate(new Date()),
    });
  };

  const finish = async (operation: () => Promise<void>, errorMessage: string) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      refresh();
      setDraft(null);
    } catch {
      setError(errorMessage);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || (!draft.title.trim() && !draft.body.trim())) return;
    void finish(() => savePersonalNote(draft), "保存失败，内容仍在编辑框里，请重试。");
  };

  return (
    <section className="diary-app personal-notes-app">
      <header className="diary-app-header">
        <button type="button" className="diary-icon-btn" onClick={back} disabled={busy} aria-label="返回">
          <ChevronLeft size={20} />
        </button>
        <div><h1>{draft ? `${existing ? "编辑" : "新建"}${itemName}` : title}</h1></div>
        {!draft && loaded && <button type="button" className="diary-icon-btn personal-notes-add" onClick={create} aria-label={`新建${itemName}`}>
          <Plus size={22} />
        </button>}
      </header>

      {draft ? (
        <form className="personal-notes-body personal-note-editor" onSubmit={save}>
          {isDiary && <label>日期<input type="date" required value={draft.date} disabled={busy}
            onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>}
          <label>标题<input value={draft.title} disabled={busy}
            onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="选填" /></label>
          <label className="personal-note-content">正文<textarea value={draft.body} disabled={busy}
            onChange={event => setDraft({ ...draft, body: event.target.value })}
            placeholder={isDiary ? "写下今天的事…" : "记点什么…"} /></label>
          {error && <p className="personal-notes-error" role="alert">{error}</p>}
          <div className="personal-notes-actions">
            {existing && <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setConfirm("delete")} disabled={busy}><Trash2 size={16} /> 删除</button>}
            <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || (!draft.title.trim() && !draft.body.trim()) || (isDiary && !draft.date)}>
              {busy ? "处理中…" : "保存"}
            </button>
          </div>
        </form>
      ) : (
        <main className="personal-notes-body">
          {error ? <p className="personal-notes-error" role="alert">{error}</p> : loaded && (
            notes.length ? <ul className="personal-notes-list">
              {notes.map(note => (
                <li key={note.id}>
                  <button type="button" onClick={() => { setDraft(note); setError(""); }}>
                    <strong>{note.title || note.body.trim().split("\n")[0].slice(0, 32)}</strong>
                    <time dateTime={isDiary ? note.date : note.updatedAt}>
                      {isDiary ? note.date : new Date(note.updatedAt).toLocaleDateString("zh-CN")}
                    </time>
                    {note.body.trim() && <span>{note.body.trim()}</span>}
                  </button>
                </li>
              ))}
            </ul> : <div className="diary-entry-empty">
              <Icon size={32} strokeWidth={1.5} />
              <h2>{`还没有${itemName}`}</h2>
              <button type="button" onClick={create}>{`新建${itemName}`}</button>
            </div>
          )}
        </main>
      )}

      {confirm && <ConfirmDialog
        title={confirm === "delete" ? `删除这条${itemName}？` : "放弃本次编辑？"}
        message={confirm === "delete" ? "删除后无法恢复。" : "未保存的改动会丢失。"}
        variant="danger"
        confirmLabel={confirm === "delete" ? "删除" : "放弃"}
        onCancel={() => setConfirm(null)}
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

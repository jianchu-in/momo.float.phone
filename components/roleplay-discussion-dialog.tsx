"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, ChevronDown, Cpu, MessagesSquare, SlidersHorizontal, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import type { MascotPageContext } from "@/lib/mascot-context";
import {
  DISCUSSION_STYLES, deleteDiscussionPreset, discussRoleplay, getDiscussionCharacterIds, getDiscussionModelName,
  isBuiltInDiscussionPreset, loadDiscussionPresets, saveDiscussionPreset, type DiscussionPreset, type DiscussionTurn,
} from "@/lib/roleplay-discussion";

export function RoleplayDiscussionDialog({ context, onClose }: { context: MascotPageContext; onClose: () => void }) {
  const [presets, setPresets] = useState(loadDiscussionPresets);
  const [presetId, setPresetId] = useState("model");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetError, setPresetError] = useState("");
  const [prompt, setPrompt] = useState(presets[0].prompt);
  const [presetName, setPresetName] = useState("");
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
  const transcript = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const preset = presets.find(item => item.id === presetId) ?? presets[0];
  const builtInId = isBuiltInDiscussionPreset(preset.id) ? preset.id : null;
  const character = characters.find(item => item.id === characterId);
  const modelName = getDiscussionModelName(context, characterId);

  useEffect(() => {
    dialog.current?.focus();
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns, busy]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (editing) setEditing(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  function resetEditor(next: DiscussionPreset) {
    setPrompt(next.prompt);
    setPresetName(next.label);
    setCreating(false);
    setConfirmDelete(false);
    setPresetError("");
  }

  function changePreset(next: DiscussionPreset) {
    setPresetId(next.id);
    resetEditor(next);
    setTurns([]);
    setError("");
  }

  async function savePreset() {
    if (!prompt.trim() || ((creating || !builtInId) && !presetName.trim())) return;
    setPresetBusy(true);
    setPresetError("");
    const id = creating ? (globalThis.crypto?.randomUUID?.() ?? `preset_${Date.now()}_${Math.random().toString(36).slice(2)}`) : preset.id;
    try {
      await saveDiscussionPreset({ id, label: presetName, prompt });
      const saved = loadDiscussionPresets();
      setPresets(saved);
      const next = saved.find(item => item.id === id);
      if (next) {
        if (next.id === preset.id) resetEditor(next);
        else changePreset(next);
      }
      setEditing(false);
    } catch {
      setPresetError("预设保存失败，请重试。");
    } finally {
      setPresetBusy(false);
    }
  }

  async function removePreset() {
    setPresetBusy(true);
    setPresetError("");
    try {
      await deleteDiscussionPreset(preset.id);
      const saved = loadDiscussionPresets();
      setPresets(saved);
      changePreset(saved[0]);
      setEditing(false);
    } catch {
      setPresetError("预设删除失败，请重试。");
    } finally {
      setPresetBusy(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || controller.current || editing) return;
    const run = new AbortController();
    controller.current = run;
    const next: DiscussionTurn[] = [...turns, { role: "user", content: draft.trim() }];
    setTurns(next);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const content = await discussRoleplay(context, characterId, preset.prompt, next, run.signal);
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
    <section ref={dialog} role="dialog" aria-modal="true" aria-label="破壁聊天" tabIndex={-1}
      className="roleplay-discussion" onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)"));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}>
      <header className="discussion-header">
        <div className="discussion-title-icon"><MessagesSquare size={21} strokeWidth={1.7} /></div>
        <div className="discussion-title"><h2>破壁聊天</h2><p title={context.label}>{context.label}</p></div>
        <button type="button" className="discussion-icon-button" onClick={onClose} aria-label="关闭破壁聊天"><X size={19} /></button>
      </header>

      <div className="discussion-role">
        {characters.length > 1 ? <label className="discussion-select">
          <select aria-label="本次讨论的角色" value={characterId} disabled={busy || presetBusy} onChange={event => {
            setCharacterId(event.target.value);
            setTurns([]);
            setError("");
          }}>
            {characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select><ChevronDown size={14} />
        </label> : <span className="discussion-role-name" title={character?.name}>{character?.name || "当前场景"}</span>}
        <span className="discussion-model" title={modelName}><Cpu size={14} /><span>{modelName}</span></span>
      </div>

      <div className="discussion-preset-bar">
        <label className="discussion-select">
          <span>提示词预设</span>
          <select aria-label="提示词预设" value={preset.id} disabled={busy || presetBusy}
            onChange={event => {
              const next = presets.find(item => item.id === event.target.value);
              if (next) changePreset(next);
            }}>
            <optgroup label="内置预设">{presets.filter(item => isBuiltInDiscussionPreset(item.id)).map(item =>
              <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
            {presets.some(item => !isBuiltInDiscussionPreset(item.id)) && <optgroup label="我的预设">
              {presets.filter(item => !isBuiltInDiscussionPreset(item.id)).map(item =>
                <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>}
          </select><ChevronDown size={14} />
        </label>
        <button type="button" className="discussion-edit-toggle" aria-expanded={editing} disabled={busy || presetBusy}
          onClick={() => { if (!editing) resetEditor(preset); setEditing(!editing); }}>
          <SlidersHorizontal size={15} />{editing ? "收起" : "编辑"}
        </button>
      </div>

      {editing ? <div className="discussion-editor">
        {(creating || !builtInId) && <label>
          <span>预设名称</span>
          <input value={presetName} placeholder="输入预设名称" maxLength={40} disabled={presetBusy}
            onChange={event => setPresetName(event.target.value)} />
        </label>}
        <label className="discussion-prompt-field">
          <span>提示词</span>
          <textarea rows={5} value={prompt} maxLength={4000} disabled={presetBusy}
            onChange={event => setPrompt(event.target.value)} />
        </label>
        {presetError && <p className="roleplay-discussion-error" role="alert">{presetError}</p>}
        <div className="discussion-editor-actions">
          {creating ? <button type="button" disabled={presetBusy} onClick={() => {
            setCreating(false);
            setPresetName(preset.label);
          }}>取消另存</button> :
            <>
              {builtInId ? <button type="button" disabled={presetBusy} onClick={() => setPrompt(DISCUSSION_STYLES[builtInId].prompt)}>恢复默认</button> :
                <button type="button" className="discussion-delete" disabled={presetBusy}
                  onClick={() => confirmDelete ? void removePreset() : setConfirmDelete(true)}>
                  {confirmDelete ? "确认删除" : "删除预设"}
                </button>}
              <button type="button" disabled={presetBusy || !prompt.trim()}
                onClick={() => { setCreating(true); setPresetName(""); setConfirmDelete(false); }}>另存为新预设</button>
            </>}
          <button type="button" className="discussion-primary" disabled={presetBusy || !prompt.trim() || ((creating || !builtInId) && !presetName.trim())}
            onClick={() => void savePreset()}>{presetBusy ? "处理中…" : creating ? "保存新预设" : "保存修改"}</button>
        </div>
      </div> : <>
        <div className="roleplay-discussion-transcript" ref={transcript} role="log" aria-label="破壁聊天记录">
          {!turns.length && <div className="roleplay-discussion-empty">
            <MessagesSquare size={29} strokeWidth={1.35} />
            <p>可以聊角色为什么这么做，或讨论下一段怎么演。</p>
          </div>}
          {turns.map((turn, index) => <div key={index} className="discussion-bubble" data-role={turn.role}>
            <span>{turn.role === "user" ? "你" : preset.label}</span>
            <p>{turn.content}</p>
          </div>)}
          {busy && <p className="discussion-replying" role="status">正在回复…</p>}
        </div>
        {error && <p className="roleplay-discussion-error discussion-send-error" role="alert">{error}</p>}
        <form className="discussion-composer" onSubmit={send}>
          <textarea rows={2} aria-label="讨论内容" placeholder="聊聊你想怎么演…" maxLength={4000} value={draft} disabled={busy}
            onChange={event => setDraft(event.target.value)} />
          <button type="submit" className="discussion-primary discussion-send" aria-label="发送" disabled={busy || !draft.trim()}>
            <ArrowUp size={20} />
          </button>
        </form>
      </>}
    </section>
  </div>;
}

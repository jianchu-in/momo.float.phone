"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDiscussionKeyboard } from "@/components/use-discussion-keyboard";
import { useOverlayViewport } from "@/components/use-overlay-viewport";
import { focusWithoutScroll } from "@/lib/focus-without-scroll";
import { ArrowUp, ChevronDown, ChevronRight, Cpu, List, MessagesSquare, Plus, SlidersHorizontal, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import type { MascotPageContext } from "@/lib/mascot-context";
import {
  DISCUSSION_STYLES, deleteDiscussionPreset, discussRoleplay, getDiscussionCharacterIds, getDiscussionModelName,
  isBuiltInDiscussionPreset, loadDiscussionPresets, saveDiscussionPreset, type DiscussionPreset,
} from "@/lib/roleplay-discussion";
import {
  createDiscussionConversation, deleteDiscussionConversation, discussionId, discussionRetryUser, DISCUSSION_HISTORY_UPDATED, loadDiscussionConversations,
  updateDiscussionConversation, type DiscussionConversation, type DiscussionMessage,
} from "@/lib/roleplay-discussion-history";

function sceneCharacters(context: MascotPageContext) {
  const available = loadCharacters();
  return getDiscussionCharacterIds(context).flatMap(id => available.filter(character => character.id === id));
}

function newConversation(context: MascotPageContext) {
  return createDiscussionConversation(context, sceneCharacters(context)[0]);
}

export function RoleplayDiscussionDialog({ context, onClose }: { context: MascotPageContext; onClose: () => void }) {
  const [conversations, setConversations] = useState(loadDiscussionConversations);
  const [active, setActive] = useState<DiscussionConversation | null>(() =>
    conversations.length ? null : newConversation(context));
  const [deleting, setDeleting] = useState<string>();
  const [deleteError, setDeleteError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const viewportStyle = useOverlayViewport(backdrop, true, true);
  useDiscussionKeyboard(backdrop);

  useEffect(() => {
    const refresh = () => setConversations(loadDiscussionConversations());
    window.addEventListener(DISCUSSION_HISTORY_UPDATED, refresh);
    return () => window.removeEventListener(DISCUSSION_HISTORY_UPDATED, refresh);
  }, []);

  useEffect(() => { focusWithoutScroll(dialog.current); }, [active]);

  return <div ref={backdrop} className="roleplay-discussion-backdrop" style={viewportStyle} onClick={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label="破壁聊天" tabIndex={-1}
      className="roleplay-discussion" onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          if (active) setActive(null);
          else onClose();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)"));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault();
          focusWithoutScroll(last ?? null);
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          focusWithoutScroll(first ?? null);
        }
      }}>
      <header className="discussion-header">
        {active ? <button type="button" className="discussion-icon-button" onClick={() => setActive(null)} aria-label="对话列表" title="对话列表">
          <List size={19} />
        </button> : <div className="discussion-title-icon"><MessagesSquare size={21} strokeWidth={1.7} /></div>}
        <div className="discussion-title"><h2>{active ? "破壁聊天" : "破壁聊天 · 对话列表"}</h2>
          {active && <p title={active.context.label}>{active.context.label}</p>}
        </div>
        {active && <button type="button" className="discussion-icon-button discussion-new-icon"
          aria-label="新开对话" title="新开对话" onClick={() => setActive(newConversation(context))}><Plus size={19} /></button>}
        <button type="button" className="discussion-icon-button" onClick={onClose} aria-label="关闭破壁聊天"><X size={19} /></button>
      </header>
      {deleteError && <p className="roleplay-discussion-error" role="alert">{deleteError}</p>}
      {active ? <DiscussionChat key={active.id} initial={active} /> :
        <div className="discussion-history">
          <button type="button" className="discussion-primary discussion-new" onClick={() => setActive(newConversation(context))}>
            <Plus size={18} />新开对话
          </button>
          {conversations.length ? <ul className="discussion-history-list">
            {conversations.map(item => {
              const title = item.messages.find(message => message.role === "user")?.content.trim() || "破壁聊天";
              const last = item.messages.at(-1);
              const contextLine = [item.context.label, item.characterName && !item.context.label.includes(item.characterName) ? item.characterName : ""].filter(Boolean).join(" · ");
              return <li key={item.id}>
                <button type="button" onClick={() => setActive(item)} className="discussion-history-row">
                  <div>
                    <strong>{title}</strong>
                    <span>{contextLine}</span>
                    {last && last.content !== title && <p>{last.content}</p>}
                  </div>
                  <time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time>
                  <ChevronRight size={16} />
                </button>
                {deleting === item.id ? <div className="discussion-history-delete"><span>删除这段对话？</span><button type="button" onClick={() => { void deleteDiscussionConversation(item.id).then(() => setDeleting(undefined)).catch(() => setDeleteError("删除失败，请重试。")); }}>确认删除</button><button type="button" onClick={() => setDeleting(undefined)}>取消</button></div>
                  : <button type="button" className="discussion-history-delete" aria-label={`删除对话：${title}`} onClick={() => { setDeleteError("");setDeleting(item.id); }}>删除</button>}
              </li>;
            })}
          </ul> : <div className="roleplay-discussion-empty"><MessagesSquare size={27} strokeWidth={1.35} /><p>还没有对话记录</p></div>}
        </div>}
    </section>
  </div>;
}

function DiscussionChat({ initial }: { initial: DiscussionConversation }) {
  const [conversation, setConversation] = useState(initial);
  const { context, characterId, messages } = conversation;
  const [characters] = useState(() => sceneCharacters(context));
  const [presets, setPresets] = useState(loadDiscussionPresets);
  const preset = presets.find(item => item.id === conversation.presetId) ?? presets[0];
  const builtInId = isBuiltInDiscussionPreset(preset.id) ? preset.id : null;
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [presetError, setPresetError] = useState("");
  const [prompt, setPrompt] = useState(preset.prompt);
  const [presetName, setPresetName] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string>();
  const [messageAction, setMessageAction] = useState<"edit" | "delete" | "instruction">();
  const [messageDraft, setMessageDraft] = useState("");
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const selectedMessage = messages.find(item => item.id === menuId);
  function cancelPress() { clearTimeout(press.current); press.current = undefined; }
  function closeMessageMenu() { setMenuId(undefined);setMessageAction(undefined); }
  function openMessageMenu(id: string) { if (!controlsBusy) { cancelPress();setMenuId(id);setMessageAction(undefined); } }
  useEffect(() => () => cancelPress(), []);
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const modelName = getDiscussionModelName(context, characterId);
  const characterName = characters.find(item => item.id === characterId)?.name || conversation.characterName;
  const waitingMessage = messages.at(-1);
  const controlsBusy = busy || presetBusy || selectionBusy;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, busy, editing]);

  function resetEditor(next: DiscussionPreset) {
    setPrompt(next.prompt);
    setPresetName(next.label);
    setCreating(false);
    setConfirmDelete(false);
    setPresetError("");
  }

  async function changeSelection(selection: { presetId?: string; characterId?: string; characterName?: string }) {
    if (!messages.length) {
      setConversation({ ...conversation, ...selection });
      return true;
    }
    setSelectionBusy(true);
    try {
      setConversation(await updateDiscussionConversation(conversation, { selection }));
      return true;
    } catch {
      setError("对话设置保存失败，请重试。");
      return false;
    } finally {
      setSelectionBusy(false);
    }
  }

  async function changePreset(next: DiscussionPreset) {
    if (await changeSelection({ presetId: next.id })) resetEditor(next);
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
        else await changePreset(next);
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
      await changePreset(saved[0]);
      setEditing(false);
    } catch {
      setPresetError("预设删除失败，请重试。");
    } finally {
      setPresetBusy(false);
    }
  }

  async function ask(text: string, retry?: DiscussionMessage, replaceId?: string, instruction?: string) {
    if (!text || controller.current || editing || controlsBusy) return;
    const run = new AbortController();
    controller.current = run;
    setError("");
    setBusy(true);
    if (!retry) setDraft("");
    let saved = !!retry;
    const userMessage: DiscussionMessage = retry ?? { id: discussionId(), role: "user", speaker: "你", content: text };
    try {
      const current = retry ? conversation : await updateDiscussionConversation(conversation, { message: userMessage });
      saved = true;
      if (run.signal.aborted) return;
      setConversation(current);
      const userIndex = current.messages.findIndex(message => message.id === userMessage.id);
      const turns = current.messages.slice(0, userIndex + 1).map(({ role, content }) => ({ role, content }));
      if (instruction?.trim()) turns.push({ role: "user", content: `请按以下要求重新回答上一条消息：${instruction.trim()}` });
      const content = await discussRoleplay(context, characterId, preset.prompt, turns, run.signal);
      if (run.signal.aborted) return;
      const updated = await updateDiscussionConversation(current, {
        reply: { userId: userMessage.id, userContent: userMessage.content, replaceId, speaker: preset.label, content },
      });
      if (!run.signal.aborted) setConversation(updated);
    } catch (cause) {
      if (!run.signal.aborted) {
        setError(saved ? (cause instanceof Error ? cause.message : "发送失败。") : "消息未保存，请重试。");
        if (!saved) setDraft(text);
      }
    } finally {
      if (!run.signal.aborted) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  function retryMessage(message: DiscussionMessage, instruction?: string) {
    const user = discussionRetryUser(messages, message.id);
    if (!user) { setError("没有找到这条回复对应的用户消息。"); return; }
    closeMessageMenu();
    void ask(user.content, user, message.role === "assistant" ? message.id : undefined, instruction);
  }
  async function changeMessage(update: Parameters<typeof updateDiscussionConversation>[1]) {
    if (controlsBusy) return;
    setSelectionBusy(true);setError("");
    try { setConversation(await updateDiscussionConversation(conversation, update));closeMessageMenu(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "消息保存失败，请重试。"); }
    finally { setSelectionBusy(false); }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft.trim());
  }

  return <div className="discussion-chat" onKeyDown={event => {
    if (event.key === "Escape" && menuId) { event.preventDefault();closeMessageMenu();return; }
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      setEditing(false);
    }
  }}>
    <div className="discussion-role">
      {characters.length > 1 ? <label className="discussion-select">
        <select aria-label="本次讨论的角色" value={characterId} disabled={controlsBusy} onChange={event => {
          const next = characters.find(item => item.id === event.target.value);
          if (next) void changeSelection({ characterId: next.id, characterName: next.name });
        }}>
          {!characters.some(item => item.id === characterId) && <option value={characterId}>{characterName || "当前场景"}</option>}
          {characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select><ChevronDown size={14} />
      </label> : <span className="discussion-role-name" title={characterName}>{characterName || "当前场景"}</span>}
      <span className="discussion-model" title={modelName}><Cpu size={14} /><span>{modelName}</span></span>
    </div>

    <div className="discussion-preset-bar">
      <label className="discussion-select">
        <span>提示词预设</span>
        <select aria-label="提示词预设" value={preset.id} disabled={controlsBusy}
          onChange={event => {
            const next = presets.find(item => item.id === event.target.value);
            if (next) void changePreset(next);
          }}>
          <optgroup label="内置预设">{presets.filter(item => isBuiltInDiscussionPreset(item.id)).map(item =>
            <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
          {presets.some(item => !isBuiltInDiscussionPreset(item.id)) && <optgroup label="我的预设">
            {presets.filter(item => !isBuiltInDiscussionPreset(item.id)).map(item =>
              <option key={item.id} value={item.id}>{item.label}</option>)}
          </optgroup>}
        </select><ChevronDown size={14} />
      </label>
      <button type="button" className="discussion-edit-toggle" aria-expanded={editing} disabled={controlsBusy}
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
        {!messages.length && <div className="roleplay-discussion-empty">
          <MessagesSquare size={29} strokeWidth={1.35} />
          <p>可以聊角色为什么这么做，或讨论下一段怎么演。</p>
        </div>}
        {messages.map(message => <div key={message.id} className="discussion-bubble" data-role={message.role}
          onContextMenu={event => { event.preventDefault();openMessageMenu(message.id); }}
          onPointerDown={event => { if (event.pointerType === "mouse" && event.button !== 0) return;cancelPress();pressStart.current = { x: event.clientX, y: event.clientY };press.current = setTimeout(() => openMessageMenu(message.id), 500); }}
          onPointerMove={event => { if (pressStart.current && Math.hypot(event.clientX - pressStart.current.x, event.clientY - pressStart.current.y) > 8) cancelPress(); }}
          onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}>
          <span>{message.speaker}</span>
          <p>{message.content}</p>
          <button type="button" className="discussion-message-more" aria-label={`操作${message.role === "user" ? "用户" : "回复"}消息`} disabled={controlsBusy} onClick={() => openMessageMenu(message.id)}>···</button>
          {!!message.versions?.length && <div className="discussion-versions"><button type="button" aria-label="上一版回复" disabled={controlsBusy || !message.versionIndex} onClick={() => void changeMessage({ version: { id: message.id, index: (message.versionIndex ?? 0) - 1 } })}>‹</button><span>{(message.versionIndex ?? 0) + 1} / {message.versions.length}</span><button type="button" aria-label="下一版回复" disabled={controlsBusy || (message.versionIndex ?? 0) >= message.versions.length - 1} onClick={() => void changeMessage({ version: { id: message.id, index: (message.versionIndex ?? 0) + 1 } })}>›</button></div>}
        </div>)}
        {busy ? <p className="discussion-replying" role="status">正在回复…</p> :
          waitingMessage?.role === "user" && <button type="button" className="discussion-edit-toggle discussion-retry"
            disabled={controlsBusy} onClick={() => void ask(waitingMessage.content, waitingMessage)}>重试回复</button>}
      </div>
      {error && <p className="roleplay-discussion-error discussion-send-error" role="alert">{error}</p>}
      {selectedMessage && <div className="discussion-message-menu" role="dialog" aria-label="破壁消息操作">
        <header><strong>{messageAction === "edit" ? "编辑消息" : messageAction === "delete" ? "删除这条消息？" : messageAction === "instruction" ? "指令重试" : "消息操作"}</strong><button type="button" aria-label="关闭消息操作" onClick={closeMessageMenu}>关闭</button></header>
        {messageAction ? <>
          {messageAction !== "delete" && <textarea aria-label={messageAction === "edit" ? "编辑消息内容" : "重试指令"} rows={4} value={messageDraft} onChange={event => setMessageDraft(event.target.value)} />}
          <button type="button" disabled={controlsBusy || messageAction !== "delete" && !messageDraft.trim()} onClick={() => { if (messageAction === "instruction") retryMessage(selectedMessage, messageDraft);else void changeMessage(messageAction === "edit" ? { edit: { id: selectedMessage.id, content: messageDraft.trim() } } : { removeMessageId: selectedMessage.id }); }}>{messageAction === "delete" ? "确认删除" : messageAction === "edit" ? "保存消息" : "重新生成"}</button>
        </> : <div className="discussion-editor-actions"><button type="button" onClick={() => retryMessage(selectedMessage)}>重试</button><button type="button" onClick={() => { setMessageDraft(selectedMessage.content);setMessageAction("edit"); }}>编辑</button><button type="button" onClick={() => {setMessageDraft("");setMessageAction("instruction");}}>指令重试</button><button type="button" onClick={() => setMessageAction("delete")}>删除</button></div>}
      </div>}
      <form className="discussion-composer" onSubmit={send}>
        <textarea rows={2} aria-label="讨论内容" placeholder="聊聊你想怎么演…" maxLength={4000} value={draft} disabled={controlsBusy}
          onChange={event => setDraft(event.target.value)} />
        <button type="submit" className="discussion-primary discussion-send" aria-label="发送" disabled={controlsBusy || !draft.trim()}>
          <ArrowUp size={20} />
        </button>
      </form>
    </>}
  </div>;
}

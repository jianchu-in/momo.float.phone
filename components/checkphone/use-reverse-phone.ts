"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { abortableDelay, isAbortError, throwIfAborted } from "@/lib/abort-utils";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { hydrateChatStorage, loadChatMessages, loadChatSessions, pushChatMessage, updateMessageMediaData, getChatMessagePreview } from "@/lib/chat-storage";
import { CHAT_SCOPE_UPDATED_EVENT } from "@/lib/chat-scope-storage";
import { chatDb } from "@/lib/chat-db";
import { loadShoppingState } from "@/lib/shopping-storage";
import { hydrateReadingStorage, loadBooks } from "@/lib/reading-storage";
import { loadWalletState } from "@/lib/wallet-storage";
import { recoverReversePayments, reverseAllowedSessions, reverseCharacterFunds, sendReverseMessage, renameReverseContact, topUpReverseWallet, payReverseCart } from "@/lib/reverse-phone-actions";
import { requestReverseSection, requestReverseChat } from "@/lib/reverse-phone-engine";
import { allowedReverseApps, appendReverseEvent, assertReverseScope, createReverseSession, loadReverseSession, loadReverseSettings, loadUserBrowser, rememberReverseSession, resolveReversePermissions, reverseId, saveReverseSession } from "@/lib/reverse-phone-storage";
import { REVERSE_APPS, type ChatDecision, type ReverseApp, type ReverseChatControl, type ReverseResult, type ReverseScope, type ReverseSession, type ReverseTask } from "@/lib/reverse-phone-types";

export type ReverseScreen = { app: "desktop" | ReverseApp; locked?: boolean; section?: string; itemId?: string; chat?: ReverseChatControl };
type ReverseRunOptions = { invitationOnly?: boolean; autoContinue?: boolean; onAccepted?: (sessionId: string) => void };
export function useReversePhone(scope: ReverseScope, host: RefObject<HTMLDivElement | null>, initialCharacterId?: string, inviteSessionId?: string, resumeSessionId?: string, options: ReverseRunOptions = {}) {
  const [characterId, setCharacterId] = useState(initialCharacterId ?? loadCharacters()[0]?.id ?? "");
  const [session, setSession] = useState<ReverseSession | null>(() => resumeSessionId ? loadReverseSession(resumeSessionId) : null);
  const latest = useRef(session);
  const [screen, setScreen] = useState<ReverseScreen>({ app: "desktop" });
  const [running, setRunning] = useState(false), [loading, setLoading] = useState(""), [speech, setSpeech] = useState("");
  const [error, setError] = useState(""), [toast, setToast] = useState("");
  const [touch, setTouch] = useState({ x: 60, y: 120, visible: false, pressed: false });
  const controller = useRef<AbortController | null>(null), currentTask = useRef<ReverseTask | null>(null), busy = useRef(false);
  const interruption = useRef(0), preparing = useRef(false);
  const lifetime = useRef(true), farewell = useRef("");
  useEffect(() => {
    lifetime.current = true;
    const changed = () => { controller.current?.abort(); setRunning(false); setError("用户身份或聊天账号已切换，请重新进入我的手机。"); };
    window.addEventListener(CHAT_SCOPE_UPDATED_EVENT, changed);
    return () => { lifetime.current = false; controller.current?.abort(); window.removeEventListener(CHAT_SCOPE_UPDATED_EVENT, changed); };
  }, []);
  async function persist(value: ReverseSession, remember = false) {
    latest.current = value; if (lifetime.current) setSession(value);
    await saveReverseSession(value);
    if (remember) await rememberReverseSession(value);
  }
  async function event(kind: "view" | "speech" | "action" | "control", text: string, id?: string) {
    if (latest.current) await persist(appendReverseEvent(latest.current, kind, text, id), true);
  }
  function actor() { const character = loadCharacters().find(item => item.id === (latest.current?.characterId ?? characterId)); if (!character) throw new Error("请选择查岗角色。"); return character; }
  async function showSpeech(text: string | undefined, signal: AbortSignal, key: string) {
    if (!text?.trim()) return;
    throwIfAborted(signal); setLoading(""); setSpeech(text);
    await event("speech", `我说：“${text}”`, key);
    await abortableDelay(Math.max(1800, Math.min(9000, text.length * 105)), signal);
    setSpeech("");
  }
  const selector = (value: string) => value.replace(/["\\]/g, "\\$&");
  async function settle(signal: AbortSignal) { await abortableDelay(180, signal); }
  async function tap(target: string, signal: AbortSignal, sessionTarget = false) {
    throwIfAborted(signal);
    const element = host.current?.querySelector<HTMLElement>(sessionTarget ? `[data-reverse-session="${selector(target)}"]` : `[data-rp-target="${selector(target)}"], [data-reverse-target="${selector(target)}"]`);
    if (!element) return;
    const parent = host.current!.getBoundingClientRect();
    let rect = element.getBoundingClientRect();
    if (rect.top < parent.top + 60 || rect.bottom > parent.bottom - 90) {
      setTouch({ x: parent.width * .64, y: parent.height * .66, visible: true, pressed: true });
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      setTouch({ x: parent.width * .64, y: parent.height * .35, visible: true, pressed: true });
      await abortableDelay(450, signal); rect = element.getBoundingClientRect();
    }
    setTouch({ x: (rect.left - parent.left + rect.width / 2) * ((host.current?.clientWidth || parent.width) / parent.width), y: (rect.top - parent.top + rect.height / 2) * ((host.current?.clientHeight || parent.height) / parent.height), visible: true, pressed: false });
    await abortableDelay(350, signal); setTouch(value => ({ ...value, pressed: true }));
    await abortableDelay(170, signal); setTouch(value => ({ ...value, pressed: false }));
    await abortableDelay(120, signal);
  }
  async function scrollChat(messageIds: string[], signal: AbortSignal) {
    const scroll = host.current?.querySelector<HTMLElement>('[data-reverse-chat-scroll]');
    if (!scroll || !messageIds.length) return;
    const first = host.current?.querySelector<HTMLElement>(`[id="message-${selector(messageIds[0])}"]`);
    if (first) { first.scrollIntoView({ block: "start", behavior: "smooth" }); await abortableDelay(450, signal); }
    const end = scroll.scrollHeight - scroll.clientHeight;
    const start = scroll.scrollTop;
    for (let position = start; position < end; position += Math.max(80, scroll.clientHeight * .7)) {
      throwIfAborted(signal);
      const rect = host.current!.getBoundingClientRect();
      setTouch({ x: rect.width * .76, y: rect.height * .6, visible: true, pressed: true });
      scroll.scrollTo({ top: Math.min(end, position + Math.max(80, scroll.clientHeight * .7)), behavior: "smooth" });
      setTouch({ x: rect.width * .76, y: rect.height * .35, visible: true, pressed: true });
      await abortableDelay(480, signal);
    }
    setTouch(value => ({ ...value, visible: false, pressed: false }));
  }
  async function taskState(id: string, state: ReverseTask["state"], result?: ReverseResult | ChatDecision) {
    const value = latest.current!;
    await persist({ ...value, tasks: value.tasks.map(task => task.id === id ? { ...task, state, ...(result ? { result } : {}) } : task) });
  }
  function permissions() { return resolveReversePermissions(actor().id, scope); }
  async function section(character: Character, task: ReverseTask, kind: string, data: unknown, signal: AbortSignal) {
    if (task.result) return task.result as ReverseResult;
    setLoading("Ta正在查看…"); setSpeech(""); setTouch(value => ({ ...value, visible: false }));
    const result = await requestReverseSection(character, scope, kind, data, signal);
    await taskState(task.id, "pending", result);
    if (result.farewell) farewell.current = result.farewell;
    return result;
  }
  async function visibleSessions(signal: AbortSignal) {
    const allowed = reverseAllowedSessions(actor().id, scope);
    for (let attempt = 0; attempt < 15; attempt++) {
      throwIfAborted(signal);
      const bounds = host.current?.querySelector('.chat-main-content')?.getBoundingClientRect();
      const rows = host.current?.querySelectorAll<HTMLElement>('[data-reverse-session]');
      if (bounds && rows?.length) {
        const ids = [...rows].filter(row => { const rect = row.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.top >= bounds.top && rect.bottom <= bounds.bottom; }).map(row => row.dataset.reverseSession);
        return allowed.filter(item => ids.includes(item.id));
      }
      if (!loadChatSessions().length) return [];
      await abortableDelay(120, signal);
    }
    return [];
  }
  async function playTask(task: ReverseTask, signal: AbortSignal) {
    assertReverseScope(scope); throwIfAborted(signal);
    const character = actor(), p = permissions();
    currentTask.current = task;
    if (task.kind !== "desktop" && task.app && p.modes[task.app] === "hidden") { await taskState(task.id, "skipped"); return; }
    if (task.kind === "app") { setScreen({ app: "desktop" }); await settle(signal); }
    if (task.kind === "desktop") {
      setScreen({ app: "desktop" }); await settle(signal);
      const apps = allowedReverseApps(character.id, scope);
      await event("view", `我看到了${scope.userName}的手机桌面。`, `${task.id}:view`);
      const result = await section(character, task, "desktop", { 用户: scope.userName, 应用: apps.map(id => ({ id, name: REVERSE_APPS[id] })) }, signal);
      await showSpeech(result.reaction, signal, `${task.id}:speech`);
      const order = [...new Set([...(result.order ?? []).filter(app => apps.includes(app)), ...apps])];
      const queued = order.map(app => ({ id: `${task.id}:app:${app}`, kind: "app" as const, app, state: "pending" as const }));
      await persist({ ...latest.current!, tasks: [...latest.current!.tasks, ...queued.filter(item => !latest.current!.tasks.some(existing => existing.id === item.id))] });
    } else if (task.app && p.modes[task.app] === "locked") {
      await tap(`app:${task.app}`, signal); setScreen({ app: task.app, locked: true }); await settle(signal);
      await event("view", `我点开${REVERSE_APPS[task.app]}，看到“该APP已被用户隐私锁定”，没有读取其中内容。`, `${task.id}:view`);
      const result = await section(character, task, "locked", { 应用: REVERSE_APPS[task.app], 提示: "该APP已被用户隐私锁定" }, signal);
      await showSpeech(result.reaction, signal, `${task.id}:speech`);
    } else if (task.kind === "conversation") {
      const target = reverseAllowedSessions(character.id, scope).find(item => item.id === task.targetId);
      if (!target) { await taskState(task.id, "skipped"); return; }
      setScreen({ app: "chat", chat: { page: "messages" } }); await settle(signal); await tap(target.id, signal, true);
      setScreen({ app: "chat", chat: { page: "messages", sessionId: target.id } }); await abortableDelay(350, signal);
      const messages = loadChatMessages(target.id).filter(message => ["user", "assistant"].includes(message.role) && !message.isRetracted && !["tool_call", "tool_result", "memory_write_request"].includes(message.mediaType ?? "")).slice(-20);
      const peer = loadCharacters().find(item => item.id === target.contactId)!;
      await scrollChat(messages.map(message => message.id), signal);
      await event("view", `我查看了${scope.userName}与${peer.name}的最近${messages.length}条聊天：\n${messages.map(message => `${message.senderName || (message.role === "user" ? scope.userName : peer.name)}：${getChatMessagePreview(message).slice(0, 2000)}`).join("\n")}`, `${task.id}:view`);
      setLoading("Ta正在查看…"); setSpeech("");
      let decision = task.result as ChatDecision | undefined;
      if (!decision) {
        decision = await requestReverseChat(character, scope, { 联系人: peer.name, 备注: target.alias || peer.name, 是否自己的会话: peer.id === character.id,
          权限: { 允许回复: p.chat.reply, 允许修改备注: p.chat.remark }, 最近20条: messages.map(message => ({ role: message.role, text: getChatMessagePreview(message).slice(0, 2000) })) }, signal,
        preview => { if (p.chat.reply && ["reply", "both"].includes(preview.action)) { setLoading(""); setScreen({ app: "chat", chat: { page: "messages", sessionId: target.id, draft: preview.reply, typing: true } }); } });
        await taskState(task.id, "pending", decision);
      }
      const reply = ["reply", "both"].includes(decision.action), remark = ["remark", "both"].includes(decision.action);
      if ((reply && !permissions().chat.reply) || (remark && !permissions().chat.remark)) throw new Error("角色返回的操作超出当前权限，请重试或跳过。");
      if (!reply && !remark) await showSpeech(decision.reaction, signal, `${task.id}:speech`);
      if (reply) {
        setLoading(""); setScreen({ app: "chat", chat: { page: "messages", sessionId: target.id, draft: decision.reply, typing: true } });
        await abortableDelay(600, signal); await tap("send", signal);
        setScreen({ app: "chat", chat: { page: "messages", sessionId: target.id, draft: decision.reply, sending: true } });
        const message = await sendReverseMessage(character, scope, target.id, decision.reply, `${latest.current!.id}:${task.id}:reply`);
        await event("action", `我替${scope.userName}给${peer.name}发送了：“${message.content}”`, `${task.id}:reply`);
        throwIfAborted(signal); setScreen({ app: "chat", chat: { page: "messages", sessionId: target.id, draft: "" } }); await abortableDelay(450, signal);
      }
      if (remark) {
        setLoading(`他正在修改你对${peer.name}的备注…`); await abortableDelay(900, signal);
        const alias = await renameReverseContact(character.id, scope, target.id, decision.remark, `${latest.current!.id}:${task.id}:remark`);
        await event("action", `我把${scope.userName}给${peer.name}的备注改成了“${alias}”。`, `${task.id}:remark`);
        setLoading(""); setToast(`备注已修改为：${alias}`); await abortableDelay(800, signal); setToast("");
      }
      await tap("back", signal); setScreen({ app: "chat", chat: { page: "messages" } }); await settle(signal);
    } else if (task.kind === "assets") {
      if (!p.chat.assets) { await taskState(task.id, "skipped"); return; }
      setScreen({ app: "chat", chat: { page: "messages" } }); await settle(signal);
      await tap("profile", signal); setScreen({ app: "chat", chat: { page: "me" } }); await settle(signal);
      await tap("assets", signal); setScreen({ app: "chat", chat: { page: "wallet" } }); await settle(signal);
      const wallet = loadWalletState();
      await event("view", `我查看了${scope.userName}的资产，余额为${wallet.balance.toFixed(2)}元。银行卡：${wallet.cards.map(card => `${card.title} ${card.maskedNumber}，余额${card.balance}`).join("；")}。`, `${task.id}:view`);
      const result = await section(character, task, "assets", { 用户余额: wallet.balance, 用户银行卡: wallet.cards.map(({ title, maskedNumber, balance }) => ({ title, maskedNumber, balance })), 我的可用资产: await reverseCharacterFunds(character.id), 允许充值: p.chat.balance }, signal);
      if (result.amount) {
        if (!permissions().chat.balance) throw new Error("修改余额权限已关闭。");
        await topUpReverseWallet(character, scope, result.amount, `${latest.current!.id}:${task.id}:topup`);
        await event("action", `我从自己的资产扣除${result.amount}元，给${scope.userName}充值；余额变为${loadWalletState().balance.toFixed(2)}元。`, `${latest.current!.id}:${task.id}:topup`);
      }
      throwIfAborted(signal); await showSpeech(result.reaction, signal, `${task.id}:speech`);
    } else if (task.app === "chat") {
      await tap("app:chat", signal); setScreen({ app: "chat", chat: { page: "messages" } }); await settle(signal);
      const visible = await visibleSessions(signal);
      await event("view", `我查看了当前屏幕的聊天列表：${visible.map(item => item.alias || loadCharacters().find(character => character.id === item.contactId)?.name).join("、") || "没有允许查看的可见会话"}。`, `${task.id}:view`);
      const result = await section(character, task, "chat", { 当前屏幕会话: visible.map(item => ({ id: item.id, name: item.alias || loadCharacters().find(character => character.id === item.contactId)?.name, preview: item.lastMessagePreview })) }, signal);
      await showSpeech(result.reaction, signal, `${task.id}:speech`);
      const ids = [...new Set(result.sessions ?? [])].filter(id => visible.some(item => item.id === id));
      const next: ReverseTask[] = ids.map(targetId => ({ id: `${task.id}:conversation:${targetId}`, kind: "conversation", app: "chat", targetId, state: "pending" }));
      if (p.chat.assets) next.push({ id: `${task.id}:assets`, kind: "assets", app: "chat", state: "pending" });
      const tasks = [...latest.current!.tasks], index = tasks.findIndex(item => item.id === task.id);
      tasks.splice(index + 1, 0, ...next.filter(item => !tasks.some(existing => existing.id === item.id))); await persist({ ...latest.current!, tasks });
    } else if (task.app) {
      const app = task.app; await tap(`app:${app}`, signal);
      const sectionName = app === "shopping" ? (p.shopping.cart ? "cart" : "orders") : app === "browser" ? (p.browser.history ? "history" : "bookmarks") : "shelf";
      setScreen({ app, section: sectionName }); await settle(signal);
      const shopping = app === "shopping" ? loadShoppingState() : { cartItems: [], orders: [] }, browser = app === "browser" ? loadUserBrowser(scope) : [], books = app === "reading" ? loadBooks() : [];
      let data: unknown, allowed = new Set<string>();
      if (app === "shopping") {
        data = { 购物车: p.shopping.cart ? shopping.cartItems : "无权查看", 订单: p.shopping.orders ? shopping.orders : "无权查看", 我的可用资产: await reverseCharacterFunds(character.id) };
        allowed = new Set([...(p.shopping.cart ? ["cart", ...shopping.cartItems.map(item => "cart:" + item.id)] : []), ...(p.shopping.orders ? ["orders", ...shopping.orders.map(item => "order:" + item.id)] : [])]);
        await event("view", `我查看了${scope.userName}的购物APP。${p.shopping.cart ? `购物车：${shopping.cartItems.map(item => `${item.title} ${item.priceLabel} ${item.quantityLabel}`).join("；") || "空"}。` : ""}${p.shopping.orders ? `订单：${shopping.orders.map(item => `${item.summary} ${item.totalLabel} ${item.statusLabel}`).join("；") || "空"}。` : ""}`, `${task.id}:view`);
      } else if (app === "browser") {
        const entries = browser.filter(item => p.browser[item.kind]);
        data = { 历史记录: p.browser.history ? entries.filter(item => item.kind === "history") : "无权查看", 收藏夹: p.browser.bookmarks ? entries.filter(item => item.kind === "bookmarks") : "无权查看" };
        allowed = new Set([...(p.browser.history ? ["history"] : []), ...(p.browser.bookmarks ? ["bookmarks"] : []), ...entries.map(item => "entry:" + item.id)]);
        await event("view", `我查看了${scope.userName}的浏览器。${entries.map(item => `${item.kind === "history" ? "历史记录" : "收藏"}《${item.title}》 ${item.url}：${item.description}`).join("；") || "允许查看的栏目没有记录"}。`, `${task.id}:view`);
      } else {
        data = { 书架: books.map(({ id, title }) => ({ id, title })) }; allowed = new Set(books.map(item => "book:" + item.id));
        await event("view", `我查看了${scope.userName}的阅读书架，书名有：${books.map(item => `《${item.title}》`).join("、") || "书架为空"}。`, `${task.id}:view`);
      }
      const result = await section(character, task, app, data, signal);
      if (!result.payCartIds?.length) await showSpeech(result.reaction, signal, `${task.id}:speech`);
      for (const [index, step] of (result.steps ?? []).entries()) {
        if (!allowed.has(step.target)) continue;
        throwIfAborted(signal);
        let section = sectionName;
        if (["cart", "orders", "history", "bookmarks"].includes(step.target)) section = step.target;
        else if (step.target.startsWith("cart:")) section = "cart";
        else if (step.target.startsWith("order:")) section = "orders";
        else if (step.target.startsWith("entry:")) section = browser.find(item => item.id === step.target.slice(6))?.kind ?? section;
        setScreen({ app, section }); await settle(signal); await tap(step.target, signal);
        if (!step.target.startsWith("book:") && step.target.includes(":")) setScreen({ app, section, itemId: step.target });
        await abortableDelay(2000, signal); await showSpeech(step.speech, signal, `${task.id}:step:${index}`);
        setScreen({ app, section });
      }
      if (app === "shopping" && result.payCartIds?.length) {
        const ids = result.payCartIds;
        if (!p.shopping.cart) throw new Error("购物车权限已关闭。");
        setScreen({ app, section: "cart" }); await settle(signal); await tap("buy", signal);
        const summary = await payReverseCart(character, scope, ids, `${latest.current!.id}:${task.id}:purchase`);
        await event("action", `我用自己的资产替${scope.userName}购买了${summary}。`, `${latest.current!.id}:${task.id}:purchase`);
        throwIfAborted(signal); await showSpeech(result.reaction, signal, `${task.id}:speech`);
      }
    }
    throwIfAborted(signal); await taskState(task.id, "done");
    if (task.kind !== "desktop" && task.kind !== "conversation" && !(task.kind === "app" && task.app === "chat")) { setScreen({ app: "desktop" }); await settle(signal); }
  }
  async function invite(character: Character, signal: AbortSignal) {
    const record = latest.current!, target = loadChatSessions().find(item => item.id === record.inviteSessionId);
    if (!target || target.isGroup || target.contactId !== character.id || (target.chatAccountId || null) !== scope.chatAccountId) throw new Error("邀请会话已不可用。");
    let messageId = record.inviteMessageId;
    if (!messageId || !loadChatMessages(target.id).some(item => item.id === messageId)) {
      const card = pushChatMessage({ role: "user", sessionId: target.id, senderName: scope.userName, mediaType: "app_card", content: "主动邀请你共享屏幕，是否同意？",
        mediaData: { appId: "reverse-phone", appName: "他来查岗", appCardTitle: "主动邀请你共享屏幕，是否同意？", appCardBody: "等待角色回应", appSceneId: record.id } });
      messageId = card.id; await persist({ ...latest.current!, inviteMessageId: card.id });
      await chatDb.messages.put(card);
      window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: target.id } }));
    }
    setLoading("等待角色同意共享屏幕…");
    const response = record.invitation ?? await requestReverseSection(character, scope, "invite", { 用户: scope.userName, 邀请: "主动邀请你共享屏幕，是否同意？" }, signal);
    const result = { accepted: response.accepted === true, reaction: response.reaction || (response.accepted ? "好，让我看看。" : "现在先不了。") };
    throwIfAborted(signal);
    await persist({ ...latest.current!, invitation: result });
    const card = loadChatMessages(target.id).find(item => item.id === messageId);
    if (card) {
      updateMessageMediaData(messageId, { ...card.mediaData, appCardBody: result.accepted ? "角色已同意共享屏幕" : "角色暂未同意共享屏幕" });
      await chatDb.messages.put(loadChatMessages(target.id).find(item => item.id === messageId)!);
    }
    const answer = loadChatMessages(target.id).find(item => item.mediaData?.reversePhoneOperationId === record.id + ":invite-answer")
      ?? pushChatMessage({ role: "assistant", sessionId: target.id, senderName: character.name, content: result.reaction, mediaData: { reversePhoneOperationId: record.id + ":invite-answer" } });
    await chatDb.messages.put(answer);
    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: target.id } }));
    await event("control", result.accepted ? "我同意了共享屏幕邀请。" : "我没有同意这次共享屏幕邀请。", record.id + ":consent");
    await persist({ ...latest.current!, accepted: result.accepted, status: result.accepted ? "running" : "stopped" });
    await showSpeech(result.reaction, signal, `${record.id}:invite`);
    return result.accepted;
  }
  async function execute() {
    if (busy.current || !latest.current) return;
    busy.current = true; const control = new AbortController(); controller.current = control;
    setRunning(true); setError("");
    try {
      assertReverseScope(scope); await hydrateChatStorage();
      if (!options.invitationOnly) {
        await hydrateReadingStorage();
        for (const receipt of await recoverReversePayments(scope, latest.current!.id)) await event("action", receipt.text, receipt.id);
      }
      throwIfAborted(control.signal);
      await persist({ ...latest.current!, status: "running", error: undefined });
      if (latest.current!.inviteSessionId && latest.current!.accepted !== true && !(await invite(actor(), control.signal))) return;
      throwIfAborted(control.signal);
      if (options.invitationOnly) {
        await persist({ ...latest.current!, status: "paused" });
        throwIfAborted(control.signal); options.onAccepted?.(latest.current!.id); return;
      }
      while (latest.current!.tasks.some(task => task.state === "pending")) {
        const task = latest.current!.tasks.find(task => task.state === "pending")!;
        await playTask(task, control.signal);
      }
      await showSpeech(farewell.current || "看完了，手机还给你。", control.signal, latest.current!.id + ":farewell");
      await persist({ ...latest.current!, status: "completed" }, true); setScreen({ app: "desktop" });
    } catch (cause) {
      if (!control.signal.aborted && !isAbortError(cause)) { const message = cause instanceof Error ? cause.message : "查岗失败，请重试或跳过这部分。"; setError(message); await persist({ ...latest.current!, status: "paused", error: message }, true); }
    } finally { controller.current = null; busy.current = false; if (lifetime.current) { setRunning(false); setLoading(""); setTouch(value => ({ ...value, visible: false, pressed: false })); } }
  }
  async function start(withInvite = false) {
    if (busy.current || preparing.current) return;
    preparing.current = true; const version = ++interruption.current;
    try {
      const character = loadCharacters().find(item => item.id === characterId); if (!character) throw new Error("请选择查岗角色。");
      const value = { ...createReverseSession(character, scope), ...(withInvite && inviteSessionId ? { inviteSessionId } : {}) };
      farewell.current = ""; currentTask.current = value.tasks[0]; setSpeech(""); await persist(value); if (version === interruption.current && lifetime.current) await execute();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始查岗。"); }
    finally { preparing.current = false; }
  }
  async function stop() {
    interruption.current++;
    controller.current?.abort(); setSpeech(""); setLoading("");
    if (latest.current && latest.current.status !== "completed") {
      await event("control", "用户抢回了手机，我停止了查岗。");
      await persist({ ...latest.current!, status: "stopped" }, true);
    }
    setRunning(false); setScreen({ app: "desktop" });
  }
  async function skip(block = false) {
    const version = ++interruption.current;
    const task = currentTask.current ?? latest.current?.tasks.find(item => item.state === "pending");
    controller.current?.abort(); setSpeech(""); setLoading("");
    if (!task || !latest.current) return;
    // Wait for the aborted request's finally block before starting its replacement.
    while (busy.current) await abortableDelay(20);
    if (!lifetime.current || version !== interruption.current || latest.current.status === "stopped") return;
    for (const receipt of await recoverReversePayments(scope, latest.current.id)) await event("action", receipt.text, receipt.id);
    if (latest.current.inviteSessionId && latest.current.accepted !== true) { await stop(); return; }
    await taskState(task.id, "skipped");
    if (task.kind === "app" && task.app === "chat") await persist({ ...latest.current!, tasks: latest.current!.tasks.map(item => item.app === "chat" && item.state === "pending" ? { ...item, state: "skipped" } : item) });
    await event("control", block ? `用户阻止了我继续查看${task.kind === "conversation" ? "当前聊天会话" : task.app ? REVERSE_APPS[task.app] : "当前页面"}，这部分本次不再查看。` : "我跳过了当前未完成的部分。");
    if (version !== interruption.current) return;
    if (block) {
      const control = new AbortController(); controller.current = control; busy.current = true; setRunning(true); setLoading("…");
      let failed = false;
      try { const result = await requestReverseSection(actor(), scope, "blocked", { 用户说: "不要看这个" }, control.signal); await showSpeech(result.reaction, control.signal, task.id + ":blocked"); }
      catch (cause) { if (!isAbortError(cause)) { failed = true; const message = cause instanceof Error ? cause.message : "回应失败。"; setError(message); await persist({ ...latest.current!, status: "paused", error: message }, true); } }
      finally { controller.current = null; busy.current = false; setRunning(false); setLoading(""); }
      if (failed || control.signal.aborted || !lifetime.current) return;
    }
    setScreen({ app: "desktop" }); await execute();
  }
  async function restore(id: string) {
    const value = loadReverseSession(id);
    if (!value || value.scope.key !== scope.key) { setError("找不到当前账号的查岗记录。"); return; }
    latest.current = value; currentTask.current = value.tasks.find(item => item.state === "pending") ?? null; setSession(value); setCharacterId(value.characterId); setError(value.error ?? "");
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      if (resumeSessionId) void restore(resumeSessionId).then(() => {
        const record = latest.current;
        if (record?.scope.key !== scope.key || record.id !== resumeSessionId || record.status === "stopped" || record.status === "completed") return;
        if (options.invitationOnly || (options.autoContinue && record.accepted === true)) void execute();
      });
      else if (inviteSessionId && options.invitationOnly) void start(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return { characterId, setCharacterId, session, screen, setScreen, running, loading, speech, error, toast, setToast, touch,
    start, execute, stop, skip, restore, currentTask };
}

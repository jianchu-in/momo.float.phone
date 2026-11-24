import type { Character } from "./character-types";
import { loadPhoneSnapshot, updatePhoneSnapshot } from "./checkphone-storage";
import type { CheckPhoneAssetsPayload } from "./checkphone-config";
import { loadChatMessages, loadChatSessions, pushChatMessage, saveChatSessions, type ChatMessage, type ChatSession } from "./chat-storage";
import { chatDb } from "./chat-db";
import { getCharacterWorldGroup } from "./character-world-storage";
import { loadCharacters } from "./character-storage";
import { kvGet, kvKeysWithPrefix, kvUpdatePersisted } from "./kv-db";
import { loadWalletState, WALLET_UPDATED_EVENT, WALLET_BALANCE_ACCOUNT_ID } from "./wallet-storage";
import type { WalletState } from "./wallet-types";
import { loadShoppingState, SHOPPING_STATE_UPDATED_EVENT } from "./shopping-storage";
import type { ShoppingOrder, ShoppingState } from "./shopping-types";
import { buildShoppingShippingTimeline } from "./shopping-payment-request";
import { assertReverseScope, readReverseJson, resolveReversePermissions, REVERSE_PREFIX } from "./reverse-phone-storage";
import type { ReverseScope } from "./reverse-phone-types";

export function reverseMoney(value: unknown): number {
  const text = String(value ?? "").replace(/[,\s¥￥$元]/g, "");
  if (!/^[+-]?\d+(?:\.\d+)?(?:万|亿)?$/.test(text)) return 0;
  const factor = text.endsWith("亿") ? 1e8 : text.endsWith("万") ? 1e4 : 1;
  const result = Math.round(parseFloat(text) * factor * 100) / 100;
  return Number.isFinite(result) && result >= 0 ? result : 0;
}
const cents = (amount: number) => Math.round(amount * 100);
export async function reverseCharacterFunds(characterId: string) {
  const snapshot = await loadPhoneSnapshot<CheckPhoneAssetsPayload>(characterId, "assets");
  return (snapshot?.payload.accounts ?? []).filter(account => ["cash", "savings"].includes(account.kind)).reduce((sum, account) => sum + cents(reverseMoney(account.balance)), 0) / 100;
}
export async function debitReverseCharacter(characterId: string, amount: number, operationId: string, title: string) {
  if (!Number.isFinite(amount) || cents(amount) <= 0) throw new Error("付款金额无效。");
  return updatePhoneSnapshot<CheckPhoneAssetsPayload>(characterId, "assets", current => {
    const previous = current.payload.activities.filter(activity => activity.id.startsWith(operationId + ":"));
    if (previous.length) {
      const charged = previous.reduce((sum, item) => sum + cents(reverseMoney(item.amount.replace(/^-/, ""))), 0);
      if (charged !== cents(amount)) throw new Error("这笔操作已有不同的扣款记录，请恢复原操作。");
      return current;
    }
    const total = current.payload.accounts.filter(account => ["cash", "savings"].includes(account.kind)).reduce((sum, account) => sum + cents(reverseMoney(account.balance)), 0);
    if (total < cents(amount)) throw new Error("角色可用资产不足，本次未扣款。");
    let remaining = cents(amount);
    const now = new Date().toISOString(), activities = [...current.payload.activities];
    const accounts = current.payload.accounts.map((account, index) => {
      if (!remaining || !["cash", "savings"].includes(account.kind)) return account;
      const balance = cents(reverseMoney(account.balance)), used = Math.min(balance, remaining);
      remaining -= used;
      if (used) activities.push({ id: `${operationId}:${index}`, accountId: account.id, title, amount: `-${(used / 100).toFixed(2)}`, category: "反查岗", createdAt: now, detail: title });
      return { ...account, balance: `¥${((balance - used) / 100).toFixed(2)}` };
    });
    return { ...current, updatedAt: now, payload: { ...current.payload, accounts, activities } };
  });
}
export function reverseAllowedSessions(characterId: string, scope: ReverseScope): ChatSession[] {
  const permissions = resolveReversePermissions(characterId, scope);
  const world = getCharacterWorldGroup(characterId);
  const targets = new Set(permissions.chat.targets ?? world?.memberIds ?? [characterId]);
  const characters = new Set(loadCharacters().map(character => character.id));
  return loadChatSessions().filter(session => !session.isGroup && (session.chatAccountId || null) === scope.chatAccountId
    && targets.has(session.contactId) && characters.has(session.contactId));
}
function permittedSession(characterId: string, scope: ReverseScope, sessionId: string) {
  assertReverseScope(scope);
  const session = reverseAllowedSessions(characterId, scope).find(item => item.id === sessionId);
  if (!session || resolveReversePermissions(characterId, scope).modes.chat !== "open") throw new Error("这个会话当前不允许查看。");
  return session;
}
export async function sendReverseMessage(character: Character, scope: ReverseScope, sessionId: string, text: string, operationId: string): Promise<ChatMessage> {
  permittedSession(character.id, scope, sessionId);
  if (!resolveReversePermissions(character.id, scope).chat.reply) throw new Error("代回复权限已关闭。");
  const existing = loadChatMessages(sessionId).find(item => item.mediaData?.reversePhoneOperationId === operationId);
  if (existing) { await chatDb.messages.put(existing); window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } })); return existing; }
  if (!text.trim()) throw new Error("代回复内容为空。");
  const message = pushChatMessage({ sessionId, role: "user", senderName: scope.userName, content: text.trim(),
    mediaData: { reversePhoneOperationId: operationId, reversePhoneActorId: character.id } });
  await chatDb.messages.put(message);
  window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
  return message;
}
export async function renameReverseContact(characterId: string, scope: ReverseScope, sessionId: string, alias: string, operationId: string) {
  permittedSession(characterId, scope, sessionId);
  if (!resolveReversePermissions(characterId, scope).chat.remark) throw new Error("修改备注权限已关闭。");
  const sessions = loadChatSessions(), session = sessions.find(item => item.id === sessionId)!;
  if (session.reversePhoneRemarkOperations?.includes(operationId)) { await chatDb.sessions.put(session); return session.alias; }
  if (!alias.trim()) throw new Error("新备注为空。");
  const updated = { ...session, alias: alias.trim().slice(0, 80), reversePhoneRemarkOperations: [...(session.reversePhoneRemarkOperations ?? []), operationId] };
  await chatDb.sessions.put(updated);
  saveChatSessions(sessions.map(item => item.id === sessionId ? updated : item));
  window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
  window.dispatchEvent(new CustomEvent("reverse-phone-contact-updated", { detail: { sessionId } }));
  return alias.trim().slice(0, 80);
}
export async function topUpReverseWallet(character: Character, scope: ReverseScope, amount: number, operationId: string) {
  assertReverseScope(scope);
  const permissions = resolveReversePermissions(character.id, scope);
  if (permissions.modes.chat !== "open" || !permissions.chat.assets || !permissions.chat.balance) throw new Error("修改资产余额权限已关闭。");
  const fallback = loadWalletState();
  if (fallback.transactions.some(tx => tx.relatedOrderId === operationId)) return;
  const intent = await paymentIntent({ id: operationId, characterId: character.id, characterName: character.name, scope,
    kind: "topup", amount, title: `给${scope.userName}充值`, done: false });
  await settlePayment(intent, true);
}
export function reverseCartAmount(items: Array<{ priceLabel: string; quantityLabel: string }>) {
  return items.reduce((sum, item) => sum + cents(reverseMoney(item.priceLabel)) * Math.max(1, parseInt(item.quantityLabel.replace(/\D/g, ""), 10) || 1), 0) / 100;
}
export async function payReverseCart(character: Character, scope: ReverseScope, itemIds: string[], operationId: string): Promise<string> {
  assertReverseScope(scope);
  const permissions = resolveReversePermissions(character.id, scope);
  if (permissions.modes.shopping !== "open" || !permissions.shopping.cart) throw new Error("购物车查看权限已关闭。");
  const state = loadShoppingState(), existing = state.orders.find(item => item.id === operationId);
  if (existing) return existing.summary;
  const pending = readReverseJson<PaymentIntent | null>(kvGet(paymentKey(operationId)), null);
  const items = pending?.order?.items ?? state.cartItems.filter(item => itemIds.includes(item.id));
  if (!items.length || items.length !== new Set(itemIds).size) throw new Error("购物车内容已改变，请重新查看。");
  const amount = pending?.amount ?? reverseCartAmount(items);
  const now = new Date();
  const order: ShoppingOrder = { id: operationId, statusLabel: "待发货", timeLabel: now.toLocaleString("zh-CN"), totalLabel: `¥${amount.toFixed(2)}`,
    merchantLabel: "角色代付", summary: items.map(item => item.title).join("、"), note: `${character.name}查岗时替你买单`,
    items: items.map(item => ({ ...item })), shippingTimeline: buildShoppingShippingTimeline(operationId, now, state.settings),
    paymentStatus: "paid_by_character", payerCharacterId: character.id, payerCharacterName: character.name, paidAt: now.toISOString(), characterPaidAt: now.toISOString() };
  const intent = await paymentIntent({ id: operationId, characterId: character.id, characterName: character.name, scope,
    kind: "shopping", amount, title: `替${scope.userName}购买${order.summary}`, itemIds, order: pending?.order ?? order, done: false });
  await settlePayment(intent, true); return intent.order!.summary;
}

type PaymentIntent = { id: string; characterId: string; characterName: string; scope: ReverseScope; kind: "topup" | "shopping"; amount: number; title: string; itemIds?: string[]; order?: ShoppingOrder; done: boolean };
const paymentKey = (id: string) => REVERSE_PREFIX + "payment:" + id;
async function paymentIntent(value: PaymentIntent): Promise<PaymentIntent> {
  if (!Number.isFinite(value.amount) || cents(value.amount) <= 0) throw new Error("付款金额无效。");
  let saved = value;
  await kvUpdatePersisted(paymentKey(value.id), raw => {
    const existing = readReverseJson<PaymentIntent | null>(raw, null);
    if (existing && (existing.characterId !== value.characterId || existing.scope.key !== value.scope.key || existing.kind !== value.kind || cents(existing.amount) !== cents(value.amount))) throw new Error("付款记录与原操作不一致。");
    saved = existing ?? value; return JSON.stringify(saved);
  });
  return saved;
}
/** Finish an already committed debit even after a crash, without starting a new debit on recovery. */
async function settlePayment(intent: PaymentIntent, startDebit: boolean) {
  if (intent.done) return true;
  if (!startDebit) {
    const assets = await loadPhoneSnapshot<CheckPhoneAssetsPayload>(intent.characterId, "assets");
    if (!assets?.payload.activities.some(item => item.id.startsWith(intent.id + ":"))) return false;
  }
  await debitReverseCharacter(intent.characterId, intent.amount, intent.id, intent.title);
  if (intent.kind === "topup") {
    const fallback = loadWalletState();
    await kvUpdatePersisted("ai_phone_wallet_state_v1", raw => {
      const current = readReverseJson<WalletState>(raw, fallback);
      if (current.transactions.some(tx => tx.relatedOrderId === intent.id)) return JSON.stringify(current);
      const now = new Date().toISOString(), balance = (cents(current.balance) + cents(intent.amount)) / 100;
      return JSON.stringify({ ...current, balance, updatedAt: now, transactions: [...current.transactions, {
        id: intent.id, relatedOrderId: intent.id, cardId: WALLET_BALANCE_ACCOUNT_ID, accountType: "balance", title: `${intent.characterName}充值`, amount: intent.amount,
        kind: "transfer_in", category: "反查岗", detail: `由${intent.characterName}的资产转入`, balanceAfter: balance, createdAt: now,
      }] });
    });
    window.dispatchEvent(new Event(WALLET_UPDATED_EVENT));
  } else {
    const fallback = loadShoppingState();
    await kvUpdatePersisted("ai_phone_shopping_state_v1", raw => {
      const current = readReverseJson<ShoppingState>(raw, fallback);
      if (current.orders.some(item => item.id === intent.id)) return JSON.stringify(current);
      return JSON.stringify({ ...current, orders: [intent.order!, ...current.orders], cartItems: current.cartItems.filter(item => !intent.itemIds!.includes(item.id)), updatedAt: new Date().toISOString() });
    });
    window.dispatchEvent(new Event(SHOPPING_STATE_UPDATED_EVENT));
  }
  await kvUpdatePersisted(paymentKey(intent.id), () => JSON.stringify({ ...intent, done: true }));
  return true;
}
export async function recoverReversePayments(scope: ReverseScope, sessionId: string) {
  assertReverseScope(scope);
  const receipts: Array<{ id: string; text: string }> = [];
  for (const key of kvKeysWithPrefix(paymentKey(sessionId + ":"))) {
    const intent = readReverseJson<PaymentIntent | null>(kvGet(key), null);
    if (!intent || intent.scope.key !== scope.key) continue;
    if (await settlePayment(intent, false)) receipts.push({ id: intent.id, text: intent.kind === "topup"
      ? `我从自己的资产扣除${intent.amount}元，给${scope.userName}充值；余额变为${loadWalletState().balance.toFixed(2)}元。`
      : `我用自己的资产替${scope.userName}购买了${intent.order!.summary}。` });
  }
  return receipts;
}

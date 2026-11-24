// Storage and component integration checks; no real API requests or financial services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require('fake-indexeddb/auto');
const { window } = require('linkedom').parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const local = new Map();
global.localStorage = window.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key), key: i => [...local.keys()][i], get length() { return local.size; } };
global.requestAnimationFrame = cb => setTimeout(cb, 0); global.cancelAnimationFrame = clearTimeout;
global.ResizeObserver = class { observe() {} disconnect() {} };
window.HTMLElement.prototype.scrollIntoView = function() {};
window.HTMLElement.prototype.scrollTo = function(value) { this.scrollTop = value.top; };
window.HTMLElement.prototype.getBoundingClientRect = function() {
  const top = this.dataset.testTop ? Number(this.dataset.testTop) : 0;
  const height = this.dataset.reverseSession ? 60 : 350;
  return { x: 0, y: top, top, bottom: top + height, left: 0, right: 390, width: 390, height };
};
const project = path.resolve(__dirname, '..'), resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith('@/') ? path.join(project, request.slice(2)) : request, parent, ...rest); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
require.extensions['.css'] = () => {};
const load = name => require(path.join(project, name));
function mock(name, exports) { const id = path.join(project, name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
const abort = load('lib/abort-utils.ts');
mock('lib/abort-utils.ts', { ...abort, abortableDelay: async (_ms, signal) => { abort.throwIfAborted(signal); await new Promise(resolve => setTimeout(resolve, 0)); abort.throwIfAborted(signal); } });
let calls = [], responder;
mock('lib/chat-engine.ts', { sendLLMStreamRequest: async (...args) => {
  const data = JSON.parse(args[2][1].content).当前内容;
  const prompt = args[2][0].content;
  const kind = prompt.includes('单行JSON头') ? 'conversation' : prompt.includes('是否同意用户邀请') ? 'invite' : prompt.includes('为给出的应用安排') ? 'desktop' : prompt.includes('当前屏幕可见') ? 'chat' : prompt.includes('你已打开用户资产') ? 'assets' : prompt.includes('查看允许的购物车') ? 'shopping' : prompt.includes('查看允许的历史记录') ? 'browser' : prompt.includes('只看书架书名') ? 'reading' : prompt.includes('发现「该APP') ? 'locked' : prompt.includes('用户刚刚说') ? 'blocked' : 'generate';
  calls.push({ kind, data });
  const result = await responder(kind, data, args[5].signal, args[6]);
  return { content: typeof result === 'string' ? result : JSON.stringify(result) };
} });
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function main() {
  const kv = load('lib/kv-db.ts'); await kv.hydrateKvDb();
  await load('lib/settings-db.ts').hydrateSettingsDb();
  const settings = load('lib/settings-storage.ts');
  settings.saveApiConfigs([{ id: 'api', name: 'test', provider: 'openai', baseUrl: 'https://example.invalid', apiKey: 'test', model: 'test' }]);
  const binding = settings.loadBindingConfig(); binding.globalDefaults.apiConfigId = 'api'; settings.saveBindingConfig(binding);
  settings.saveUserIdentities([{ id: 'user', name: '简初', avatarUrl: '' }]);
  const chars = ['a', 'b', 'c', 'd'].map(id => ({ id, name: '角色' + id, avatar: null, persona: '温柔但会吃醋', wechatID: id, createdAt: '', updatedAt: '' }));
  load('lib/character-storage.ts').saveCharacters(chars);
  const chat = load('lib/chat-storage.ts'); await chat.hydrateChatStorage();
  const sessions = chars.map(item => chat.createOrGetSession(item.id));
  for (const s of sessions) for (let i = 0; i < 25; i++) chat.pushChatMessage({ sessionId: s.id, role: i % 2 ? 'assistant' : 'user', content: `记录${i}`, senderName: i % 2 ? '角色' : '简初' });
  const storage = load('lib/reverse-phone-storage.ts'), actions = load('lib/reverse-phone-actions.ts'), engine = load('lib/reverse-phone-engine.ts');
  const scope = storage.reverseScope();
  await storage.updateReverseSettings(scope, v => ({ ...v, unified: { ...v.unified, chat: { ...v.unified.chat, targets: chars.map(c => c.id) } } }));
  await storage.updateReverseSettings(scope, v => ({ ...v, unified: { ...v.unified, chat: { ...v.unified.chat, reply: false } }, characters: { a: { chat: { reply: true, remark: false }, modes: { browser: 'locked', reading: 'hidden' } } } }));
  let p = storage.resolveReversePermissions('a', scope);
  assert.equal(p.chat.reply, true); assert.equal(p.chat.remark, false); assert.equal(p.chat.assets, true);
  assert.deepEqual(storage.allowedReverseApps('a', scope), ['chat', 'shopping', 'browser']);
  await storage.updateReverseSettings(scope, v => ({ ...v, unified: { ...v.unified, chat: { ...v.unified.chat, reply: true } }, characters: {} }));
  const entry = { id: 'entry', kind: 'history', title: '周末旅行', url: 'https://example.invalid/travel', description: '想去海边', updatedAt: '' };
  await storage.saveUserBrowserEntry(scope, entry); await storage.saveUserBrowserEntry(scope, { ...entry, description: '想去安静的海边' });
  assert.equal(storage.loadUserBrowser(scope).length, 1); assert.match(storage.loadUserBrowser(scope)[0].description, /安静/);
  const otherScope = { ...scope, key: 'different' }; assert.equal(storage.loadUserBrowser(otherScope).length, 0);
  await assert.rejects(storage.saveUserBrowserEntry(otherScope, entry), /切换/);
  const phone = load('lib/checkphone-storage.ts');
  await phone.savePhoneSnapshot({ id: 'a:assets', characterId: 'a', appId: 'assets', generatedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), payload: { accounts: [{ id: 'cash', kind: 'cash', title: '零钱', balance: '¥1,000.00' }, { id: 'credit', kind: 'credit', title: '信用卡', balance: '¥99999' }], activities: [] } });
  assert.equal(await actions.reverseCharacterFunds('a'), 1000);
  const wallet = load('lib/wallet-storage.ts'); const initialWallet = wallet.loadWalletState().balance;
  await Promise.all([actions.topUpReverseWallet(chars[0], scope, 12.34, 'unit:topup'), actions.topUpReverseWallet(chars[0], scope, 12.34, 'unit:topup')]);
  assert.equal(await actions.reverseCharacterFunds('a'), 987.66); assert.equal(wallet.loadWalletState().balance, initialWallet + 12.34);
  await assert.rejects(actions.topUpReverseWallet(chars[0], scope, 2000, 'unit:too-much'), /不足/);
  assert.equal(await actions.reverseCharacterFunds('a'), 987.66);
  await assert.rejects(actions.debitReverseCharacter('a', -5, 'bad', 'bad'), /无效/);
  const own = await actions.sendReverseMessage(chars[0], scope, sessions[0].id, '给自己的会话发一条', 'unit:own');
  await actions.sendReverseMessage(chars[0], scope, sessions[0].id, '重复不发送', 'unit:own');
  assert.equal(chat.loadChatMessages(sessions[0].id).filter(m => m.mediaData?.reversePhoneOperationId === 'unit:own').length, 1);
  assert.equal((await load('lib/chat-db.ts').chatDb.messages.get(own.id)).content, '给自己的会话发一条');
  await actions.renameReverseContact('a', scope, sessions[0].id, '我自己', 'unit:remark');
  assert.equal((await load('lib/chat-db.ts').chatDb.sessions.get(sessions[0].id)).alias, '我自己');
  await storage.updateReverseSettings(scope, v => ({ ...v, characters: { a: { chat: { reply: false } } } }));
  await assert.rejects(actions.sendReverseMessage(chars[0], scope, sessions[1].id, '不应发送', 'unit:denied'), /权限/);
  await storage.updateReverseSettings(scope, v => ({ ...v, characters: {} }));
  const shopping = load('lib/shopping-storage.ts');
  shopping.saveShoppingState({ ...shopping.loadShoppingState(), cartItems: [{ id: 'cart', title: '马克杯', subtitle: '陶瓷', detail: '一只杯子', priceLabel: '¥10.00', quantityLabel: '×2', merchantLabel: '店铺', previewIcon: '☕', tone: 'warm' }] });
  await actions.payReverseCart(chars[0], scope, ['cart'], 'unit:purchase'); await actions.payReverseCart(chars[0], scope, ['cart'], 'unit:purchase');
  assert.equal(shopping.loadShoppingState().cartItems.length, 0); assert.equal(shopping.loadShoppingState().orders.filter(o => o.id === 'unit:purchase').length, 1);
  assert.equal(await actions.reverseCharacterFunds('a'), 967.66);
  // Inject a failure after the durable debit; recovery must credit once without requiring the original cart/page.
  const originalUpdate = kv.kvUpdatePersisted; let failed = false;
  kv.kvUpdatePersisted = async (key, update) => { if (key === 'ai_phone_wallet_state_v1' && !failed) { failed = true; throw new Error('injected storage failure'); } return originalUpdate(key, update); };
  await assert.rejects(actions.topUpReverseWallet(chars[0], scope, 7, 'recovery:topup'), /injected/);
  kv.kvUpdatePersisted = originalUpdate;
  assert.equal(await actions.reverseCharacterFunds('a'), 960.66);
  await actions.recoverReversePayments(scope, 'recovery'); await actions.recoverReversePayments(scope, 'recovery');
  assert.equal(wallet.loadWalletState().balance, initialWallet + 19.34); assert.equal(await actions.reverseCharacterFunds('a'), 960.66);
  const reading = load('lib/reading-storage.ts');
  await reading.addBook({ id: 'book', title: '海边的卡夫卡', author: '绝不能发给模型的作者字段', format: 'txt', totalChapters: 5, createdAt: new Date().toISOString() });
  const parsed = engine.parseReverseChat('{"action":"both","remark":"新备注"}\n第一句\n第二句'); assert.equal(parsed.reply, '第一句\n第二句');
  assert.equal(engine.parseReverseChat('{"action":"reply"}', false), null);
  // Real orchestration + real stores + mocked stream transport. The fourth row is off screen.
  let latest, root = createRoot(document.getElementById('root'));
  const hook = load('components/checkphone/use-reverse-phone.ts').useReversePhone;
  function Harness({ resumeSessionId, inviteSessionId, runOptions } = {}) {
    const host = React.useRef(null); const value = hook(scope, host, 'a', inviteSessionId, resumeSessionId, runOptions); latest = value;
    return React.createElement('div', { ref: host }, React.createElement('div', { className: 'chat-main-content' }, sessions.map((s, i) => React.createElement('div', { key: s.id, 'data-reverse-session': s.id, 'data-test-top': i === 3 ? 500 : 70 + i * 70 }, '会话'))));
  }
  await act(async () => { root.render(React.createElement(Harness)); await tick(); });
  let assetFailed = false;
  responder = async (kind, data, signal, callbacks) => {
    if (kind === 'desktop') return { reaction: '桌面很整洁', order: ['chat', 'shopping', 'browser', 'reading'], farewell: '还给你啦' };
    if (kind === 'chat') return { reaction: '让我看看', sessions: [sessions[1].id, sessions[0].id, sessions[3].id] };
    if (kind === 'conversation') {
      if (data.联系人 === '角色b') { const text = '{"action":"both","remark":"朋友乙"}\n他现在在我这里。'; callbacks.onDelta(text.slice(0, -2)); callbacks.onDelta(text.slice(-2)); return text; }
      return '{"action":"none","reaction":"我们的聊天我也看看"}';
    }
    if (kind === 'assets') { if (!assetFailed) { assetFailed = true; throw new Error('接口暂时失败'); } return { amount: 5, reaction: '给你充了五元' }; }
    if (kind === 'shopping') return { reaction: '购物车空了', steps: [{ target: 'orders', speech: '杯子已经买好了' }] };
    if (kind === 'browser') return { reaction: '想去海边呀', steps: [{ target: 'entry:entry', speech: '一起去吧' }] };
    if (kind === 'reading') return { reaction: '这本书不错', steps: [] };
    return { reaction: '好，不看就不看' };
  };
  calls = [];
  await act(async () => { await latest.start(); });
  assert.equal(latest.session.status, 'paused'); assert.match(latest.error, /接口暂时失败/);
  const firstPlan = calls.find(c => c.kind === 'chat').data.当前屏幕会话.map(s => s.id);
  assert.ok(!firstPlan.includes(sessions[3].id));
  assert.deepEqual(calls.filter(c => c.kind === 'conversation').map(c => c.data.联系人), ['角色b', '角色a']);
  assert.ok(calls.filter(c => c.kind === 'conversation').every(c => c.data.最近20条.length === 20));
  assert.equal(chat.loadChatSessions().find(s => s.id === sessions[1].id).alias, '朋友乙');
  assert.equal(chat.loadChatMessages(sessions[1].id).filter(m => m.content === '他现在在我这里。').length, 1);
  const pausedId = latest.session.id, beforeRestore = calls.length;
  await act(async () => root.unmount()); root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Harness, { resumeSessionId: pausedId })); await tick(); });
  assert.equal(calls.length, beforeRestore, 'refresh only restores the checkpoint; no automatic API or writes');
  assert.equal(latest.session.status, 'paused');
  await act(async () => { await latest.execute(); });
  assert.equal(latest.session.status, 'completed');
  assert.equal(calls.filter(c => c.kind === 'chat').length, 1); assert.equal(calls.filter(c => c.kind === 'conversation').length, 2);
  assert.equal(calls.length, 9, 'desktop+chat list+two conversations+assets retry+three apps');
  assert.deepEqual(calls.find(c => c.kind === 'reading').data, { 书架: [{ id: 'book', title: '海边的卡夫卡' }] });
  assert.equal(await actions.reverseCharacterFunds('a'), 955.66);
  const memory = load('lib/short-term-memory-records.ts').loadManualShortMemories('a').find(item => item.id === 'reverse_phone_' + latest.session.id);
  for (const phrase of ['[查手机]', '我说：“桌面很整洁”', '他现在在我这里', '朋友乙', '海边的卡夫卡', '周末旅行', '订单', '充值']) assert.ok(memory.content.includes(phrase), phrase);
  // Hidden app never reaches the model; locked app receives only a lock notice, not browser records.
  await storage.updateReverseSettings(scope, v => ({ ...v, unified: { ...v.unified, modes: { chat: 'hidden', shopping: 'hidden', browser: 'locked', reading: 'hidden' } } }));
  calls = []; await act(async () => { await latest.start(); });
  assert.deepEqual(calls.map(c => c.kind), ['desktop', 'locked']);
  assert.deepEqual(calls[0].data.应用.map(a => a.id), ['browser']); assert.ok(!JSON.stringify(calls[1].data).includes('周末旅行'));
  // Reclaim during a partial stream: no reply, remark, or unseen speech gets committed.
  await storage.updateReverseSettings(scope, v => ({ ...v, unified: { ...v.unified, modes: { chat: 'open', shopping: 'hidden', browser: 'hidden', reading: 'hidden' } } }));
  let streaming = false, pending;
  responder = async (kind, data, signal, callbacks) => {
    if (kind === 'desktop') return { order: ['chat'] };
    if (kind === 'chat') return { sessions: [sessions[1].id] };
    if (kind === 'conversation') { streaming = true; callbacks.onDelta('{"action":"both","remark":"未完成备注"}\n未完成消息'); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })); }
    return {};
  };
  await act(async () => { pending = latest.start(); for (let i = 0; i < 200 && !streaming; i++) await tick(); });
  assert.ok(streaming);
  await act(async () => { await latest.stop(); await pending; });
  assert.equal(latest.session.status, 'stopped'); assert.ok(!chat.loadChatMessages(sessions[1].id).some(m => m.content === '未完成消息'));
  assert.equal(chat.loadChatSessions().find(s => s.id === sessions[1].id).alias, '朋友乙'); assert.ok(!storage.reverseMemoryText(latest.session).includes('未完成消息'));
  // Blocking a page aborts its request, records one spoken refusal, and continues with the remaining app.
  await storage.updateReverseSettings(scope, v => ({ ...v, unified: { ...v.unified, modes: { chat: 'hidden', shopping: 'hidden', browser: 'open', reading: 'open' } } }));
  let browsing = false;
  responder = async (kind, data, signal) => {
    if (kind === 'desktop') return { order: ['browser', 'reading'] };
    if (kind === 'browser') { browsing = true; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })); }
    if (kind === 'blocked') return { reaction: '好，不看就不看' };
    if (kind === 'reading') return { reaction: '那看看书架' };
    return {};
  };
  calls = [];
  await act(async () => { pending = latest.start(); for (let i = 0; i < 200 && !browsing; i++) await tick(); });
  assert.ok(browsing);
  await act(async () => { await latest.skip(true); await pending; });
  assert.equal(latest.session.status, 'completed'); assert.equal(calls.filter(c => c.kind === 'blocked').length, 1);
  assert.ok(storage.reverseMemoryText(latest.session).includes('我说：“好，不看就不看”')); assert.ok(calls.some(c => c.kind === 'reading'));
  await act(async () => root.unmount());
  // Private-chat invitation persists a real card. Retrying a failed acceptance call reuses that card.
  await storage.updateReverseSettings(scope, v => ({ ...v, unified: { ...v.unified, modes: { chat: 'hidden', shopping: 'hidden', browser: 'hidden', reading: 'hidden' } } }));
  root = createRoot(document.getElementById('root')); let inviteFailed = false, acceptedSessionId = null;
  responder = async kind => {
    if (kind === 'invite') { if (!inviteFailed) { inviteFailed = true; throw new Error('邀请接口失败'); } return { accepted: true, reaction: '好，让我看看' }; }
    if (kind === 'desktop') return { reaction: '看到了', order: [] };
    return {};
  };
  calls = [];
  await act(async () => { root.render(React.createElement(Harness, { inviteSessionId: sessions[0].id, runOptions: { invitationOnly: true, onAccepted: id => { acceptedSessionId = id; } } })); });
  await act(async () => { for (let i = 0; i < 200; i++) { await tick(); if (latest?.session?.error === '邀请接口失败') break; } });
  assert.equal(latest.session.status, 'paused');
  const inviteId = latest.session.id, cardId = latest.session.inviteMessageId;
  await act(async () => { await latest.execute(); });
  assert.equal(latest.session.status, 'paused'); assert.equal(acceptedSessionId, inviteId);
  const cards = chat.loadChatMessages(sessions[0].id).filter(m => m.mediaData?.appSceneId === inviteId);
  assert.equal(cards.length, 1); assert.equal(cards[0].id, cardId); assert.match(cards[0].mediaData.appCardBody, /已同意/);
  assert.equal(chat.loadChatMessages(sessions[0].id).filter(m => m.mediaData?.reversePhoneOperationId === inviteId + ':invite-answer').length, 1);
  assert.deepEqual(calls.map(c => c.kind), ['invite', 'invite'], 'no desktop/API/navigation before the chat answer is saved');
  await act(async () => root.unmount()); root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Harness, { resumeSessionId: acceptedSessionId, runOptions: { autoContinue: true } })); });
  await act(async () => { for (let i = 0; i < 200; i++) { await tick(); if (latest?.session?.status === 'completed') break; } });
  assert.equal(latest.session.status, 'completed');
  assert.deepEqual(calls.map(c => c.kind), ['invite', 'invite', 'desktop'], 'the accepted phone continues without another invitation');
  await act(async () => root.unmount());
  // A declined invitation must stay in chat and never announce a shared phone.
  acceptedSessionId = null; calls = []; responder = async kind => { assert.equal(kind, 'invite'); return { accepted: false, reaction: '这次先不了' }; };
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Harness, { inviteSessionId: sessions[0].id, runOptions: { invitationOnly: true, onAccepted: id => { acceptedSessionId = id; } } })); });
  await act(async () => { for (let i = 0; i < 200; i++) { await tick(); if (latest?.session?.accepted === false) break; } });
  assert.equal(latest.session.status, 'stopped'); assert.equal(acceptedSessionId, null); assert.deepEqual(calls.map(c => c.kind), ['invite']);
  await act(async () => root.unmount());
  // The actual invitation component renders only a chat status until the stored answer accepts.
  let acceptInvitation, acceptedFromChat = null; calls = [];
  responder = async kind => { assert.equal(kind, 'invite'); return new Promise(resolve => { acceptInvitation = resolve; }); };
  const Invitation = load('components/checkphone/reverse-phone-invitation.tsx').ReversePhoneInvitation;
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Invitation, { characterId: 'a', chatSessionId: sessions[0].id,
    onClose() {}, onAccepted: id => { acceptedFromChat = id; const record = storage.loadReverseSession(id); assert.ok(chat.loadChatMessages(sessions[0].id).some(m => m.mediaData?.reversePhoneOperationId === record.id + ':invite-answer')); } })); });
  await act(async () => { for (let i = 0; i < 200 && !acceptInvitation; i++) await tick(); });
  assert.ok(document.querySelector('.rp-invitation-status')); assert.ok(!document.querySelector('.rp-app')); assert.equal(acceptedFromChat, null);
  assert.ok(chat.loadChatMessages(sessions[0].id).some(m => m.mediaType === 'app_card' && m.content.includes('主动邀请你共享屏幕')));
  await act(async () => { acceptInvitation({ accepted: true, reaction: '好，我同意' }); for (let i = 0; i < 200 && !acceptedFromChat; i++) await tick(); });
  assert.ok(acceptedFromChat); assert.deepEqual(calls.map(c => c.kind), ['invite']);
  await act(async () => root.unmount());
  // Settings and browser editor operate on the same persistent data as the inspection.
  const host = document.getElementById('root'); root = createRoot(host);
  const props = element => element[Object.keys(element).find(key => key.startsWith('__reactProps$'))];
  const button = text => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === text);
  const click = async element => { assert.ok(element); await act(async () => { element.dispatchEvent(new window.Event('click', { bubbles: true })); await tick(); }); };
  const change = async (element, value) => act(async () => { props(element).onChange({ target: { value } }); await tick(); });
  const Settings = load('components/checkphone/reverse-phone-settings.tsx').ReversePhoneSettings;
  await act(async () => { root.render(React.createElement(Settings, { scope, initialCharacterId: 'a', onClose() {} })); await tick(); });
  assert.ok(host.textContent.includes('当前预览角色：角色a'));
  assert.ok(host.textContent.includes('各查岗角色自动使用自己的世界'));
  const targetsBefore=JSON.stringify(storage.loadReverseSettings(scope));
  await change(host.querySelector('[aria-label="反查岗设置范围"]'),'b');
  assert.ok(host.textContent.includes('当前查岗角色：角色b'));
  assert.ok(host.textContent.includes('允许「角色b」查看你与这些角色的聊天记录'));
  await change(host.querySelector('[aria-label="筛选显示的世界"]'),'all');
  assert.equal(JSON.stringify(storage.loadReverseSettings(scope)),targetsBefore,'Changing the preview scope or display filter must not change permissions');
  await change(host.querySelector('[aria-label="反查岗设置范围"]'),'unified');
  assert.ok(host.textContent.includes('当前预览角色：角色a'));
  assert.ok(host.textContent.includes('允许他修改我的资产余额')); await click(button('浏览器'));
  assert.ok(host.textContent.includes('允许查看历史记录')); await change(host.querySelector('[aria-label="应用总控制"]'), 'locked');
  assert.equal(storage.resolveReversePermissions('a', scope).modes.browser, 'locked');
  await act(async () => root.unmount()); root = createRoot(host);
  const Browser = load('components/checkphone/user-browser.tsx').UserBrowser;
  await act(async () => { root.render(React.createElement(Browser, { scope, initialCharacterId: 'a', onClose() {}, onSettings() {} })); await tick(); });
  assert.ok(host.textContent.includes('周末旅行')); await click(button('编辑'));
  await change(host.querySelector('textarea'), '改成山间旅行'); await click(button('保存记录'));
  assert.equal(storage.loadUserBrowser(scope)[0].description, '改成山间旅行');
  const beforeGenerate = calls.length;
  responder = async kind => { assert.equal(kind, 'generate'); return { entries: [{ title: '润色后的周末', url: '', description: '山间散步' }] }; };
  await click(button('设置')); await click(button('AI辅助生成／润色'));
  await change([...host.querySelectorAll('textarea')].at(-1), '生成山间旅行记录'); await click(button('生成预览'));
  assert.equal(calls.length, beforeGenerate + 1); assert.ok(!storage.loadUserBrowser(scope).some(e => e.title === '润色后的周末'));
  await click(button('确认应用')); assert.ok(storage.loadUserBrowser(scope).some(e => e.title === '润色后的周末'));
  await act(async () => root.unmount());
  // Phone-level portal is a sibling of the original chat, not clipped by its header/input layers.
  const shell = document.createElement('div'); shell.setAttribute('data-ui', 'phone-screen'); document.body.appendChild(shell);
  const originalChat = document.createElement('div'); originalChat.className = 'chat-app'; shell.appendChild(originalChat); originalChat.appendChild(host);
  root = createRoot(host);
  const Layer = load('components/checkphone/reverse-phone-layer.tsx').ReversePhoneLayer;
  await act(async () => { root.render(React.createElement(Layer, null, React.createElement('button', { id: 'portal-back' }, '返回'))); });
  const layer = shell.querySelector('[data-reverse-phone-layer]'); assert.ok(layer); assert.equal(layer.parentElement, shell); assert.ok(!originalChat.contains(layer));
  assert.ok(layer.querySelector('#portal-back')); await act(async () => root.unmount()); assert.ok(!shell.querySelector('[data-reverse-phone-layer]'));
  // Reproduce the direct role-settings entry, which does not mount ReversePhoneApp.
  root=createRoot(host);let returned=false;
  await act(async()=>root.render(React.createElement(Layer,null,React.createElement(Settings,{scope,initialCharacterId:'a',initialOwner:'a',onClose(){returned=true;}}))));
  const directSettings=shell.querySelector('[aria-label="反查岗设置"]');
  assert.ok(directSettings.closest('.rp-safe-frame'),'Direct role settings must use the same safe-area frame as the shared phone');
  assert.equal(directSettings.querySelector('h2').textContent,'反查岗设置');
  await act(async()=>directSettings.querySelector('header button').dispatchEvent(new window.Event('click',{bubbles:true})));assert.ok(returned,'Return remains usable in direct role settings');
  await act(async()=>root.unmount());
  // A complete phone already uses rp-app: keep exactly one outer safe frame instead of adding a second top reserve.
  root=createRoot(host);
  await act(async()=>root.render(React.createElement(Layer,null,React.createElement('div',{className:'rp-app'},React.createElement('header',{className:'rp-top'},'我的手机')))));
  assert.ok(shell.querySelector('.rp-safe-frame > .rp-app > .rp-top'));
  await act(async()=>root.unmount());
  const {StoryAutomationSettings}=load('components/chat/story-automation-settings.tsx');root=createRoot(host);
  await act(async()=>root.render(React.createElement(Layer,null,React.createElement(StoryAutomationSettings,{session:sessions[0],onChange(){},onClose(){}}))));
  assert.ok(shell.querySelector('[aria-label="自动进入剧情设置"]').closest('.rp-safe-frame'));
  await act(async()=>root.unmount());
  // No virtual phone exists in viewport fallback: the same frame uses the device safe area.
  document.body.appendChild(host);shell.remove();root=createRoot(host);
  await act(async()=>root.render(React.createElement(Layer,null,React.createElement('button',null,'返回'))));
  assert.ok(document.body.querySelector('.rp-viewport-layer > .rp-safe-frame'));
  await act(async()=>root.unmount());
  // Reopening without an explicit session ID finds the interrupted checkpoint without API calls.
  const checkpoint={...storage.createReverseSession(chars[0],scope),id:'reopen-interrupted',status:'running',accepted:true,updatedAt:new Date().toISOString(),events:[{id:'saved-action',kind:'action',text:'已完成的操作保留',at:new Date().toISOString()}]};
  await storage.saveReverseSession(checkpoint);const beforeReopen=calls.length;
  root=createRoot(host);await act(async()=>{root.render(React.createElement(Harness));for(let i=0;i<6;i++)await tick();});
  assert.equal(latest.session.id,checkpoint.id);assert.equal(latest.session.status,'paused');assert.equal(calls.length,beforeReopen);assert.equal(latest.session.events[0].text,'已完成的操作保留');await act(async()=>root.unmount());
  // A long capture is compacted, while real action/speech events are never removed.
  for(let i=0;i<140;i++)await storage.appendReverseReplay(checkpoint.id,{at:i*700,html:i%5===0?'<p>页面'+i+'</p>':'',speech:'话语'+i,app:'chat'});
  const recovered=storage.loadReverseSession(checkpoint.id);assert.ok(recovered.replay.length<=120);assert.equal(recovered.replay.at(-1).speech,'话语139');assert.equal(recovered.events[0].text,'已完成的操作保留');
  const replay=load('components/checkphone/reverse-phone-replay.tsx');const picture='data:image/png;base64,'+'A'.repeat(6000);
  const frozen=await replay.freezeReverseFrame('<img src="'+picture+'"><p>实际查看内容</p>');assert.ok(frozen.length<1000,'frame HTML references separately stored media');assert.equal(replay.restoreReverseFrame(frozen).includes(picture),true,'replay can recover its image after re-entry');
  assert.equal(await replay.freezeReverseFrame('<img src="'+picture+'"><p>实际查看内容</p>'),frozen,'identical image sources reuse one persisted reference');
  console.log('PASS reverse phone: permissions, scope isolation, real messages/remarks, conserved idempotent payments, crash recovery, visible list/recent 20, API plan/retry, title-only shelf, memory, abort, invitation retry, settings and browser editing.');
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

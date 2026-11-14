const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const fallback = new Proxy({}, { get: () => () => [] });
function load(file, deps, suffix = "") {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8") + suffix, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: name => deps[name]
        ? new Proxy(deps[name], { get: (target, key) => key in target ? target[key] : fallback[key] }) : fallback,
        console, Error, Date, AbortController, DOMException, TextDecoder, setTimeout, clearTimeout, fetch() { throw new Error("Regression must not call paid APIs"); } });
    return module.exports;
}

async function main() {
    const preset = { id: "preset", name: "原有预设", builtIn: true, prompts: [], online_thinking_tag: "inner_note", online_thinking_enabled: false };
    const helper = load("lib/chinese-thinking-prompt.ts", { "./builtin-preset": { createBuiltinPreset: () => ({ ...preset }) } });
    assert.equal(helper.withChineseThinkingPrompt(preset, false), preset);
    assert.equal(helper.withChineseThinkingPrompt(preset, true).online_thinking_enabled, true);
    assert.equal(preset.online_thinking_enabled, false, "Must not change the shared preset");
    assert.match(helper.buildChineseThinkingPrompt("简初"), /<thinking>/);
    assert.match(helper.buildChineseThinkingPrompt("简初"), /约100字/);
    for (const length of [100, 300, 500]) {
        assert.equal(helper.normalizeChineseThinkingPromptLength(length), length);
        assert.match(helper.buildChineseThinkingPrompt("简初", "thinking", ["甲", "乙"], length), new RegExp(`约${length}字`));
    }
    for (const invalid of [undefined, null, 0, 200, "500", NaN]) {
        assert.equal(helper.normalizeChineseThinkingPromptLength(invalid), 100);
        assert.match(helper.buildChineseThinkingPrompt("简初", "thinking", undefined, invalid), /约100字/);
    }
    assert.equal(helper.withChineseThinkingPrompt(null, true).online_thinking_enabled, true);
    const session = { id: "session", contactId: "char", chatAccountId: "alt", chineseThinkingPromptEnabled: false };
    const coverIntent = load("lib/chat-moments-cover-intent.ts", {});
    const history = [{ id: "user-message", sessionId: session.id, role: "user", content: "你好", createdAt: "2026-11-02" }];
    const shortTerm = { recentBlocks: [], truncatedHistory: history, wbActivationContext: "", unifiedRecentItems: [] };
    const deps = {
        "./chinese-thinking-prompt": helper,
        "./chat-storage": { loadChatSessions: () => [session], loadChatAppSettings: () => ({}), resolveVisionImagePromptLimit: () => 0,
            normalizeVisionImagePromptLimit: value => value || 0, resolveMeetingInviteCardConfig: () => ({ contract: "" }) },
        "./character-storage": { loadCharacters: () => [{ id: "char", name: "角色甲" }] },
        "./settings-storage": {
            loadBindingConfig: () => ({}), resolveBinding: () => ({ apiConfigId: "api", presetId: "preset" }),
            loadApiConfigs: () => [{ id: "api", provider: "OpenAI", defaultModel: "test", apiKey: "mock" }],
            loadPresets: () => [preset], loadWorldBooks: () => [], loadRegexes: () => [], resolveUserIdentity: () => ({ name: "主号昵称" }),
        },
        "./chat-scope-storage": { resolveChatAccountUserIdentity: () => ({ name: "小林" }) },
        "./short-term-assembler": { loadNativeTimelineAsync: async () => [], prepareShortTermContext: () => shortTerm,
            prepareGroupShortTermContext: () => shortTerm },
        "./memory-service": { retrieveMemoriesForPrompt: async () => null, retrieveCoreMemoriesForPrompt: async () => null },
        "./memory-storage": { loadMemoryConfig: () => ({}) },
        "./chat-plugin-hooks": { runChatPluginTransform: async (_event, value) => ({ ...value, hint: "" }) },
        "./chat-avatar-intent": { findUserAvatarChangeIntent: () => null },
        "./chat-moments-cover-intent": coverIntent,
        "./music-service": { isNeteaseConfigured: () => false },
        "./calendar-storage": { getCurrentCalendarScheduleForPrompt: () => "", buildCalendarScheduleMarker: () => "" },
        "./llm-prompt-assembler": { assemblePromptPayload: () => [{ role: "system", content: "原有提示词" }],
            assembleGroupPromptPayload: () => [{ role: "system", content: "原有群聊提示词" }] },
    };
    let modelReply = "好呀，我用你发的那张。";
    let streaming = false;
    let modelCalls = 0;
    deps["./chat-storage"].isSessionStreamingEnabled = () => streaming;
    deps["./chat-storage"].getMaxToolRounds = () => 1;
    deps["./action-parser"] = { parseActionTags: text => ({ cleanText: text, actions: [] }) };
    deps["./prompt-sanitizer"] = { stripStateAndInnerForPrompt: text => text.replace(/\[状态栏\][\s\S]*?\[\/状态栏\]/g, "").trim() };
    deps["./llm-http"] = { fetchLlmPayload: async () => {
        modelCalls++;
        return streaming
            ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: modelReply } }] })}\n\ndata: [DONE]\n\n`)
            : Response.json({ choices: [{ message: { content: modelReply } }] });
    } };
    const apiHelpers = {
        isNativeAnthropicApi: () => false, isNativeGoogleApi: () => false,
        determineBaseUrl: () => "https://example.invalid", buildChatCompletionsUrl: base => base,
        buildRequestHeaders: () => ({}), stripHallucinatedTimestamps: text => text,
    };
    deps["./api-helpers"] = apiHelpers;
    deps["./llm-provider-adapter"] = load("lib/llm-provider-adapter.ts", {
        "./api-helpers": apiHelpers,
        "./generation-parameters": { resolveEnabledGenerationParameters: () => new Set() },
    });
    deps["./sse-json"] = load("lib/sse-json.ts", {});
    deps["./macro-engine"] = { MacroEngine: class {} };
    deps["./llm-prompt-assembler"].applyOutputRegex = text => text;
    deps["./chat-avatar-intent"].applyWithProtectedAvatarDecisionMarkers = (text, transform) => transform(text);
    const engine = load("lib/chat-engine.ts", deps);
    const hasPrompt = result => result.llmMessages.some(message => String(message.content).includes("【内置中文思考展示提示词】"));
    const normal = await engine.buildChatPromptMessages(session, history);
    const read = (id, content, extra = {}) => ({ ...history[0], id, content, ...extra });
    const photo = read("photo", "", { mediaType: "image", mediaUrl: "asset://photo" });
    const request = read("cover", "用这张当你的朋友圈封面吧");
    const generate = read("generate", "换个朋友圈封面吧，用我们俩的合照");
    const coverOptions = { allowMomentsCoverChange: true };
    const build = messages => engine.buildChatPromptMessages(session, messages, coverOptions);
    for (const messages of [history, [photo], [read("no", "不要换朋友圈封面")], [read("mine", "我换了朋友圈封面")], [read("ask", "怎么换你的朋友圈封面？")]]) {
        const result = await build(messages);
        assert.equal(result.coverRequest, undefined);
        assert.equal(JSON.stringify(result.llmMessages), JSON.stringify(normal.llmMessages));
    }
    assert.equal((await build([photo, request])).coverRequest.imageId, "photo");
    const reply = read("photo-reply", "这张照片真好看", { role: "assistant" });
    const directRequest = read("background", "帮我设置成你的朋友圈背景");
    assert.equal((await build([photo, reply, directRequest])).coverRequest.imageId, "photo");
    assert.equal((await build([photo, reply, read("do-it", "换一下朋友圈背景吧")])).coverRequest.imageId, "photo");
    assert.equal((await build([photo, reply, read("fresh", "生成一张新的朋友圈背景图")])).coverRequest.kind, "generate");
    assert.equal((await build([photo, reply, read("stop", "不要用这张做朋友圈背景")])).coverRequest, undefined);
    assert.equal((await build([directRequest])).coverRequest.kind, "clarify");
    assert.equal((await build([photo, reply, read("new-theme", "把你的朋友圈背景改成雪山吧")])).coverRequest.kind, "generate");
    assert.equal((await build([photo, reply, { ...directRequest, mediaData: { quoteMessageId: "missing" } }])).coverRequest.kind, "clarify");
    assert.equal((await build([photo, { ...photo, id: "second" }, reply, directRequest])).coverRequest.kind, "clarify");
    for (const useStream of [false, true]) {
        streaming = useStream;
        const completed = await engine.generateChatCompletion(session, [photo, reply, directRequest], { ...coverOptions, appTags: ["followup"] });
        assert.equal(completed.coverChange?.request.imageId, "photo", "An ordinary model reply must still save the uploaded picture");
        assert.equal(completed.coverChange?.action.kind, "use_image");
        assert.equal(completed.parts[0].text, modelReply);
    }
    streaming = false;
    assert.equal(modelCalls, 2, "Uploaded images use the existing chat reply call only");
    modelReply = "我想好了。\n【生成朋友圈封面：合照｜一起看雪】\n[状态栏]冬天[/状态栏]";
    const generated = await engine.generateChatCompletion(session, [generate], { ...coverOptions, appTags: ["followup"] });
    assert.equal(generated.coverChange?.action.description, "一起看雪", "A trailing status block must not swallow the cover directive");
    assert.ok(!generated.parts[0].text.includes("生成朋友圈封面"));
    assert.equal((await build([photo, { ...photo, id: "two" }, request])).coverRequest.kind, "clarify");
    assert.equal((await build([photo, { ...photo, id: "two" }, { ...request, mediaData: { quoteMessageId: "photo" } }])).coverRequest.imageId, "photo");
    assert.equal((await build([generate])).coverRequest.kind, "generate");
    assert.equal((await build([generate])).llmMessages.length, normal.llmMessages.length + 1);
    assert.equal((await build([read("mention", "你的朋友圈封面好久没换了")])).coverRequest.kind, "clarify");
    assert.equal((await build([{ ...generate, mediaData: { momentsCoverAttempted: true } }])).coverRequest, undefined);
    assert.equal(coverIntent.extractCoverAction("好呀！\n[生成朋友圈封面:合照|雨夜合影]").subject, "合照");
    assert.equal(coverIntent.extractCoverAction("好呀！\n[生成朋友圈封面:无效|雨夜合影]"), undefined);
    assert.equal(hasPrompt(normal), false);
    assert.equal(normal.preset, preset);
    session.chineseThinkingPromptEnabled = true;
    const enabled = await engine.buildChatPromptMessages({ ...session, chineseThinkingPromptEnabled: false }, history);
    assert.equal(hasPrompt(enabled), true, "Must read the latest saved session state");
    assert.equal(enabled.preset.online_thinking_enabled, true);
    const prompt = enabled.llmMessages.find(message => String(message.content).includes("【内置中文思考展示提示词】")).content;
    assert.match(prompt, /小林/);
    assert.ok(!prompt.includes("主号昵称"));
    assert.match(prompt, /<inner_note>/);
    assert.ok(!prompt.includes("二哈"));
    assert.match(prompt, /约100字/);
    for (const length of [100, 300, 500]) {
        session.chineseThinkingPromptLength = length;
        const selected = await engine.buildChatPromptMessages({ ...session, chineseThinkingPromptLength: 100 }, history);
        assert.match(selected.llmMessages.find(message => String(message.content).includes("【内置中文思考展示提示词】")).content,
            new RegExp(`约${length}字`), "Must use the latest saved length in private chat");
    }
    assert.equal(enabled.preset.online_thinking_tag, "inner_note");
    assert.equal(engine.stripOnlineThinkingTag("<inner_note>我想先关心小林。</inner_note>\n你好。", "inner_note"), "你好。");
    const stream = load("lib/stream-preview.ts", { "./text-tool-protocol": { stripTextToolDirectives: text => text }, "./chat-moments-cover-intent": coverIntent });
    assert.equal(stream.cleanStreamText("好呀！\n[生成朋友圈封面:合照|雨"), "好呀！");
    assert.ok(!stream.cleanStreamText("<inner_note>我想先关心小林。", { stripXmlTags: ["inner_note"] }).includes("小林"), "Partial streaming monologues must stay outside the message bubble");
    assert.equal(hasPrompt(await engine.buildChatPromptMessages(session, history, { appTags: ["chat", "offline"] })), false);
    assert.equal(hasPrompt(await engine.buildChatPromptMessages(session, history, { appId: "story" })), false);
    assert.equal(hasPrompt(await engine.buildChatPromptMessages(session, history, { promptProfile: { output: "json" } })), false);

    const group = load("lib/group-chat-engine.ts", { ...deps, "./chat-engine": { ...engine, applyVisionImagePromptLimit: messages => messages } },
        "\nexport const testBuild = buildGroupChatPromptMessages;");
    session.isGroup = true;
    session.participantIds = ["char"];
    assert.equal(hasPrompt(await group.testBuild(session, history)), true);
    for (const length of [100, 300, 500]) {
        session.chineseThinkingPromptLength = length;
        const selected = await group.testBuild({ ...session, chineseThinkingPromptLength: 100 }, history);
        const monologuePrompt = selected.llmMessages.find(message => String(message.content).includes("【内置中文思考展示提示词】")).content;
        assert.match(monologuePrompt, new RegExp(`约${length}字`), "Must use the latest saved length in group chat");
        assert.match(monologuePrompt, /所有角色独白的合计字数/);
    }
    assert.equal(hasPrompt(await group.testBuild(session, history, { appTags: ["group_chat", "offline"] })), false);
    session.chineseThinkingPromptEnabled = false;
    assert.equal(hasPrompt(await group.testBuild(session, history)), false);
    assert.equal(preset.online_thinking_enabled, false);
    console.log("✅ 中文思考提示词回归通过：默认关闭、会话开关、100/300/500字与异常值、小号昵称、自定义标签、私聊群聊、线下/自定义任务隔离、预设不变");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

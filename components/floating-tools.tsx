"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, BookOpen, Camera, Check, Code2, FileText, FlaskConical, ImageIcon, Loader2, MessageCircle, RefreshCw, Wrench, X } from "lucide-react";
import { CHAT_APP_SETTINGS_UPDATED_EVENT, loadChatAppSettings, saveChatAppSettings, type ChatAppSettings, type ChatSession } from "@/lib/chat-storage";
import { getFloatingBindingSlot, isCombinedToolsEnabled, updateFloatingBinding, type FloatingBindingTarget } from "@/lib/floating-tools";
import { getFloatingPageContext, subscribeFloatingPageContext } from "@/lib/floating-tools-context";
import {
    loadApiConfigs,
    loadBindingConfig,
    loadWorldBooks,
    resolveBinding,
    saveBindingConfig,
    saveApiConfigs,
    loadImageGenerationSettings,
    saveImageGenerationSettings,
} from "@/lib/settings-storage";
import { CONTENT_APP_LABELS, type ApiConfig, type BindingSlot, type ContentAppId, type ImageGenerationSettings } from "@/lib/settings-types";
import {
    applyImageGenerationBinding,
    getActiveImageGenerationBindingId,
    getImageGenerationBindingOptions,
} from "@/lib/image-generation-binding";
import {
    fetchImageGenerationModels,
    fetchNovelAiModels,
    filterLikelyImageModels,
    generateImageFromConfiguredApi,
} from "@/lib/image-generation-service";
import { NOVELAI_COMMON_MODELS } from "@/lib/novelai-image-config";
import { determineBaseUrl, simpleLLMCall } from "@/lib/api-helpers";
import { generateEmbedding, isEmbeddingModelName } from "@/lib/memory-embedding";
import { DebugPromptPanel } from "./debug-prompt-panel";
import styles from "./floating-tools.module.css";

type View = "menu" | "api" | "books" | "shortcut" | "prompt" | null;
type Position = { x: number; y: number };
const EMPTY_SETTINGS: Partial<ChatAppSettings> = {};
const SHORTCUTS = [
    { id: "settings", label: "设置" }, { id: "desktop", label: "桌面" },
    { id: "chat", label: "聊天" }, { id: "calendar", label: "日历" },
    { id: "settings:worldbook", label: "世界书" }, { id: "settings:api", label: "API 设置" },
];
// Only applications with verified resolveBinding request paths are exposed here.
const BINDING_APPS = new Set(["chat", "diary", "reading", "cocreate", "story", "game", "xiaohongshu", "dwelling", "checkphone", "shopping", "calendar", "interview_magazine", "vn", "adventure"]);

export function FloatingTools({ activeApp, chatSession }: { activeApp: string | null; chatSession: ChatSession | null }) {
    const nested = useSyncExternalStore(subscribeFloatingPageContext, getFloatingPageContext, () => null);
    const [settings, setSettings] = useState<Partial<ChatAppSettings>>(EMPTY_SETTINGS);
    const [view, setView] = useState<View>(null);
    const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
    const [panelPosition, setPanelPosition] = useState<Position>({ x: 16, y: 90 });
    const [ready, setReady] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [idle, setIdle] = useState(false);
    const [edge, setEdge] = useState<"left" | "right">("right");
    const [revision, setRevision] = useState(0);
    const [apiTab, setApiTab] = useState<"text" | "image">("text");
    const [apis, setApis] = useState<ApiConfig[]>([]);
    const [imageSettings, setImageSettings] = useState<ImageGenerationSettings>(loadImageGenerationSettings);
    const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
    const [modelBusy, setModelBusy] = useState<null | "fetch" | "test">(null);
    const [modelStatus, setModelStatus] = useState<{ success: boolean; message: string } | null>(null);
    const [imageModels, setImageModels] = useState<Record<string, string[]>>({});
    const [imageBusy, setImageBusy] = useState<null | "fetch" | "test">(null);
    const [imageStatus, setImageStatus] = useState<{ success: boolean; message: string } | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const imageBusyRef = useRef(false);
    const layerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const positionRef = useRef(position);
    const edgeRef = useRef<"left" | "right">("right");
    const dragRef = useRef<{ id: number; x: number; y: number; start: Position; moved: boolean } | null>(null);
    const ignoreClick = useRef(false);
    const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const enabled = isCombinedToolsEnabled(settings);
    const shortcut = SHORTCUTS.find(item => item.id === settings.floatingToolsShortcut) || SHORTCUTS[0];
    const override = nested?.ownerApp === activeApp && (!nested.sessionId || nested.sessionId === chatSession?.id) ? nested : null;
    const target: FloatingBindingTarget | null = override
        ? { appId: override.appId, characterId: override.characterId }
        : activeApp === "chat" && chatSession
            ? { appId: chatSession.isGroup ? "group_chat" : "chat", characterId: chatSession.isGroup ? undefined : chatSession.contactId }
            : activeApp && BINDING_APPS.has(activeApp) ? { appId: activeApp } : null;
    const targetKey = target ? `${target.appId}:${target.characterId || "app"}` : "none";
    const scopeLabel = override?.label || (target?.appId === "chat" && target.characterId ? "当前角色 · 聊天"
        : target ? `${CONTENT_APP_LABELS[target.appId as ContentAppId] || target.appId} · 应用默认` : "全局默认");
    const previousContext = useRef(`${activeApp}:${targetKey}`);

    useEffect(() => {
        const sync = () => setSettings(loadChatAppSettings());
        sync(); window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
        return () => window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
    }, []);
    useEffect(() => { if (!enabled) setView(null); }, [enabled]);
    useEffect(() => {
        const context = `${activeApp}:${targetKey}`;
        if (previousContext.current !== context) setView(null);
        previousContext.current = context;
    }, [activeApp, targetKey]);
    useEffect(() => {
        if (!enabled) return;
        const reload = () => {
            setApis(loadApiConfigs());
            setImageSettings(loadImageGenerationSettings());
            setRevision(n => n + 1);
        };
        reload();
        window.addEventListener("settings-bindings-updated", reload);
        window.addEventListener("settings-image-generation-updated", reload);
        window.addEventListener("focus", reload);
        return () => {
            window.removeEventListener("settings-bindings-updated", reload);
            window.removeEventListener("settings-image-generation-updated", reload);
            window.removeEventListener("focus", reload);
        };
    }, [enabled]);
    useEffect(() => () => {
        if (imagePreview) URL.revokeObjectURL(imagePreview);
    }, [imagePreview]);

    const place = useCallback((next: Position, snap = false) => {
        const layer = layerRef.current;
        if (!layer) return;
        const safe = Number.parseFloat(getComputedStyle(layer).getPropertyValue("--safe-area-top")) || 48;
        const x = snap ? (edgeRef.current === "left" ? 0 : layer.clientWidth - 54) : next.x;
        const p = { x: Math.max(0, Math.min(layer.clientWidth - 54, x)), y: Math.max(safe + 16, Math.min(layer.clientHeight - 86, next.y)) };
        positionRef.current = p; setPosition(p);
    }, []);
    useLayoutEffect(() => {
        if (!enabled || !layerRef.current) { setReady(false); return; }
        const saved = loadChatAppSettings().floatingToolsPosition;
        const savedEdge = saved?.edge === "left" ? "left" : "right";
        edgeRef.current = savedEdge;
        setEdge(savedEdge);
        const ratio = Number.isFinite(saved?.ratio) ? Math.max(0, Math.min(1, saved!.ratio)) : .61;
        place({ x: 0, y: layerRef.current.clientHeight * ratio }, true);
        setReady(true);
        const observer = new ResizeObserver(() => place(positionRef.current, true));
        observer.observe(layerRef.current);
        return () => observer.disconnect();
    }, [enabled, place]);
    const wake = useCallback(() => {
        setIdle(false);
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => { if (!dragRef.current) setIdle(true); }, 3000);
    }, []);
    useEffect(() => { wake(); return () => { if (idleTimer.current) clearTimeout(idleTimer.current); if (tapTimer.current) clearTimeout(tapTimer.current); }; }, [enabled, view, wake]);
    useLayoutEffect(() => {
        const layer = layerRef.current, panel = panelRef.current;
        if (!layer || !panel || !view || view === "prompt") return;
        const layout = () => {
            const safe = Number.parseFloat(getComputedStyle(layer).getPropertyValue("--safe-area-top")) || 48;
            setPanelPosition({ x: Math.max(12, Math.min(layer.clientWidth - panel.offsetWidth - 12, positionRef.current.x + 27 - panel.offsetWidth / 2)), y: Math.max(safe + 16, Math.min(layer.clientHeight - panel.offsetHeight - 24, positionRef.current.y + 27 - panel.offsetHeight / 2)) });
        };
        layout(); const observer = new ResizeObserver(layout); observer.observe(panel); return () => observer.disconnect();
    }, [view, position, revision]);

    // Modal focus stays inside the new tool, leaving legacy panels untouched.
    useLayoutEffect(() => {
        if (!view || !enabled) return;
        const layer = layerRef.current;
        if (!layer) return;
        const siblings = [...(layer.parentElement?.children || [])].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== layer);
        const inertBefore = siblings.map(node => node.inert);
        siblings.forEach(node => { node.inert = true; });
        const focusable = () => [...layer.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length && node !== buttonRef.current);
        focusable()[0]?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); setView(view === "menu" ? null : "menu"); }
            if (event.key !== "Tab") return;
            const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            siblings.forEach((node, i) => { node.inert = inertBefore[i]; });
            document.removeEventListener("keydown", onKey);
            queueMicrotask(() => { if (buttonRef.current && !buttonRef.current.hidden) buttonRef.current.focus(); });
        };
    }, [enabled, view]);

    function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
        if (event.button !== 0) return;
        event.stopPropagation(); ignoreClick.current = false; wake();
        dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: positionRef.current, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) {
            const layer = layerRef.current, rect = layer?.getBoundingClientRect();
            const scaleX = layer && rect ? rect.width / layer.clientWidth : 1;
            const scaleY = layer && rect ? rect.height / layer.clientHeight : 1;
            setDragging(true); place({ x: drag.start.x + dx / (scaleX || 1), y: drag.start.y + dy / (scaleY || 1) });
        }
    }
    function pointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
        const drag = dragRef.current, layer = layerRef.current;
        if (!drag || drag.id !== event.pointerId || !layer) return;
        dragRef.current = null; setDragging(false);
        if (drag.moved) {
            ignoreClick.current = event.type !== "pointercancel";
            const nextEdge = positionRef.current.x + 27 < layer.clientWidth / 2 ? "left" : "right";
            edgeRef.current = nextEdge;
            setEdge(nextEdge);
            place(positionRef.current, true);
            saveChatAppSettings({ ...loadChatAppSettings(), floatingToolsPosition: { edge: edgeRef.current, ratio: positionRef.current.y / layer.clientHeight } });
        } else if (event.type === "pointerup" && event.pointerType === "touch") {
            tapTimer.current = setTimeout(() => setView("menu"), 80);
        }
        wake();
    }

    const config = view ? loadBindingConfig() : null;
    const slot = config ? getFloatingBindingSlot(config, target) : {};
    const resolved = config ? resolveBinding(config, target?.characterId, target?.appId) : {};
    const inheritedApi = view === "api" && config && target
        ? resolveBinding(updateFloatingBinding(config, target, { apiConfigId: undefined }), target.characterId, target.appId).apiConfigId
        : undefined;
    const inheritedImage = view === "api" && config && target
        ? resolveBinding(updateFloatingBinding(config, target, { imageConfigId: undefined }), target.characterId, target.appId).imageConfigId
        : undefined;
    const effectiveApis = apis.length ? apis : (view === "api" ? loadApiConfigs() : []);
    const effectiveImageSettings = imageSettings || loadImageGenerationSettings();
    const books = view === "books" ? loadWorldBooks() : [];

    const activeApiId = target ? (slot.apiConfigId || inheritedApi) : (slot.apiConfigId || resolved.apiConfigId);
    const activeApi = effectiveApis.find(api => api.id === activeApiId) || null;
    const activeFetchedModels = activeApi ? (fetchedModels[activeApi.id] || []) : [];

    const imageOptions = useMemo(() => getImageGenerationBindingOptions(effectiveImageSettings), [effectiveImageSettings]);
    const activeImageId = (target ? (slot.imageConfigId || inheritedImage) : (slot.imageConfigId || resolved.imageConfigId))
        || getActiveImageGenerationBindingId(effectiveImageSettings) || "";
    const activeImageSettings = useMemo(() => applyImageGenerationBinding(effectiveImageSettings, activeImageId), [effectiveImageSettings, activeImageId]);
    const activeNaiPreset = activeImageSettings.novelai?.presets?.find(p => p.id === activeImageSettings.novelai?.activePresetId);
    const activeImageModel = activeImageSettings.provider === "novelai" ? (activeNaiPreset?.model || "") : (activeImageSettings.model || "");
    const availableImageModels = activeImageId ? (imageModels[activeImageId] || []) : [];
    const hasImageSelection = imageOptions.some(opt => opt.id === activeImageId);

    const updateApiModel = useCallback((model: string) => {
        if (!activeApi || !model) return;
        const next = effectiveApis.map(api => api.id === activeApi.id ? { ...api, defaultModel: model } : api);
        setApis(next);
        saveApiConfigs(next);
        setModelStatus({ success: true, message: `已选择模型：${model}` });
    }, [activeApi, effectiveApis]);

    const fetchApiModels = useCallback(async () => {
        if (!activeApi || modelBusy) return;
        setModelBusy("fetch");
        setModelStatus(null);
        try {
            const baseUrl = determineBaseUrl(activeApi);
            if (!baseUrl) throw new Error("缺少 Base URL");
            if (!activeApi.apiKey) throw new Error("缺少 API Key");
            const isGoogleNative = activeApi.provider === "Google";
            const modelsBase = baseUrl.replace(/\/$/, "").replace(/\/(chat\/completions|completions|embeddings|messages)$/i, "");
            const modelsUrl = /\/models$/i.test(modelsBase) ? modelsBase : `${modelsBase}/models`;
            const url = isGoogleNative ? `${modelsUrl}?key=${encodeURIComponent(activeApi.apiKey)}` : modelsUrl;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (!isGoogleNative) headers.Authorization = `Bearer ${activeApi.apiKey}`;
            const response = await fetch(url, { method: "GET", headers });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error?.message || `HTTP ${response.status}`);
            }
            const payload = await response.json();
            const models = isGoogleNative && Array.isArray(payload?.models)
                ? payload.models.map((item: { name?: string }) => String(item.name || "").replace(/^models\//, "")).filter(Boolean)
                : Array.isArray(payload?.data)
                    ? payload.data.map((item: { id?: string }) => String(item.id || "")).filter(Boolean)
                    : [];
            if (models.length === 0) throw new Error("接口没有返回可用模型");
            setFetchedModels(prev => ({ ...prev, [activeApi.id]: models }));
            setModelStatus({ success: true, message: `已拉取 ${models.length} 个模型` });
        } catch (error) {
            setModelStatus({ success: false, message: `拉取失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setModelBusy(null);
        }
    }, [activeApi, modelBusy]);

    const testActiveApi = useCallback(async () => {
        if (!activeApi || modelBusy) return;
        if (!activeApi.defaultModel) {
            setModelStatus({ success: false, message: "请先拉取并选择模型" });
            return;
        }
        setModelBusy("test");
        setModelStatus(null);
        try {
            if (isEmbeddingModelName(activeApi.defaultModel)) {
                const embedding = await generateEmbedding("你好", activeApi, { throwOnError: true });
                if (!embedding) throw new Error("接口未返回向量数据");
                setModelStatus({ success: true, message: `测试成功，向量维度 ${embedding.length}` });
            } else {
                const result = await simpleLLMCall(
                    activeApi,
                    [{ role: "user", content: "你好，请只回复：连接成功" }],
                    { temperature: 0.2, max_tokens: 4096 },
                );
                if (result.error || !result.content) throw new Error(result.error || "模型返回为空");
                const reply = result.content.replace(/\s+/g, " ").trim();
                setModelStatus({ success: true, message: `测试成功：${reply.slice(0, 60)}${reply.length > 60 ? "…" : ""}` });
            }
        } catch (error) {
            setModelStatus({ success: false, message: `测试失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
            setModelBusy(null);
        }
    }, [activeApi, modelBusy]);

    const updateImageModel = useCallback((model: string) => {
        if (!hasImageSelection) return;
        const latest = loadImageGenerationSettings();
        const bound = applyImageGenerationBinding(latest, activeImageId);
        const next = bound.provider === "novelai" && latest.novelai
            ? { ...latest, novelai: { ...latest.novelai, presets: latest.novelai.presets.map(p => `novelai:${p.id}` === activeImageId ? { ...p, model } : p) } }
            : { ...latest, openaiPresets: latest.openaiPresets?.map(p => `openai:${p.id}` === activeImageId ? { ...p, model } : p) };
        saveImageGenerationSettings(next);
        setImageSettings(loadImageGenerationSettings());
        setImageStatus(null);
    }, [activeImageId, hasImageSelection]);

    const runImageAction = useCallback(async (action: "fetch" | "test") => {
        if (!hasImageSelection || imageBusyRef.current) return;
        imageBusyRef.current = true;
        setImageBusy(action);
        setImageStatus(null);
        try {
            if (action === "fetch") {
                const nai = activeImageSettings.novelai;
                const models = activeImageSettings.provider === "novelai"
                    ? nai?.customUrlEnabled ? [...NOVELAI_COMMON_MODELS] : await fetchNovelAiModels(nai?.apiKey || "")
                    : filterLikelyImageModels(await fetchImageGenerationModels(activeImageSettings));
                setImageModels(prev => ({ ...prev, [activeImageId]: models }));
                setImageStatus({
                    success: true,
                    message: activeImageSettings.provider === "novelai"
                        ? `已加载 ${models.length} 个常用模型`
                        : `已拉取 ${models.length} 个模型`
                });
            } else {
                const result = await generateImageFromConfiguredApi({
                    description: activeImageSettings.provider === "novelai"
                        ? "white coffee cup on a wooden table, soft window light"
                        : "一张放在木桌上的白色咖啡杯，柔和自然光，真实照片风格",
                    settings: { ...activeImageSettings, enabled: true },
                    useReferenceImage: false, includeUserReferenceImage: false,
                });
                if (!result) throw new Error("生图配置未启用或不完整");
                if (imagePreview) URL.revokeObjectURL(imagePreview);
                setImagePreview(URL.createObjectURL(result.blob));
                setImageStatus({ success: true, message: "测试生图成功" });
            }
        } catch (error) {
            setImageStatus({ success: false, message: `${action === "fetch" ? "拉取" : "测试"}失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
            imageBusyRef.current = false;
            setImageBusy(null);
        }
    }, [activeImageId, activeImageSettings, hasImageSelection, imagePreview]);

    const toggleAlbumOnlyMode = useCallback(() => {
        const cur = loadImageGenerationSettings();
        const next = { ...cur, albumOnlyMode: !cur.albumOnlyMode };
        saveImageGenerationSettings(next);
        setImageSettings(next);
    }, []);

    function update(patch: Partial<BindingSlot>) {
        saveBindingConfig(updateFloatingBinding(loadBindingConfig(), target, patch));
    }
    function navigate() {
        setView(null);
        const [app, mode] = shortcut.id.split(":");
        if (app === "settings" && !mode) window.dispatchEvent(new CustomEvent("settings-navigate", { detail: { page: "main" } }));
        window.dispatchEvent(new CustomEvent("mascot-navigate", { detail: { app, mode } }));
    }
    const scopeNote = target?.characterId
        ? "只调整此角色在本应用的配置，从下一次请求生效。"
        : target
            ? "调整本应用默认配置；角色的应用专属配置仍优先。"
            : "调整全局默认配置；未单独配置的应用与角色将沿用此设置。";

    if (!enabled) return null;

    return <div ref={layerRef} className={styles.layer} data-floating-tools="">
        <button ref={buttonRef} className={styles.assist} type="button" aria-label="打开悬浮工具" aria-expanded={!!view} aria-controls="combined-floating-panel"
            data-edge={edge}
            data-idle={idle && !view || undefined}
            data-dragging={dragging || undefined}
            hidden={!!view || !ready}
            style={{
                transform: `translate(${position.x}px, ${position.y}px)${idle && !view && !dragging ? (edge === "right" ? " translateX(38px)" : " translateX(-38px)") : ""}`
            }}
            onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
            onClick={() => { if (ignoreClick.current) { ignoreClick.current = false; return; } if (tapTimer.current) clearTimeout(tapTimer.current); setRevision(n => n + 1); setView("menu"); }}
            onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") ignoreClick.current = false;
                const steps: Record<string, Position> = { ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 }, ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 } };
                if (steps[event.key]) { event.preventDefault(); place({ x: position.x + steps[event.key].x, y: position.y + steps[event.key].y }); wake(); }
            }}><span className={styles.disc} /></button>
        {view && <>
            <div className={styles.veil} onClick={() => setView(null)} aria-hidden="true" />
            {view === "prompt" ? <div className={styles.promptHost} role="dialog" aria-modal="true" aria-label="完整提示词查看器" id="combined-floating-panel"><DebugPromptPanel managed onManagedClose={() => setView("menu")} /></div>
            : <div ref={panelRef} className={styles.panel} id="combined-floating-panel" role="dialog" aria-modal="true" aria-label="悬浮工具" style={{ left: panelPosition.x, top: panelPosition.y }}>
                <header className={styles.header}><span>{view === "shortcut" ? "页面快捷入口" : scopeLabel}</span><button type="button" aria-label={view === "menu" ? "关闭悬浮工具" : "返回工具"} onClick={() => setView(view === "menu" ? null : "menu")}>{view === "menu" ? <X size={17} /> : <ArrowLeft size={18} />}</button></header>
                {view === "menu" && <>
                    <div className={styles.tiles}>
                        <button type="button" onClick={() => setView("prompt")}><FileText className={styles.pink} />提示词</button>
                        <button type="button" onClick={() => setView("api")}><Code2 className={styles.blue} />API</button>
                        <button type="button" onClick={() => setView("books")}><BookOpen className={styles.green} />世界书</button>
                        <button type="button" title="开启原生聊天画中画小窗" onClick={() => { setView(null); window.dispatchEvent(new CustomEvent("open-mini-chat")); }}><MessageCircle className={styles.cyan} />小窗</button>
                        <button type="button" title="前往工坊" onClick={() => { setView(null); window.dispatchEvent(new CustomEvent("mascot-navigate", { detail: { app: "qa" } })); }}><Wrench className={styles.amber} />工坊</button>
                        <button type="button" aria-label={`前往${shortcut.label}`} onClick={navigate}><ArrowLeft />{shortcut.label}</button>
                    </div>
                    <button className={styles.shortcut} type="button" onClick={() => setView("shortcut")}>快捷入口 <span>更改 ›</span></button>
                    {!target && <p className={styles.note}>当前未进入特定生成页面，调整将作用于全局默认配置。</p>}
                </>}
                {view === "shortcut" && <div className={styles.detail}><h3>快捷入口</h3><p>轻点第六格，前往所选页面。</p>{SHORTCUTS.map(item => <button type="button" className={styles.option} key={item.id} aria-pressed={shortcut.id === item.id} onClick={() => saveChatAppSettings({ ...loadChatAppSettings(), floatingToolsShortcut: item.id })}>{item.label}{shortcut.id === item.id && <Check size={17} />}</button>)}</div>}
                {view === "api" && <div className={styles.detail}>
                    <h3>{target ? "本页 API" : "全局默认 API"}</h3>
                    <p>{scopeNote}</p>
                    <div className={styles.subTabs} role="tablist">
                        <button type="button" aria-pressed={apiTab === "text"} onClick={() => { setApiTab("text"); setModelStatus(null); }}>
                            <Code2 size={13} />文字 API
                        </button>
                        <button type="button" aria-pressed={apiTab === "image"} onClick={() => { setApiTab("image"); setImageStatus(null); }}>
                            <ImageIcon size={13} />生图 API
                        </button>
                    </div>

                    {apiTab === "text" && <>
                        {target && <button type="button" className={styles.option} aria-pressed={!slot.apiConfigId} onClick={() => update({ apiConfigId: undefined })}><span>继承原配置<small>{effectiveApis.find(api => api.id === inheritedApi)?.name || "尚未配置"}</small></span>{!slot.apiConfigId && <Check size={17} />}</button>}
                        {effectiveApis.map(api => {
                            const isSelected = target ? slot.apiConfigId === api.id : (slot.apiConfigId || resolved.apiConfigId) === api.id;
                            return <button type="button" className={styles.option} key={api.id} aria-pressed={isSelected} onClick={() => update({ apiConfigId: api.id })}>
                                <span>{api.name}<small>{api.defaultModel}</small></span>
                                {isSelected && <Check size={17} />}
                            </button>;
                        })}
                        {!effectiveApis.length && <p>请先在设置中添加 API。</p>}

                        {activeApi && <div className={styles.modelBox}>
                            <div className={styles.modelSelectRow}>
                                <span>模型</span>
                                <select value={activeApi.defaultModel || ""} disabled={modelBusy !== null} onChange={e => updateApiModel(e.target.value)}>
                                    {!activeApi.defaultModel && <option value="">请选择模型</option>}
                                    {activeApi.defaultModel && !activeFetchedModels.includes(activeApi.defaultModel) && (
                                        <option value={activeApi.defaultModel}>{activeApi.defaultModel}</option>
                                    )}
                                    {activeFetchedModels.map(model => <option key={model} value={model}>{model}</option>)}
                                </select>
                            </div>
                            <div className={styles.btnRow}>
                                <button type="button" disabled={modelBusy !== null} onClick={() => void fetchApiModels()}>
                                    {modelBusy === "fetch" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                    <span>{modelBusy === "fetch" ? "拉取中" : "拉取模型"}</span>
                                </button>
                                <button type="button" disabled={modelBusy !== null} onClick={() => void testActiveApi()}>
                                    {modelBusy === "test" ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                                    <span>{modelBusy === "test" ? "测试中" : "测试模型"}</span>
                                </button>
                            </div>
                            {modelStatus && (
                                <p className={`${styles.statusText} ${modelStatus.success ? styles.statusSuccess : styles.statusError}`}>
                                    {modelStatus.message}
                                </p>
                            )}
                        </div>}
                    </>}

                    {apiTab === "image" && <>
                        {target && <button type="button" className={styles.option} aria-pressed={!slot.imageConfigId} onClick={() => update({ imageConfigId: undefined })}>
                            <span>继承原配置<small>{imageOptions.find(opt => opt.id === inheritedImage)?.name || "跟随生图设置"}</small></span>
                            {!slot.imageConfigId && <Check size={17} />}
                        </button>}
                        {imageOptions.map(opt => {
                            const isSelected = target ? slot.imageConfigId === opt.id : (slot.imageConfigId || resolved.imageConfigId) === opt.id;
                            return <button type="button" className={styles.option} key={opt.id} aria-pressed={isSelected} onClick={() => update({ imageConfigId: opt.id })}>
                                <span>{opt.name}</span>
                                {isSelected && <Check size={17} />}
                            </button>;
                        })}
                        {!imageOptions.length && <p>请先在设置中添加生图方案。</p>}

                        {hasImageSelection && <div className={styles.modelBox}>
                            <div className={styles.modelSelectRow}>
                                <span>模型</span>
                                <select value={activeImageModel || ""} disabled={imageBusy !== null} onChange={e => updateImageModel(e.target.value)}>
                                    {!activeImageModel && <option value="">请选择模型</option>}
                                    {activeImageModel && !availableImageModels.includes(activeImageModel) && (
                                        <option value={activeImageModel}>{activeImageModel}</option>
                                    )}
                                    {availableImageModels.map(model => <option key={model} value={model}>{model}</option>)}
                                </select>
                            </div>
                            <div className={styles.btnRow}>
                                <button type="button" disabled={imageBusy !== null} onClick={() => void runImageAction("fetch")}>
                                    {imageBusy === "fetch" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                    <span>{imageBusy === "fetch" ? "拉取中" : "拉取模型"}</span>
                                </button>
                                <button type="button" disabled={imageBusy !== null} onClick={() => void runImageAction("test")}>
                                    {imageBusy === "test" ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                                    <span>{imageBusy === "test" ? "测试中" : "测试生图"}</span>
                                </button>
                            </div>
                            {imageStatus && (
                                <p className={`${styles.statusText} ${imageStatus.success ? styles.statusSuccess : styles.statusError}`}>
                                    {imageStatus.message}
                                </p>
                            )}
                            {imagePreview && (
                                <div className={styles.previewBox}>
                                    <img src={imagePreview} alt="测试生图预览" />
                                </div>
                            )}
                        </div>}
                        <button
                            type="button"
                            className={styles.option}
                            aria-pressed={Boolean(effectiveImageSettings.albumOnlyMode)}
                            onClick={toggleAlbumOnlyMode}
                            style={{ marginTop: 8 }}
                        >
                            <span>
                                <Camera size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
                                纯用相册模式
                                <small>{effectiveImageSettings.albumOnlyMode ? "仅使用相册匹配，拦截 API 消耗" : "未命中相册时自动回退生图 API"}</small>
                            </span>
                            {effectiveImageSettings.albumOnlyMode && <Check size={17} />}
                        </button>
                    </>}
                </div>}
                {view === "books" && <div className={styles.detail}>
                    <h3>{target ? "本页世界书" : "全局默认世界书"}</h3>
                    <p>{scopeNote}</p>
                    {target ? <>
                        <button type="button" className={styles.option} aria-pressed={slot.worldBookMode !== "replace"} onClick={() => update({ worldBookIds: undefined, worldBookMode: undefined })}>恢复继承{slot.worldBookMode !== "replace" && <Check size={17} />}</button>
                        <p>{slot.worldBookMode === "replace" ? "本页单独选择；全不选即停用继承世界书。" : "目前沿用已有绑定及角色世界。勾选后改为本页单独选择。"}</p>
                    </> : <p>勾选将在所有未单独指定世界书的页面与角色中默认注入。</p>}
                    {books.map(book => {
                        const currentIds = target ? (resolved.worldBookIds || []) : (slot.worldBookIds || []);
                        const checked = currentIds.includes(book.id);
                        return <button type="button" key={book.id} role="checkbox" aria-checked={checked} className={styles.option} onClick={() => {
                            const ids = new Set(currentIds);
                            if (checked) ids.delete(book.id); else ids.add(book.id);
                            update(target ? { worldBookIds: [...ids], worldBookMode: "replace" } : { worldBookIds: [...ids] });
                        }}>{book.name}{checked && <Check size={17} />}</button>;
                    })}
                    {!books.length && <p>请先导入世界书。</p>}
                    <p>选中的条目仍按启用状态与触发规则注入；任务额外指定的世界书不在此列表中控制。</p>
                </div>}
            </div>}
        </>}
    </div>;
}

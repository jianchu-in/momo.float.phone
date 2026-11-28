"use client";

import { memo, useState, useEffect, useRef, useMemo } from "react";
import { ChatMessageList } from "./chat-message-list";
import { ChatContactsList } from "./chat-contacts-list";
import { MomentsFeed } from "./moments-feed";
import { ChatRoom } from "./chat-room";
import { MascotChatRoom } from "./mascot-chat-room";
import { UserProfilePanel } from "./user-profile-panel";
import { MessageCircle, Users, Aperture, UserRound } from "lucide-react";
import { ChatSession, type ChatMessage, loadChatSessions, pushChatMessage, hydrateChatStorage, markChatSessionRead, setActiveChatSessionId, loadChatAppSettings, CHAT_APP_SETTINGS_UPDATED_EVENT } from "@/lib/chat-storage";
import type { MomentPost } from "@/lib/moments-types";
import { useMascotScene } from "@/components/mascot/use-mascot-scene";
import { notifyMascotPageContext } from "@/lib/mascot-events";
import { loadCharacters } from "@/lib/character-storage";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import { CHAT_APPEARANCE_OPEN, loadChatNightMode, saveChatNightMode } from "@/lib/chat-appearance";
import "@/styles/chat-night.css";
import { kvGet } from "@/lib/kv-db";
import { formatXiaohongshuShareForPrompt, type ChatSharePayload } from "@/lib/chat-share";
import { CHAT_OPEN_SESSION_EVENT, CHAT_OPEN_ADD_CONTACT_EVENT } from "@/lib/chat-notification-events";
import { CHAT_SESSIONS_MERGED_EVENT, type ChatSessionsMergedDetail } from "@/lib/chat-session-merge";
import { getMascotSettingsSnapshot } from "@/lib/mascot-settings";
import { CHAT_SCOPE_UPDATED_EVENT, loadChatScope, sessionMatchesChatScope, type ChatScopeState } from "@/lib/chat-scope-storage";
import type { ReverseChatControl, ReverseScope } from "@/lib/reverse-phone-types";
import { reverseAllowedSessions } from "@/lib/reverse-phone-actions";
import { resolveReversePermissions } from "@/lib/reverse-phone-storage";
import { getCharacterWorldGroup } from "@/lib/character-world-storage";
import { WalletPanel } from "./wallet-panel";

type TabKey = "messages" | "contacts" | "feeds" | "me";

function sameGroupMembers(a?: string[], b?: string[]): boolean {
    const left = [...(a || [])].sort();
    const right = [...(b || [])].sort();
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * 外部入口可能携带另一个聊天账号的旧 sessionId。当前界面显示哪个账号，
 * 就只允许进入该账号的会话；私聊/群聊均尽量映射到当前账号下的对应会话。
 */
function resolveSessionInCurrentScope(sessionId: string): ChatSession | null {
    const sessions = loadChatSessions();
    const requested = sessions.find(item => item.id === sessionId);
    if (!requested) return null;
    const scope = loadChatScope();
    if (sessionMatchesChatScope(requested, scope)) return requested;
    if (!requested.isGroup) {
        return sessions.find(item => (
            !item.isGroup
            && item.contactId === requested.contactId
            && sessionMatchesChatScope(item, scope)
        )) || null;
    }
    return sessions.find(item => (
        item.isGroup
        && Boolean(item.isSpectator) === Boolean(requested.isSpectator)
        && sameGroupMembers(item.participantIds, requested.participantIds)
        && sessionMatchesChatScope(item, scope)
    )) || null;
}

export type PhoneChatAppProps = {
    inspectionControl?: ReverseChatControl;
    inspectionViewer?: {characterId:string;scope:ReverseScope};
    onClose: () => void;
    sceneVisible?: boolean;
    initialSessionId?: string | null;
    onSessionChange?: (session: ChatSession | null) => void;
    sharePayload?: ChatSharePayload | null;
    onShareDone?: () => void;
    /** Story floating-window bridge. Only messages actually sent by the user are reported. */
    onUserMessageSent?: (message: ChatMessage, session: ChatSession) => void;
    /** Story floating-window bridge for user-published Moments. */
    onMomentPublished?: (post: MomentPost) => void;
};

export const PhoneChatApp = memo(function PhoneChatApp({ onClose, initialSessionId, onSessionChange, sharePayload, onShareDone, onUserMessageSent, onMomentPublished, sceneVisible = true, inspectionControl, inspectionViewer }: PhoneChatAppProps) {
    const [activeTab, setActiveTab] = useState<TabKey>("messages");
    const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
    const [activeMascot, setActiveMascot] = useState(false);
    const [contactProfileOpen, setContactProfileOpen] = useState(false);
    const [contactCall, setContactCall] = useState<{ id: string; sessionId: string; type: "voice" | "video" } | null>(null);
    // Chat app-level custom CSS (affects all chat pages, lower priority than per-session CSS)
    const [chatAppCSS, setChatAppCSS] = useState(() =>
        typeof window !== "undefined" ? kvGet("chat-app-custom-css") || "" : ""
    );
    const [chatAppSettingsRev, setChatAppSettingsRev] = useState(0);
    useEffect(() => {
        const onSettings = () => setChatAppSettingsRev(v => v + 1);
        window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, onSettings);
        return () => window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, onSettings);
    }, []);
    const isIMessage = useMemo(
        () => !inspectionControl && loadChatAppSettings().globalChatUiStyle === "imessage",
        [inspectionControl, chatAppSettingsRev]
    );
    // Cache all visited sessions so their ChatRoom stays mounted (hidden)
    const [visitedSessions, setVisitedSessions] = useState<Map<string, ChatSession>>(new Map());
    const [dbReady, setDbReady] = useState(false);
    const [inspectionRevision, setInspectionRevision] = useState(0);
    useEffect(() => {
        if (!inspectionControl) return;
        const refresh = () => setInspectionRevision(value => value + 1);
        const events = ["reverse-phone-settings-updated", "character-worlds-updated", "characters-updated", "chat-messages-updated", "weixin-messages-updated", "chat-message-pushed", CHAT_SCOPE_UPDATED_EVENT, CHAT_SESSIONS_MERGED_EVENT];
        events.forEach(event => window.addEventListener(event, refresh));
        return () => events.forEach(event => window.removeEventListener(event, refresh));
    }, [Boolean(inspectionControl)]);
    const inspectionList = useMemo(() => {
        if (!inspectionControl) return undefined;
        const viewer = inspectionViewer;
        const sessionIds = viewer && resolveReversePermissions(viewer.characterId, viewer.scope).modes.chat === "open"
            ? reverseAllowedSessions(viewer.characterId, viewer.scope).map(item => item.id) : [];
        return {sessionIds, characterId:viewer?.characterId ?? "", sameWorldCharacterIds:viewer ? getCharacterWorldGroup(viewer.characterId)?.memberIds ?? [viewer.characterId] : []};
    }, [Boolean(inspectionControl), inspectionViewer?.characterId, inspectionViewer?.scope.key, inspectionRevision, dbReady]);
    const inspectionSessionKey = inspectionList?.sessionIds.join("\n");
    useEffect(() => {
        const refresh = (event: Event) => {
            const id = (event as CustomEvent<{ sessionId: string }>).detail?.sessionId;
            const updated = id ? resolveSessionInCurrentScope(id) : null;
            if (!updated) return;
            setActiveSession(current => current?.id === updated.id ? updated : current);
            setVisitedSessions(current => {
                if (!current.has(updated.id)) return current;
                const next = new Map(current); next.set(updated.id, updated); return next;
            });
        };
        window.addEventListener("reverse-phone-contact-updated", refresh);
        return () => window.removeEventListener("reverse-phone-contact-updated", refresh);
    }, []);
    useEffect(() => {
        if (!inspectionControl || !dbReady) return;
        const target = inspectionControl.sessionId && inspectionList?.sessionIds.includes(inspectionControl.sessionId) ? resolveSessionInCurrentScope(inspectionControl.sessionId) : null;
        setActiveTab(inspectionControl.page === "messages" ? "messages" : "me");
        setActiveSession(target);
    }, [inspectionControl?.page, inspectionControl?.sessionId, inspectionSessionKey, dbReady]);
    const [hideTabBar, setHideTabBar] = useState(false);
    const [nightMode, setNightMode] = useState(loadChatNightMode);
    const [appearanceOpen, setAppearanceOpen] = useState(false);

    useEffect(() => {
        const update = () => setNightMode(loadChatNightMode());
        update();
        window.addEventListener("chat-night-mode-updated", update);
        const open = () => { if (!inspectionControl && sceneVisible) setAppearanceOpen(true); };
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") setAppearanceOpen(false); };
        window.addEventListener(CHAT_APPEARANCE_OPEN, open);
        window.addEventListener("keydown", close);
        return () => { window.removeEventListener("chat-night-mode-updated", update); window.removeEventListener(CHAT_APPEARANCE_OPEN, open); window.removeEventListener("keydown", close); };
    }, [inspectionControl, sceneVisible]);

    // Hydrate IndexedDB → in-memory caches on mount
    useEffect(() => {
        hydrateChatStorage().then(() => {
            setDbReady(true);
            // Resolve initial session after hydration
            if (initialSessionId) {
                const s = resolveSessionInCurrentScope(initialSessionId);
                if (s) setActiveSession(s);
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // React to external session navigation (e.g., incoming call acceptance)
    // Only fires when initialSessionId CHANGES after mount (mount case handled by hydration above)
    const prevInitSessionId = useRef(initialSessionId);
    useEffect(() => {
        if (initialSessionId === prevInitSessionId.current) return;
        prevInitSessionId.current = initialSessionId;
        if (!dbReady) return;
        if (!initialSessionId) {
            setActiveSession(null);
            return;
        }
        const s = resolveSessionInCurrentScope(initialSessionId);
        setActiveSession(s);
    }, [initialSessionId, dbReady]);

    // When sharePayload is set, switch to contacts tab (and close any open chat room)
    useEffect(() => {
        if (sharePayload) {
            setActiveSession(null);
            setActiveMascot(false);
            setActiveTab("contacts");
        }
    }, [sharePayload]);

    useEffect(() => {
        if (inspectionControl) return;
        const handler = (e: Event) => {
            const sessionId = (e as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
            if (!sessionId) return;
            const session = resolveSessionInCurrentScope(sessionId);
            if (!session) return;
            setActiveMascot(false);
            setActiveSession(session);
            setActiveTab("messages");
        };
        window.addEventListener(CHAT_OPEN_SESSION_EVENT, handler);
        return () => window.removeEventListener(CHAT_OPEN_SESSION_EVENT, handler);
    }, [Boolean(inspectionControl)]);

    // 切换主号/小号后，旧账号的聊天室不能继续留在前台或挂载缓存中。
    useEffect(() => {
        const handler = (event: Event) => {
            const scope = (event as CustomEvent<ChatScopeState>).detail || loadChatScope();
            setContactCall(null);
            setActiveSession(current => current && sessionMatchesChatScope(current, scope) ? current : null);
            setVisitedSessions(current => {
                const next = new Map(
                    [...current.entries()].filter(([, session]) => sessionMatchesChatScope(session, scope)),
                );
                return next.size === current.size ? current : next;
            });
        };
        window.addEventListener(CHAT_SCOPE_UPDATED_EVENT, handler);
        return () => window.removeEventListener(CHAT_SCOPE_UPDATED_EVENT, handler);
    }, []);

    // 重复会话被合并：被删会话的聊天室缓存一并卸载
    useEffect(() => {
        const handler = (e: Event) => {
            const removed = (e as CustomEvent<ChatSessionsMergedDetail>).detail?.removedSessionIds;
            if (!removed?.length) return;
            const removedSet = new Set(removed);
            setVisitedSessions(prev => {
                if (![...prev.keys()].some(id => removedSet.has(id))) return prev;
                const next = new Map(prev);
                removedSet.forEach(id => next.delete(id));
                return next;
            });
            setActiveSession(prev => (prev && removedSet.has(prev.id) ? null : prev));
        };
        window.addEventListener(CHAT_SESSIONS_MERGED_EVENT, handler);
        return () => window.removeEventListener(CHAT_SESSIONS_MERGED_EVENT, handler);
    }, []);

    // 名片点击「加好友」：关会话、切联系人 tab，待添加角色经 prop 交给列表打开添加页
    const [pendingAddContactId, setPendingAddContactId] = useState<string | null>(null);
    // 名片来源的原聊天室：添加页按返回时回到这里
    const addContactReturnSessionRef = useRef<string | null>(null);
    const activeSessionIdRef = useRef<string | null>(null);
    activeSessionIdRef.current = activeSession?.id ?? null;
    useEffect(() => {
        const handler = (e: Event) => {
            const characterId = (e as CustomEvent<{ characterId?: string }>).detail?.characterId;
            if (!characterId) return;
            addContactReturnSessionRef.current = activeSessionIdRef.current;
            setActiveSession(null);
            setActiveMascot(false);
            setActiveTab("contacts");
            setPendingAddContactId(characterId);
        };
        window.addEventListener(CHAT_OPEN_ADD_CONTACT_EVENT, handler);
        return () => window.removeEventListener(CHAT_OPEN_ADD_CONTACT_EVENT, handler);
    }, []);

    const activeSceneCharacter = activeSession && !activeSession.isGroup
        ? loadCharacters().find(character => character.id === activeSession.contactId)
        : undefined;
    useMascotScene("chat", activeSession
        ? `${activeSession.isGroup ? "群聊" : "私聊"} · ${activeSession.groupName || activeSession.alias || activeSceneCharacter?.name || "对话"}`
        : "聊天", activeSession
        ? { sessionId: activeSession.id, contactId: activeSession.contactId }
        : {}, sceneVisible && !activeMascot, 0);

    // Notify parent of session changes and cache visited sessions
    useEffect(() => {
        onSessionChange?.(activeSession);
        if (activeSession) {
            setActiveMascot(false);
            setVisitedSessions(prev => {
                if (prev.has(activeSession.id)) return prev;
                const next = new Map(prev);
                next.set(activeSession.id, activeSession);
                return next;
            });
        }
    }, [activeSession]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const sessionId = activeSession?.id ?? null;
        setActiveChatSessionId(sessionId);
        if (sessionId) markChatSessionRead(sessionId);
    }, [activeSession?.id]);

    useEffect(() => () => setActiveChatSessionId(null), []);

    useEffect(() => {
        const markVisibleRoomRead = () => {
            if (document.visibilityState !== "visible") return;
            const sessionId = activeSessionIdRef.current;
            if (sessionId) markChatSessionRead(sessionId);
        };
        document.addEventListener("visibilitychange", markVisibleRoomRead);
        return () => document.removeEventListener("visibilitychange", markVisibleRoomRead);
    }, []);

    useEffect(() => {
        if (!activeMascot || !sceneVisible) return;
        onSessionChange?.(null);
        notifyMascotPageContext({
            page: "chat",
            mode: "chatting",
            label: `聊天 · ${getMascotSettingsSnapshot().nickname || "AI助手"}`,
            fields: { sessionId: "mascot", contactId: "mascot" },
        });
    }, [activeMascot, sceneVisible]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSelectContact = (sess: ChatSession | null) => {
        if (sharePayload && sess) {
            if (sharePayload.type === "music") {
                pushChatMessage({
                    sessionId: sess.id,
                    role: "user",
                    content: "",
                    mediaType: "music_share",
                    listeningContext: sharePayload.listeningContext,
                    mediaData: {
                        musicTitle: sharePayload.title,
                        musicArtist: sharePayload.artist,
                        musicCoverUrl: sharePayload.coverUrl,
                        lyricMode: sharePayload.lyricMode,
                        listeningContext: sharePayload.listeningContext,
                        label: `${sharePayload.title} - ${sharePayload.artist}`,
                    },
                });
            } else {
                const content = formatXiaohongshuShareForPrompt({
                    author: sharePayload.authorName,
                    title: sharePayload.title,
                    body: sharePayload.body,
                    description: sharePayload.description,
                });
                pushChatMessage({
                    sessionId: sess.id,
                    role: "user",
                    content,
                    mediaType: "xiaohongshu_note_share",
                    mediaData: {
                        xiaohongshuAuthor: sharePayload.authorName,
                        xiaohongshuTitle: sharePayload.title,
                        xiaohongshuBody: sharePayload.body,
                        xiaohongshuDescription: sharePayload.description,
                        xiaohongshuNoteType: sharePayload.noteType,
                        xiaohongshuTags: sharePayload.tags,
                        xiaohongshuImageAssetId: sharePayload.imageAssetId,
                        xiaohongshuCoverIcon: sharePayload.coverIcon,
                        xiaohongshuTone: sharePayload.tone,
                    },
                });
            }
            window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: sess.id } }));
            onShareDone?.();
        }
        setActiveMascot(false);
        setActiveSession(sess);
        setActiveTab("messages");
    };

    const handleSelectMascot = () => {
        setActiveSession(null);
        setActiveMascot(true);
        setActiveTab("messages");
    };

    // Listen for CSS updates from settings panel
    useEffect(() => {
        const onCSSUpdate = () => setChatAppCSS(kvGet("chat-app-custom-css") || "");
        window.addEventListener("chat-app-css-updated", onCSSUpdate);
        return () => window.removeEventListener("chat-app-css-updated", onCSSUpdate);
    }, []);

    // Listen for tab bar hide/show from sub-pages (e.g. CSS editor)
    useEffect(() => {
        const onHide = (e: Event) => setHideTabBar((e as CustomEvent).detail);
        window.addEventListener("chat-hide-tabbar", onHide);
        return () => window.removeEventListener("chat-hide-tabbar", onHide);
    }, []);

    // Wait for IndexedDB hydration before rendering
    if (!dbReady) return null;

    return (
        <div
            data-chat-inspection={inspectionControl ? "" : undefined}
            data-chat-theme={!inspectionControl && nightMode ? "dark" : "light"}
            className="chat-app absolute inset-0 flex flex-col overflow-hidden z-10"
            {...(activeSession || activeMascot ? { "data-room-active": "" } : {})}
            {...(hideTabBar || contactProfileOpen ? { "data-tabbar-hidden": "" } : {})}
        >
            {/* Homepage appearance CSS is the lowest chat styling layer. */}
            {!inspectionControl && chatAppCSS && <SessionCustomCSS css={chatAppCSS} scope=".chat-app" priority />}
            {appearanceOpen && !inspectionControl && (
                <div className="chat-appearance-scrim" onClick={() => setAppearanceOpen(false)}>
                    <section role="dialog" aria-modal="true" aria-labelledby="chat-appearance-title" className="chat-appearance-dialog" onClick={event => event.stopPropagation()}>
                        <h2 id="chat-appearance-title">{nightMode ? "切换日间模式" : "切换夜间模式"}</h2>
                        <div className="chat-appearance-actions">
                            <button type="button" autoFocus onClick={() => {
                                const next = !nightMode;
                                saveChatNightMode(next);
                                setNightMode(next);
                                window.dispatchEvent(new Event("chat-night-mode-updated"));
                                setAppearanceOpen(false);
                            }}>确认</button>
                            <button type="button" onClick={() => setAppearanceOpen(false)}>取消</button>
                        </div>
                    </section>
                </div>
            )}
            {/* The Main Content Area */}
            <div className="chat-main-content relative flex-1 flex flex-col overflow-hidden" {...(activeSession || activeMascot ? { "data-covered-by-room": "" } : {})}>
                {activeTab === "messages" && <ChatMessageList defaultAppearance={Boolean(inspectionControl)} inspection={inspectionList} onCloseApp={onClose} activeSession={activeSession} onSelectSession={(session) => { setActiveMascot(false); setActiveSession(session); }} onSelectMascot={handleSelectMascot} />}
                {activeTab === "contacts" && (
                    <ChatContactsList
                        onCloseApp={onClose}
                        onSelectSession={handleSelectContact}
                        selectForShare={Boolean(sharePayload)}
                        onSubpageChange={setContactProfileOpen}
                        onStartCall={(session, type) => {
                            setContactCall({ id: `contact-call-${Date.now()}-${Math.random().toString(36).slice(2)}`, sessionId: session.id, type });
                            setActiveMascot(false); setActiveSession(session); setActiveTab("messages");
                        }}
                        onSelectMascot={handleSelectMascot}
                        pendingAddContactId={pendingAddContactId}
                        onPendingAddContactConsumed={() => setPendingAddContactId(null)}
                        onPendingAddContactBack={() => {
                            const sessionId = addContactReturnSessionRef.current;
                            addContactReturnSessionRef.current = null;
                            if (!sessionId) return;
                            const session = resolveSessionInCurrentScope(sessionId);
                            if (!session) return;
                            setActiveSession(session);
                            setActiveTab("messages");
                        }}
                    />
                )}
                {activeTab === "feeds" && <MomentsFeed sceneVisible={sceneVisible} onCloseApp={onClose} onUserPublished={onMomentPublished} />}
                {activeTab === "me" && (inspectionControl?.page === "wallet" ? <WalletPanel onBack={() => {}} /> : <UserProfilePanel onClose={() => setActiveTab("messages")} />)}
            </div>

            {/* Bottom Navigation Bar — hide when inside a chat room */}
            <nav className={`chat-tab-bar ${isIMessage ? "chat-bottom-glass-bar" : ""}`} data-ui="nav" style={{ display: activeSession || activeMascot || hideTabBar || contactProfileOpen ? "none" : undefined }}>
                <button
                    className={`chat-tab ${activeTab === "messages" ? "chat-tab-active" : ""}`}
                    onClick={() => setActiveTab("messages")}
                >
                    <MessageCircleIcon active={activeTab === "messages"} />
                    <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: activeTab === "messages" ? undefined : "var(--c-text)" }}>消息</span>
                </button>
                <button
                    className={`chat-tab ${activeTab === "contacts" ? "chat-tab-active" : ""}`}
                    onClick={() => setActiveTab("contacts")}
                >
                    <UsersIcon active={activeTab === "contacts"} />
                    <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: activeTab === "contacts" ? undefined : "var(--c-text)" }}>联系人</span>
                </button>
                <button
                    className={`chat-tab ${activeTab === "feeds" ? "chat-tab-active" : ""}`}
                    onClick={() => setActiveTab("feeds")}
                >
                    <CompassIcon active={activeTab === "feeds"} />
                    <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: activeTab === "feeds" ? undefined : "var(--c-text)" }}>动态</span>
                </button>
                <button
                    data-reverse-target="profile"
                    className={`chat-tab ${activeTab === "me" ? "chat-tab-active" : ""}`}
                    onClick={() => setActiveTab("me")}
                >
                    <MeIcon active={activeTab === "me"} />
                    <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: activeTab === "me" ? undefined : "var(--c-text)" }}>主页</span>
                </button>
            </nav>

            {/* Chat Rooms — all visited sessions stay mounted, only active one is visible */}
            {[...visitedSessions.values()].filter(sess => !inspectionControl || (sess.id === activeSession?.id && inspectionList?.sessionIds.includes(sess.id))).map(sess => (
                <div key={sess.id} style={{ display: activeSession?.id === sess.id ? undefined : 'none' }} className="chat-room-layer absolute inset-0">
                    <ChatRoom
                        session={sess}
                        inspection={inspectionControl}
                        contactCallRequest={contactCall?.sessionId === sess.id ? contactCall : undefined}
                        onContactCallHandled={() => setContactCall(null)}
                        onBack={() => setActiveSession(null)}
                        onUserMessageSent={message => onUserMessageSent?.(message, sess)}
                        onDeleted={() => {
                            // 会话已删除：把缓存的聊天室一并卸载，避免僵尸挂载
                            setVisitedSessions(prev => {
                                const next = new Map(prev);
                                next.delete(sess.id);
                                return next;
                            });
                            setActiveSession(null);
                        }}
                    />
                </div>
            ))}
            {activeMascot && (
                <div className="chat-room-layer absolute inset-0">
                    <MascotChatRoom
                        onBack={() => setActiveMascot(false)}
                        onDeleted={() => setActiveMascot(false)}
                    />
                </div>
            )}
        </div>
    );
});

// Refined Icons
function MessageCircleIcon({ active }: { active: boolean }) {
    return <MessageCircle fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} size={20} style={{ transform: active ? "scale(1.1)" : "scale(1)", transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />;
}

function UsersIcon({ active }: { active: boolean }) {
    return <Users fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} size={20} style={{ transform: active ? "scale(1.1)" : "scale(1)", transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />;
}

function CompassIcon({ active }: { active: boolean }) {
    return <Aperture fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} size={20} style={{ transform: active ? "scale(1.1) rotate(25deg)" : "scale(1) rotate(0deg)", transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />;
}

function MeIcon({ active }: { active: boolean }) {
    return <UserRound fill="none" stroke="currentColor" strokeWidth={active ? 1.8 : 1.7} size={20} style={{ transform: active ? "scale(1.1)" : "scale(1)", transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />;
}

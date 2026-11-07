"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight, Globe2, MessageCircleMore, Pencil, Plus, RotateCcw, SlidersHorizontal, UserRound } from "lucide-react";
import { BottomSheet } from "@/components/ui/modal";
import { loadUserIdentities } from "@/lib/settings-storage";
import { loadCharacterWorldGroups } from "@/lib/character-world-storage";
import {
    CHAT_SCOPE_UPDATED_EVENT,
    clearChatScope,
    getChatScopeLabel,
    loadChatScope,
    resolveBoundUserIdentityId,
    saveChatScope,
    type ChatScopeState,
} from "@/lib/chat-scope-storage";
import {
    CHAT_ALT_ACCOUNTS_UPDATED_EVENT,
    createChatAltAccount,
    deleteChatAltAccount,
    loadChatAltAccounts,
    updateChatAltAccount,
    type ChatAltAccount,
} from "@/lib/chat-alt-account-storage";

export function ChatScopeSwitcher({ onScopeChange }: { onScopeChange?: (scope: ChatScopeState) => void }) {
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState<"account" | "identity" | "world" | null>(null);
    const [scope, setScope] = useState<ChatScopeState>(() => loadChatScope());
    const [creatingAccount, setCreatingAccount] = useState(false);
    const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
    const [accountDraft, setAccountDraft] = useState({ userIdentityId: "", nickname: "", gender: "", age: "", signature: "", avatarUrl: "", persona: "" });

    const startEditAccount = (account: ChatAltAccount) => {
        setEditingAccountId(account.id);
        setAccountDraft({
            userIdentityId: account.userIdentityId,
            nickname: account.nickname,
            gender: account.gender || "",
            age: account.age || "",
            signature: account.signature || "",
            avatarUrl: account.avatarUrl || "",
            persona: account.persona || "",
        });
        setCreatingAccount(true);
    };

    useEffect(() => {
        const sync = () => setScope(loadChatScope());
        window.addEventListener(CHAT_SCOPE_UPDATED_EVENT, sync);
        window.addEventListener("character-worlds-updated", sync);
        window.addEventListener("user-identities-updated", sync);
        window.addEventListener(CHAT_ALT_ACCOUNTS_UPDATED_EVENT, sync);
        return () => {
            window.removeEventListener(CHAT_SCOPE_UPDATED_EVENT, sync);
            window.removeEventListener("character-worlds-updated", sync);
            window.removeEventListener("user-identities-updated", sync);
            window.removeEventListener(CHAT_ALT_ACCOUNTS_UPDATED_EVENT, sync);
        };
    }, []);

    const update = (patch: Partial<ChatScopeState>) => {
        const next = saveChatScope({ ...scope, ...patch });
        setScope(next);
        onScopeChange?.(next);
    };

    const reset = () => {
        const next = clearChatScope();
        setScope(next);
        setExpanded(null);
        onScopeChange?.(next);
    };

    const identities = open ? loadUserIdentities() : [];
    const allWorlds = open ? loadCharacterWorldGroups() : [];
    const worlds = allWorlds;
    const accounts = open ? loadChatAltAccounts().filter(account => !account.deletedAt) : [];
    const isFiltered = Boolean(scope.chatAccountId || scope.userIdentityId || scope.worldId);

    return (
        <>
            <button
                type="button"
                className="page-back-btn relative"
                aria-label="切换身份和世界观"
                title={getChatScopeLabel(scope)}
                onClick={() => {
                    setExpanded(null);
                    setCreatingAccount(false);
                    setOpen(true);
                }}
            >
                <SlidersHorizontal size={21} strokeWidth={1.65} />
                {isFiltered && <span className="absolute right-[5px] top-[5px] h-2 w-2 rounded-full bg-[#ff4d6d] ring-2 ring-[var(--c-page-header-bg,#fff)]" />}
            </button>

            {open && (
                <BottomSheet title="筛选主页内容" onClose={() => setOpen(false)}>
                    <div className="flex max-h-[68vh] flex-col overflow-y-auto pb-4 overscroll-contain">
                        <div className="menu-group">
                            <ScopeMenuRow
                                icon={<MessageCircleMore size={18} />}
                                label="选择小号聊天"
                                value={scope.chatAccountId
                                    ? accounts.find(item => item.id === scope.chatAccountId)?.nickname || "已选择小号"
                                    : "主号聊天"}
                                expanded={expanded === "account"}
                                onClick={() => {
                                    setCreatingAccount(false);
                                    setExpanded(current => current === "account" ? null : "account");
                                }}
                            />
                            {expanded === "account" && (
                                <div className="border-t border-[var(--c-border)] bg-[var(--c-page-body-bg)] px-2 py-1 max-h-[42vh] overflow-y-auto overscroll-contain">
                                    {!creatingAccount ? (
                                        <>
                                            <ScopeOption
                                                label="主号聊天"
                                                description="使用原有身份绑定、通讯录和聊天记录"
                                                selected={!scope.chatAccountId}
                                                onClick={() => {
                                                    update({ chatAccountId: null, userIdentityId: null, worldId: null });
                                                    setExpanded(null);
                                                }}
                                            />
                                            {Array.from(new Set(accounts.map(account => account.userIdentityId))).map(identityId => (
                                                <details key={identityId} open className="my-1 rounded-xl border border-[var(--c-border)]">
                                                <summary className="cursor-pointer px-3 py-2 ts-12">{identities.find(item => item.id === identityId)?.name || "未分组身份"}</summary>
                                                {accounts.filter(account => account.userIdentityId === identityId).map(account => (
                                                <div key={account.id}>
                                                <ScopeOption
                                                    key={account.id}
                                                    label={account.nickname}
                                                    description={`${identities.find(item => item.id === account.userIdentityId)?.name || "身份已失效"}${account.signature ? ` · ${account.signature}` : ""}`}
                                                    image={account.avatarUrl}
                                                    selected={scope.chatAccountId === account.id}
                                                    onClick={() => {
                                                        update({ chatAccountId: account.id, userIdentityId: account.userIdentityId, worldId: null });
                                                        setExpanded(null);
                                                    }}
                                                    onEdit={() => startEditAccount(account)}
                                                />
                                                <div className="flex justify-end gap-3 px-3 pb-2 ts-12">
                                                    <button type="button" onClick={() => startEditAccount(account)}>编辑</button>
                                                    <button type="button" onClick={() => {
                                                        if (!window.confirm(`删除“${account.nickname}”？历史聊天和记忆将保留。`)) return;
                                                        deleteChatAltAccount(account.id);
                                                        if (scope.chatAccountId === account.id) update({ chatAccountId: null, userIdentityId: null, worldId: null });
                                                    }}>删除</button>
                                                </div>
                                                </div>
                                                ))}
                                                </details>
                                            ))}
                                            <button
                                                type="button"
                                                className="menu-item w-full text-left"
                                                onClick={() => {
                                                    setAccountDraft({ userIdentityId: identities[0]?.id || "", nickname: "", gender: "", age: "", signature: "", avatarUrl: "", persona: "" });
                                                    setEditingAccountId(null);
                                                    setCreatingAccount(true);
                                                }}
                                            >
                                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--c-input)] text-[var(--c-icon-active)]"><Plus size={17} /></span>
                                                <span className="min-w-0 flex-1"><span className="menu-label block">创建小号</span><span className="menu-desc block">从一个用户身份创建独立聊天空间</span></span>
                                            </button>
                                        </>
                                    ) : (
                                        <div className="flex flex-col gap-3 px-2 py-3">
                                            <div className="ts-13 font-medium text-[var(--c-text)]">
                                                {editingAccountId ? "编辑独立小号" : "创建独立小号"}
                                            </div>
                                            <label className="flex flex-col gap-1 ts-12 text-[var(--c-text)]">
                                                <span>收纳到用户身份</span>
                                                <select className="ui-input" value={accountDraft.userIdentityId} onChange={event => setAccountDraft(current => ({ ...current, userIdentityId: event.target.value }))}>
                                                    {identities.map(identity => <option key={identity.id} value={identity.id}>{identity.name || "未命名身份"}</option>)}
                                                </select>
                                            </label>
                                            <label className="flex flex-col gap-1 ts-12 text-[var(--c-text)]"><span>网名</span><input className="ui-input" value={accountDraft.nickname} onChange={event => setAccountDraft(current => ({ ...current, nickname: event.target.value }))} placeholder="必填" /></label>
                                            <label className="flex flex-col gap-1 ts-12 text-[var(--c-text)]"><span>头像地址</span><input className="ui-input" value={accountDraft.avatarUrl} onChange={event => setAccountDraft(current => ({ ...current, avatarUrl: event.target.value }))} placeholder="选填" /></label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <label className="flex flex-col gap-1 ts-12 text-[var(--c-text)]"><span>性别</span><input className="ui-input" value={accountDraft.gender} onChange={event => setAccountDraft(current => ({ ...current, gender: event.target.value }))} placeholder="选填" /></label>
                                                <label className="flex flex-col gap-1 ts-12 text-[var(--c-text)]"><span>年龄</span><input className="ui-input" value={accountDraft.age} onChange={event => setAccountDraft(current => ({ ...current, age: event.target.value }))} placeholder="选填" /></label>
                                            </div>
                                            <label className="flex flex-col gap-1 ts-12 text-[var(--c-text)]">
                                                <span>个性签名</span>
                                                <textarea className="ui-textarea min-h-[56px]" value={accountDraft.signature} onChange={event => setAccountDraft(current => ({ ...current, signature: event.target.value }))} placeholder="选填，用于名片与社交主页展示" />
                                            </label>
                                            <label className="flex flex-col gap-1 ts-12 text-[var(--c-text)]">
                                                <span>人物背景与人设</span>
                                                <textarea
                                                    className="ui-textarea min-h-[96px]"
                                                    value={accountDraft.persona}
                                                    onChange={event => setAccountDraft(current => ({ ...current, persona: event.target.value }))}
                                                    placeholder="选填。填写该独立人物的性格、外貌特征、生活背景或与角色的专属相识背景等。模型将完全以此作为真实人物认知，绝无小号或掉马猜疑。"
                                                />
                                            </label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button type="button" className="ui-btn ui-btn-ghost" onClick={() => { setCreatingAccount(false); setEditingAccountId(null); }}>取消</button>
                                                <button
                                                    type="button"
                                                    className="ui-btn ui-btn-primary"
                                                    disabled={!accountDraft.userIdentityId || !accountDraft.nickname.trim()}
                                                    onClick={() => {
                                                        if (editingAccountId) {
                                                            updateChatAltAccount(editingAccountId, accountDraft);
                                                            update({ chatAccountId: editingAccountId, userIdentityId: accountDraft.userIdentityId, worldId: null });
                                                        } else {
                                                            const created = createChatAltAccount(accountDraft);
                                                            update({ chatAccountId: created.id, userIdentityId: created.userIdentityId, worldId: null });
                                                        }
                                                        setCreatingAccount(false);
                                                        setEditingAccountId(null);
                                                        setExpanded(null);
                                                    }}
                                                >{editingAccountId ? "保存修改" : "保存并切换"}</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <ScopeMenuRow
                                icon={<UserRound size={18} />}
                                label={scope.chatAccountId ? "绑定身份（固定）" : "选择身份"}
                                value={scope.userIdentityId
                                    ? identities.find(item => item.id === scope.userIdentityId)?.name || "已选择身份"
                                    : "全部身份"}
                                expanded={expanded === "identity"}
                                onClick={() => {
                                    if (scope.chatAccountId) return;
                                    setExpanded(current => current === "identity" ? null : "identity");
                                }}
                            />
                            {expanded === "identity" && (
                                <div className="border-t border-[var(--c-border)] bg-[var(--c-page-body-bg)] px-2 py-1 max-h-[42vh] overflow-y-auto overscroll-contain">
                                <ScopeOption
                                    label="全部身份"
                                    description="显示所有身份绑定的内容"
                                    selected={!scope.userIdentityId}
                                    onClick={() => {
                                        update({ userIdentityId: null });
                                        setExpanded(null);
                                    }}
                                />
                                {identities.map(identity => (
                                    <ScopeOption
                                        key={identity.id}
                                        label={identity.name || "未命名身份"}
                                        description={identity.occupation || identity.bio || "用户身份"}
                                        image={identity.avatarUrl}
                                        selected={scope.userIdentityId === identity.id}
                                        onClick={() => {
                                            update({ userIdentityId: identity.id });
                                            setExpanded(null);
                                        }}
                                    />
                                ))}
                                </div>
                            )}

                            <ScopeMenuRow
                                icon={<Globe2 size={18} />}
                                label="选择世界观"
                                value={scope.worldId
                                    ? worlds.find(item => item.id === scope.worldId)?.name || "已选择世界观"
                                    : "全部世界观"}
                                expanded={expanded === "world"}
                                onClick={() => setExpanded(current => current === "world" ? null : "world")}
                            />
                            {expanded === "world" && (
                                <div className="border-t border-[var(--c-border)] bg-[var(--c-page-body-bg)] px-2 py-1 max-h-[42vh] overflow-y-auto overscroll-contain">
                                <ScopeOption
                                    label="全部世界观"
                                    description="显示所有世界中的内容"
                                    selected={!scope.worldId}
                                    onClick={() => {
                                        update({ worldId: null });
                                        setExpanded(null);
                                    }}
                                />
                                {worlds.map(world => (
                                    <ScopeOption
                                        key={world.id}
                                        label={world.name || "未命名世界"}
                                        description={`${world.memberIds.length} 位角色${world.description ? ` · ${world.description}` : ""}`}
                                        selected={scope.worldId === world.id}
                                        onClick={() => {
                                            update({ worldId: world.id });
                                            setExpanded(null);
                                        }}
                                    />
                                ))}
                                </div>
                            )}

                            <button type="button" className="menu-item w-full text-left" onClick={reset}>
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--c-input)] text-[var(--c-icon)]">
                                    <RotateCcw size={17} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="menu-label block">恢复全部</span>
                                    <span className="menu-desc block truncate">清除身份和世界观筛选</span>
                                </span>
                            </button>
                        </div>
                    </div>
                </BottomSheet>
            )}
        </>
    );
}

function ScopeMenuRow({
    icon,
    label,
    value,
    expanded,
    onClick,
}: {
    icon: ReactNode;
    label: string;
    value: string;
    expanded: boolean;
    onClick: () => void;
}) {
    return (
        <button type="button" className="menu-item w-full text-left" onClick={onClick} aria-expanded={expanded}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--c-input)] text-[var(--c-icon)]">
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="menu-label block">{label}</span>
                <span className="menu-desc block truncate">当前：{value}</span>
            </span>
            <ChevronRight
                size={18}
                className={`shrink-0 text-[var(--c-icon)] transition-transform ${expanded ? "rotate-90" : ""}`}
            />
        </button>
    );
}

function ScopeOption({
    label,
    description,
    image,
    selected,
    onClick,
    onEdit,
}: {
    label: string;
    description: string;
    image?: string;
    selected: boolean;
    onClick: () => void;
    onEdit?: () => void;
}) {
    return (
        <div className="menu-item w-full flex items-center pr-1">
            <button type="button" className="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer text-inherit" onClick={onClick}>
                {image ? (
                    <img src={image} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--c-input)] text-[var(--c-icon)]">
                        {label.includes("世界") ? <Globe2 size={17} /> : <UserRound size={17} />}
                    </span>
                )}
                <span className="min-w-0 flex-1">
                    <span className="menu-label block truncate">{label}</span>
                    <span className="menu-desc block truncate">{description}</span>
                </span>
                {selected && <Check size={18} className="shrink-0 text-[var(--c-success)] ml-1" />}
            </button>
            {onEdit && (
                <button
                    type="button"
                    className="p-2 ml-1 text-[var(--c-icon)] hover:text-[var(--c-text)] shrink-0 bg-transparent border-0 cursor-pointer rounded-full"
                    title="编辑人设设定"
                    aria-label="编辑人设设定"
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                    }}
                >
                    <Pencil size={15} />
                </button>
            )}
        </div>
    );
}

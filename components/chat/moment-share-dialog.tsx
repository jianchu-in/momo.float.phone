"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { loadChatScope } from "@/lib/chat-scope-storage";
import { loadMomentShareContacts, shareMomentToPrivateChat } from "@/lib/moment-chat-share";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";

export function MomentShareDialog({ postId, onClose, onShared }: {
    postId: string;
    onClose: () => void;
    onShared: (name: string) => void;
}) {
    const titleId = useId();
    const [scope] = useState(loadChatScope);
    const contacts = useMemo(() => loadMomentShareContacts(scope), [scope]);
    const [query, setQuery] = useState("");
    const [recipientId, setRecipientId] = useState("");
    const [error, setError] = useState("");
    const keyword = query.trim().toLowerCase();
    const visible = contacts.filter(contact => [contact.name, contact.originalName]
        .some(name => name.toLowerCase().includes(keyword)));
    const selected = contacts.find(contact => contact.id === recipientId);

    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [onClose]);

    function send() {
        if (!selected) return;
        try {
            const name = shareMomentToPrivateChat(postId, selected.id, scope);
            onShared(name);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "分享失败，请重试");
        }
    }

    return (
        <div className="modal-overlay" data-ui="modal" onClick={onClose}>
            <div className="modal-dialog moment-share-dialog" data-ui="modal-dialog" role="dialog" aria-modal="true"
                aria-labelledby={titleId} onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title" id={titleId}>分享到私聊</h3>
                </div>
                <div className="modal-body">
                    {contacts.length > 0 && <input type="search" className="moment-share-search"
                        aria-label="搜索联系人" placeholder="搜索联系人" value={query}
                        onChange={event => setQuery(event.target.value)} />}
                    <div className="chat-contact-list">
                        {visible.map(contact => (
                            <button type="button" key={contact.id} className="chat-contact-item"
                                aria-pressed={recipientId === contact.id} onClick={() => {
                                    setRecipientId(contact.id);
                                    setError("");
                                }}>
                                <span className="chat-contact-avatar">
                                    {contact.avatar ? <img src={contact.avatar} alt="" /> : <ChatFallbackAvatar />}
                                </span>
                                <span className="chat-contact-name">{contact.name}</span>
                            </button>
                        ))}
                    </div>
                    {visible.length === 0 && <p>{contacts.length ? "没有匹配的联系人" : "当前账号暂无联系人"}</p>}
                    {selected && <p>发送给 {selected.name}</p>}
                    {error && <p role="alert">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="ui-btn ui-btn-ghost" onClick={onClose}>取消</button>
                    <button type="button" className="ui-btn ui-btn-primary" disabled={!selected} onClick={send}>发送</button>
                </div>
            </div>
        </div>
    );
}

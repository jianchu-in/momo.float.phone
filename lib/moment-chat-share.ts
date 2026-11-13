import { findChatAltAccount } from "./chat-alt-account-storage";
import { formatMomentShareForPrompt, type MomentShareSnapshot } from "./chat-share";
import { characterMatchesChatScope, loadChatScope, resolveChatAccountUserIdentity, type ChatScopeState } from "./chat-scope-storage";
import { createOrGetSession, loadChatContacts, loadChatSessions, pushChatMessage, resolveChatCharacterAvatar } from "./chat-storage";
import { loadCharacters } from "./character-storage";
import { loadMomentPosts } from "./moments-storage";
import { loadUserIdentities } from "./settings-storage";

export function loadMomentShareContacts(scope: ChatScopeState) {
    const alt = scope.chatAccountId ? findChatAltAccount(scope.chatAccountId) : null;
    if (scope.chatAccountId && (!alt || alt.deletedAt)) return [];

    const contacts = new Map(loadChatContacts().map(contact => [contact.characterId, contact]));
    const ids = alt ? new Set(alt.friendCharacterIds) : new Set(contacts.keys());
    const sessions = new Map(loadChatSessions()
        .filter(session => !session.isGroup && (session.chatAccountId || null) === scope.chatAccountId)
        .map(session => [session.contactId, session]));
    return loadCharacters()
        .filter(character => ids.has(character.id) && characterMatchesChatScope(character.id, scope))
        .map(character => ({
            id: character.id,
            name: sessions.get(character.id)?.alias || (!alt && contacts.get(character.id)?.nickname) || character.name,
            originalName: character.name,
            avatar: resolveChatCharacterAvatar(character),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function shareMomentToPrivateChat(postId: string, recipientId: string, scope: ChatScopeState) {
    const current = loadChatScope();
    if (current.chatAccountId !== scope.chatAccountId || current.userIdentityId !== scope.userIdentityId || current.worldId !== scope.worldId) {
        throw new Error("聊天身份已切换，请重新选择联系人");
    }
    const recipient = loadMomentShareContacts(current).find(contact => contact.id === recipientId);
    if (!recipient) throw new Error("此联系人已不可用，请重新选择");
    const post = loadMomentPosts().find(item => item.id === postId);
    if (!post) throw new Error("这条朋友圈已删除");

    const authorName = post.authorType === "character"
        ? loadCharacters().find(character => character.id === post.authorId)?.name || "角色"
        : (post.chatAccountId ? undefined : loadUserIdentities().find(identity => identity.id === post.userIdentityId)?.name)
            || resolveChatAccountUserIdentity(post.chatAccountId)?.name || "用户";
    const snapshot: MomentShareSnapshot = {
        authorName,
        body: post.content,
        createdAt: post.createdAt,
        location: post.location,
        photoDescription: post.photoDescription,
    };
    const session = createOrGetSession(recipient.id, current.chatAccountId);
    if (session.isGroup) throw new Error("请选择一个私聊联系人");
    pushChatMessage({
        sessionId: session.id,
        role: "user",
        content: formatMomentShareForPrompt(snapshot, Boolean(post.photoUrl)),
        mediaType: "moment_share",
        mediaUrl: post.photoUrl,
        mediaData: { momentShare: snapshot },
    });
    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
    return recipient.name;
}

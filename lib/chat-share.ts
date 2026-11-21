export type MusicChatSharePayload = {
    type: "music";
    title: string;
    artist: string;
};

export type XiaohongshuNoteChatSharePayload = {
    type: "xiaohongshu_note";
    authorName: string;
    title: string;
    body: string;
    description?: string;
    noteType: "post" | "video";
    tags?: string[];
    imageAssetId?: string;
    coverIcon?: string;
    tone?: string;
};

export type ChatSharePayload = MusicChatSharePayload | XiaohongshuNoteChatSharePayload;

export type MomentShareSnapshot = {
    authorName: string;
    body: string;
    createdAt: string;
    location?: string;
    photoDescription?: string;
};

export function formatMomentShareForPrompt(post: MomentShareSnapshot, hasPhoto: boolean): string {
    return [
        `分享了${post.authorName}的朋友圈`,
        post.body ? `正文：${post.body}` : "",
        post.location ? `地点：${post.location}` : "",
        post.photoDescription ? `配图描述：${post.photoDescription}` : hasPhoto ? "附有一张图片" : "",
    ].filter(Boolean).join("\n");
}

function compactShareText(value: string | undefined, fallback: string): string {
    const text = (value || "").replace(/\s+/g, " ").trim();
    return text || fallback;
}

export function formatXiaohongshuShareForPrompt(input: {
    author?: string;
    title?: string;
    body?: string;
    description?: string;
}): string {
    const author = compactShareText(input.author, "未知作者");
    const title = compactShareText(input.title, "无标题");
    const body = compactShareText(input.body, "无正文内容");
    const description = compactShareText(input.description, "");
    return `分享了一条小红书帖子，作者：${author}, 标题：${title}, 正文内容：${body}，图片/视频描述：${description || "无"}`;
}

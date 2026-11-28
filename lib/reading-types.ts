// lib/reading-types.ts — Type definitions for the Reading (阅读) feature.

export type Book = {
    id: string;
    title: string;
    author?: string;
    coverUrl?: string;
    status?: "reading" | "finished" | "unread";
    format: "txt" | "epub" | "pdf";
    totalChapters: number;
    createdAt: string;
};

export type BookChapter = {
    id: string;
    bookId: string;
    index: number;
    title: string;
    paragraphs: string[];
    /** PDF only: synthetic page chunk start (1-based) */
    pageStart?: number;
    /** PDF only: synthetic page chunk end (1-based) */
    pageEnd?: number;
    /** PDF only: page number (1-based) for each paragraph */
    paragraphPages?: number[];
    /** PDF only: vertical position (0-1 ratio) within page for each paragraph */
    paragraphYPositions?: number[];
};

export type ReadingProgress = {
    bookId: string;
    chapterIndex: number;
    scrollPosition: number;
    companionCharacterId?: string;
    progressFraction?: number;
    progressCurrent?: number;
    progressTotal?: number;
    progressScope?: "book" | "chapter";
    /** 保存进度时的阅读模式；滚动模式下 scrollPosition 存的是章节内滚动比例(0-1) */
    readingMode?: "page" | "scroll";
    lastReadAt: string;
};

export type AnnotationComment = {
    id: string;
    author: string;
    isAi: boolean;
    characterId?: string;
    text: string;
    createdAt: string;
};

export type ReadingAnnotation = {
    id: string;
    bookId: string;
    chapterIndex: number;
    paragraphIndex: number;
    startOff?: number;
    endOff?: number;
    color?: string;
    style?: "highlight" | "underline" | "wavy" | "strike";
    createdBy?: "human" | "ai";
    chapterTitle?: string;
    quote?: string;
    characterId: string;
    characterName: string;
    content: string;
    comments?: AnnotationComment[];
    createdAt: string;
};

"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, Palette, Settings, Search, LayoutGrid, Layers, BarChart2, Plus } from "lucide-react";
import { READING_THEMES, type ReadingThemeId } from "@/lib/reading-appearance";
import { loadBooks, addBook, deleteBook, saveChapters, loadChapters, loadProgress, saveRawFile, updateBook, loadAllBookAnnotations, loadAllAnnotations, saveAnnotation } from "@/lib/reading-storage";
import type { ReadingAnnotation } from "@/lib/reading-types";
import { decodeTxtArrayBuffer, parseTxtContent, parseEpubFile, PDF_PAGES_PER_CHAPTER } from "@/lib/reading-parser";
import { loadReadingInteractionConfig, saveAnnotations } from "@/lib/reading-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { generateAnnotations, generateAnnotationBatch, type AnnotationTarget } from "@/lib/reading-engine";
import { ContentDialog } from "@/components/ui/modal";
import type { Book, BookChapter } from "@/lib/reading-types";
import type { ReadingAppearance } from "@/lib/reading-appearance";
import { ReadingAppearanceDialog } from "./reading-appearance-dialog";
import { ReadingInteractionDialog } from "./reading-interaction-dialog";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";

type Props = {
    onOpenBook: (book: Book) => void;
    onClose: () => void;
    appearance: ReadingAppearance;
    backgroundUrl: string | null;
    onSaveAppearance: (
        appearance: ReadingAppearance,
        options: { backgroundFile: File | null; clearBackground: boolean; customFontFile: File | null; clearCustomFont: boolean }
    ) => Promise<void>;
};

const IMPORT_DIAG_KEY = "reading-import-diagnostic-v1";

type ImportDiagnostic = {
    status: "running" | "failed";
    stage: string;
    fileName: string;
    fileSize: number;
    format?: Book["format"];
    detail?: string;
    updatedAt: string;
};

function buildImportError(stage: string, err: unknown, format?: Book["format"]): { summary: string; detail?: string } {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const lower = detail.toLowerCase();

    if (lower.includes("notfounderror") || lower.includes("object store")) {
        return {
            summary: `导入失败，阶段：${stage}。本地阅读数据库结构异常，刷新页面后重试即可自动修复。`,
            detail,
        };
    }

    if (lower.includes("quotaexceeded")) {
        return {
            summary: `导入失败，阶段：${stage}。当前浏览器可用存储空间不足，原始文件没能保存成功。`,
            detail,
        };
    }

    if (lower.includes("database") || lower.includes("indexeddb") || lower.includes("idbdatabase")) {
        return {
            summary: `导入失败，阶段：${stage}。浏览器本地数据库写入失败。`,
            detail,
        };
    }

    if (lower.includes("out of memory") || lower.includes("memory") || lower.includes("allocation") || lower.includes("unable to allocate")) {
        return {
            summary: `导入失败，阶段：${stage}。当前手机内存不足，这份${format === "pdf" ? " PDF " : ""}文件对浏览器来说太大了。`,
            detail,
        };
    }

    if (lower.includes("abort") || lower.includes("interrupted")) {
        return {
            summary: `导入失败，阶段：${stage}。浏览器中断了这次文件处理，手机上常见于切后台、内存紧张或系统回收。`,
            detail,
        };
    }

    if (lower.includes("failed to load pdf.js") || lower.includes("pdf")) {
        return {
            summary: `导入失败，阶段：${stage}。PDF 引擎没能完成这份文件的读取。`,
            detail,
        };
    }

    return {
        summary: `导入失败，阶段：${stage}。`,
        detail,
    };
}

export function ReadingShelf({ onOpenBook, onClose, appearance, backgroundUrl, onSaveAppearance }: Props) {
    const [books, setBooks] = useState<Book[]>([]);
    const [progressMap, setProgressMap] = useState<Record<string, {
        chapterIndex: number;
        total: number;
        hasProgress: boolean;
        fraction?: number;
        current?: number;
        pageTotal?: number;
        scope?: "book" | "chapter";
    }>>({});
    const [importing, setImporting] = useState(false);
    const [importStatus, setImportStatus] = useState<string | null>(null);
    const [importError, setImportError] = useState<{ summary: string; detail?: string } | null>(null);
    const [search, setSearch] = useState("");
    const [showAppearanceDialog, setShowAppearanceDialog] = useState(false);
    const [showInteractionDialog, setShowInteractionDialog] = useState(false);
    const [detailBook, setDetailBook] = useState<Book | null>(null);
    const [showStatsView, setShowStatsView] = useState(false);
    const [detailTab, setDetailTab] = useState<"bookmarks" | "annotations">("annotations");
    const [annoSearch, setAnnoSearch] = useState("");
    const [detailAnnos, setDetailAnnos] = useState<ReadingAnnotation[]>([]);
    const [allAnnos, setAllAnnos] = useState<ReadingAnnotation[]>([]);
    const [viewMode, setViewMode] = useState<"carousel" | "grid">("carousel");
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [gridFilter, setGridFilter] = useState<"all" | "reading" | "unread" | "finished">("all");
    const [activeThemeId, setActiveThemeId] = useState<ReadingThemeId>(appearance.themeId || "paper");
    useEffect(() => {
        if (appearance.themeId) {
            setActiveThemeId(appearance.themeId);
        }
    }, [appearance.themeId]);
    const activeThemeObj = READING_THEMES.find(t => t.id === activeThemeId) || READING_THEMES[0];
    const [showThemeDrawer, setShowThemeDrawer] = useState(false);
    const [showSearchBar, setShowSearchBar] = useState(false);
    const [showDelegateModal, setShowDelegateModal] = useState(false);
    const [delegateCharId, setDelegateCharId] = useState<string>("");
    const [delegateBatchSize, setDelegateBatchSize] = useState<number>(20);
    const [delegateMaxCalls, setDelegateMaxCalls] = useState<number>(1);
    const [delegating, setDelegating] = useState(false);
    const [delegateError, setDelegateError] = useState<string | null>(null);
    const [availableCharacters, setAvailableCharacters] = useState<Character[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (detailBook) {
            void loadAllBookAnnotations(detailBook.id).then(setDetailAnnos);
        }
    }, [detailBook]);

    useEffect(() => {
        if (showStatsView) {
            void loadAllAnnotations().then(setAllAnnos);
        }
    }, [showStatsView]);

    const persistImportDiagnostic = (payload: ImportDiagnostic | null) => {
        if (typeof window === "undefined") return;
        if (!payload) {
            kvRemove(IMPORT_DIAG_KEY);
            return;
        }
        kvSet(IMPORT_DIAG_KEY, JSON.stringify(payload));
    };

    useEffect(() => {
        const allBooks = loadBooks();
        setBooks(allBooks);
        (async () => {
            const map: typeof progressMap = {};
            for (const b of allBooks) {
                const p = await loadProgress(b.id);
                map[b.id] = {
                    chapterIndex: p?.chapterIndex ?? 0,
                    total: b.totalChapters,
                    hasProgress: !!p,
                    fraction: p?.progressFraction,
                    current: p?.progressCurrent,
                    pageTotal: p?.progressTotal,
                    scope: p?.progressScope,
                };
            }
            setProgressMap(map);
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = kvGet(IMPORT_DIAG_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw) as ImportDiagnostic;
            if (!saved?.stage || !saved?.updatedAt) return;

            const timeLabel = new Date(saved.updatedAt).toLocaleString();
            const sizeLabel = saved.fileSize > 0 ? `，文件大小约 ${(saved.fileSize / 1024 / 1024).toFixed(1)} MB` : "";
            const summary = saved.status === "running"
                ? `上次导入在「${saved.stage}」阶段中断了。文件：${saved.fileName}${sizeLabel}。时间：${timeLabel}。`
                : `上次导入在「${saved.stage}」阶段失败。文件：${saved.fileName}${sizeLabel}。时间：${timeLabel}。`;
            setImportError({ summary, detail: saved.detail });
        } catch {
            // Ignore broken diagnostics.
        }
    }, []);

    // Dismiss must also clear the persisted diagnostic — it's reloaded on every
    // mount, which is what made the old inline banner impossible to get rid of.
    const dismissImportError = () => {
        setImportError(null);
        persistImportDiagnostic(null);
    };

    const filteredBooks = search.trim()
        ? books.filter(b => b.title.toLowerCase().includes(search.toLowerCase()) || b.author?.toLowerCase().includes(search.toLowerCase()))
        : books;

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";
        setImporting(true);
        setImportError(null);
        setImportStatus("正在准备导入…");
        let importStage = "准备导入";
        const ext = file.name.split(".").pop()?.toLowerCase();
        const detectedFormat = ext === "pdf" ? "pdf" : ext === "epub" ? "epub" : "txt";
        persistImportDiagnostic({
            status: "running",
            stage: importStage,
            fileName: file.name,
            fileSize: file.size,
            format: detectedFormat,
            updatedAt: new Date().toISOString(),
        });

        try {
            let parsed;
            let format: Book["format"];
            let rawFile: Blob | null = null;

            if (ext === "txt") {
                importStage = "读取 TXT 文件";
                setImportStatus("正在读取 TXT 文件…");
                persistImportDiagnostic({
                    status: "running",
                    stage: importStage,
                    fileName: file.name,
                    fileSize: file.size,
                    format: "txt",
                    updatedAt: new Date().toISOString(),
                });
                const readingConfig = loadReadingInteractionConfig();
                const { text } = decodeTxtArrayBuffer(await file.arrayBuffer(), readingConfig.txtEncoding);
                parsed = parseTxtContent(text, file.name, readingConfig.paragraphMode);
                format = "txt";
            } else if (ext === "epub") {
                importStage = "读取 EPUB 文件";
                setImportStatus("正在读取 EPUB 文件…");
                persistImportDiagnostic({
                    status: "running",
                    stage: importStage,
                    fileName: file.name,
                    fileSize: file.size,
                    format: "epub",
                    updatedAt: new Date().toISOString(),
                });
                const buffer = await file.arrayBuffer();
                importStage = "解析 EPUB 内容";
                setImportStatus("正在解析 EPUB 内容…");
                persistImportDiagnostic({
                    status: "running",
                    stage: importStage,
                    fileName: file.name,
                    fileSize: file.size,
                    format: "epub",
                    updatedAt: new Date().toISOString(),
                });
                parsed = await parseEpubFile(buffer, file.name);
                format = "epub";
            } else if (ext === "pdf") {
                rawFile = file;
                importStage = "创建 PDF 导入记录";
                setImportStatus("正在创建 PDF 导入记录…");
                persistImportDiagnostic({
                    status: "running",
                    stage: importStage,
                    fileName: file.name,
                    fileSize: file.size,
                    format: "pdf",
                    updatedAt: new Date().toISOString(),
                });
                parsed = {
                    title: file.name.replace(/\.[^.]+$/, "") || "未命名",
                    chapters: [{ title: `第1-${PDF_PAGES_PER_CHAPTER}页`, paragraphs: [] }],
                    totalPages: 0,
                };
                format = "pdf";
            } else {
                alert("不支持的格式，请上传 TXT、EPUB 或 PDF 文件");
                persistImportDiagnostic(null);
                return;
            }

            const bookId = `book_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const book: Book = {
                id: bookId,
                title: parsed.title,
                author: parsed.author,
                format,
                totalChapters: parsed.chapters.length,
                createdAt: new Date().toISOString(),
            };

            const chapters: BookChapter[] = parsed.chapters.map((ch, i) => {
                if (format === "pdf") {
                    const pageStart = i * PDF_PAGES_PER_CHAPTER + 1;
                    const totalPages = "totalPages" in parsed ? (parsed as { totalPages: number }).totalPages : pageStart + PDF_PAGES_PER_CHAPTER - 1;
                    const pageEnd = Math.min(pageStart + PDF_PAGES_PER_CHAPTER - 1, totalPages);
                    return {
                        id: `${bookId}_ch${i}`,
                        bookId,
                        index: i,
                        title: ch.title,
                        paragraphs: [],
                        pageStart,
                        pageEnd,
                    };
                }
                return { id: `${bookId}_ch${i}`, bookId, index: i, title: ch.title, paragraphs: ch.paragraphs };
            });

            importStage = "写入书架数据";
            setImportStatus("正在写入书架数据…");
            persistImportDiagnostic({
                status: "running",
                stage: importStage,
                fileName: file.name,
                fileSize: file.size,
                format,
                updatedAt: new Date().toISOString(),
            });
            await addBook(book);
            await saveChapters(bookId, chapters);
            if (rawFile) {
                try {
                    importStage = format === "pdf" ? "保存原始 PDF 文件" : "保存原始文件";
                    setImportStatus(format === "pdf" ? "正在保存原始 PDF 文件…" : "正在保存原始文件…");
                    persistImportDiagnostic({
                        status: "running",
                        stage: importStage,
                        fileName: file.name,
                        fileSize: file.size,
                        format,
                        updatedAt: new Date().toISOString(),
                    });
                    await saveRawFile(bookId, rawFile);
                } catch (saveErr) {
                    await deleteBook(bookId).catch(() => {});
                    const built = buildImportError(importStage, saveErr, format);
                    setImportError(built);
                    persistImportDiagnostic({
                        status: "failed",
                        stage: importStage,
                        fileName: file.name,
                        fileSize: file.size,
                        format,
                        detail: built.detail || built.summary,
                        updatedAt: new Date().toISOString(),
                    });
                    return;
                }
            }
            setBooks(loadBooks());
            setProgressMap(prev => ({ ...prev, [bookId]: { chapterIndex: 0, total: chapters.length, hasProgress: false } }));
            setImportStatus(null);
            persistImportDiagnostic(null);
        } catch (err) {
            console.error("[Reading] Import failed:", err);
            const format = detectedFormat;
            const built = buildImportError(importStage, err, format);
            setImportError(built);
            persistImportDiagnostic({
                status: "failed",
                stage: importStage,
                fileName: file.name,
                fileSize: file.size,
                format,
                detail: built.detail || built.summary,
                updatedAt: new Date().toISOString(),
            });
        } finally {
            setImporting(false);
            setImportStatus(null);
        }
    };

    const handleDelete = async (bookId: string) => {
        if (!confirm("确定删除这本书吗？")) return;
        await deleteBook(bookId);
        setBooks(loadBooks());
        if (detailBook?.id === bookId) setDetailBook(null);
    };

    const handleUpdateBookTitle = async () => {
        if (!detailBook) return;
        const newTitle = prompt("修改书名：", detailBook.title);
        if (newTitle && newTitle.trim()) {
            const updated = { ...detailBook, title: newTitle.trim() };
            await updateBook(updated);
            setDetailBook(updated);
            setBooks(loadBooks());
        }
    };

    const handleUpdateBookAuthor = async () => {
        if (!detailBook) return;
        const newAuthor = prompt("修改作者：", detailBook.author || "");
        if (newAuthor !== null) {
            const updated = { ...detailBook, author: newAuthor.trim() };
            await updateBook(updated);
            setDetailBook(updated);
            setBooks(loadBooks());
        }
    };

    const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !detailBook) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            const coverUrl = evt.target?.result as string;
            const updated = { ...detailBook, coverUrl };
            await updateBook(updated);
            setDetailBook(updated);
            setBooks(loadBooks());
        };
        reader.readAsDataURL(file);
    };

    const handleStatusChange = async (status: "reading" | "finished" | "unread") => {
        if (!detailBook) return;
        const updated = { ...detailBook, status };
        await updateBook(updated);
        setDetailBook(updated);
        setBooks(loadBooks());
    };

    const handleOpenDelegateModal = () => {
        if (!detailBook) return;
        const chars = loadCharacters();
        setAvailableCharacters(chars);
        if (chars.length > 0) {
            setDelegateCharId(chars[0].id);
        }
        setDelegateError(null);
        setShowDelegateModal(true);
    };

    const handleConfirmDelegateReading = async () => {
        if (!detailBook || !delegateCharId) return;
        setDelegating(true);
        setDelegateError(null);
        try {
            const chapters = await loadChapters(detailBook.id);
            if (!chapters || chapters.length === 0) {
                setDelegateError("尚未找到该书的章节数据，请先尝试打开阅读器。");
                return;
            }

            let targetChapter = chapters.find((ch) => ch.paragraphs.length > 0) || chapters[0];
            if (detailBook.format === "pdf" && targetChapter.paragraphs.length === 0) {
                const { loadRawFileBlob } = await import("./reading-storage");
                const blob = await loadRawFileBlob(detailBook.id);
                if (blob) {
                    const { parsePdfPageRange } = await import("./reading-parser");
                    const parsed = await parsePdfPageRange(blob, { startPage: 1, endPage: PDF_PAGES_PER_CHAPTER, fileName: detailBook.title });
                    if (parsed.chunks[0]?.paragraphs?.length) {
                        targetChapter = { ...targetChapter, paragraphs: parsed.chunks[0].paragraphs };
                    }
                }
            }

            if (!targetChapter.paragraphs || targetChapter.paragraphs.length === 0) {
                setDelegateError("未能提取到该章节的阅读文本。");
                return;
            }

            const existingAnnos = await loadAllBookAnnotations(detailBook.id);
            const allTargets: AnnotationTarget[] = targetChapter.paragraphs.map((text, paragraphIndex) => ({
                chapterIndex: targetChapter.index,
                paragraphIndex,
                text,
            }));

            const batchSize = delegateBatchSize === 0 ? allTargets.length : delegateBatchSize;
            const maxCalls = delegateMaxCalls;

            const allNewAnnos: ReadingAnnotation[] = [];
            let currentCall = 0;

            for (let i = 0; i < allTargets.length && currentCall < maxCalls; i += batchSize) {
                const chunkTargets = allTargets.slice(i, i + batchSize);
                currentCall++;
                const chunkAnnos = await generateAnnotationBatch(
                    detailBook,
                    targetChapter.title,
                    chunkTargets,
                    [...existingAnnos, ...allNewAnnos],
                    delegateCharId
                );
                if (chunkAnnos.length > 0) {
                    allNewAnnos.push(...chunkAnnos);
                }
            }

            if (allNewAnnos.length > 0) {
                await saveAnnotations(allNewAnnos);
                const updatedAnnos = await loadAllBookAnnotations(detailBook.id);
                setDetailAnnos(updatedAnnos);
                const charName = availableCharacters.find((c) => c.id === delegateCharId)?.name || "Char";
                const analyzedCount = Math.min(currentCall * batchSize, allTargets.length);
                alert(`委托成功！${charName} 已研读正文（调用 ${currentCall} 次 API，分析了 ${analyzedCount} 段），留下了 ${allNewAnnos.length} 条心得批注。`);
                setShowDelegateModal(false);
            } else {
                setDelegateError("AI 未能返回新的批注内容，请检查 API 或模型设置后重试。");
            }
        } catch (err) {
            console.error("[Reading] Delegate reading failed:", err);
            setDelegateError(`委托阅读失败: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setDelegating(false);
        }
    };

    const formatBadge = (f: string) => f.toUpperCase();

    const coverGradients = ["linen", "mist", "graphite", "sage", "cream", "parchment"] as const;
    const coverLayouts = ["layout-1", "layout-2", "layout-3", "layout-4"] as const;

    if (showStatsView) {
        const totalBooks = books.length;
        const finishedBooks = books.filter(b => b.status === "finished").length;
        const readingBooks = books.filter(b => b.status === "reading" || !b.status).length;
        const unreadBooks = books.filter(b => b.status === "unread").length;
        const totalAnnosCount = allAnnos.length;
        let totalReplies = 0;
        allAnnos.forEach(a => {
            if (a.comments) totalReplies += a.comments.length;
        });

        return (
            <div className="reading-app-surface absolute inset-0 z-[100] flex flex-col bg-[#f7f4ef] text-[#2b2622]">
                <header className="flex items-center justify-between px-4 pt-10 pb-3 border-b border-[#e3d5c5]">
                    <button type="button" onClick={() => setShowStatsView(false)} className="p-2 text-[#2b2622]">
                        <ChevronLeft size={22} strokeWidth={2.5} />
                    </button>
                    <h1 className="text-base font-semibold tracking-wider">共读记录</h1>
                    <div className="w-8" />
                </header>

                <div className="flex-1 overflow-y-auto p-4">
                    <div className="text-center my-6">
                        <div className="text-xs text-[#8c827a]">书房里有</div>
                        <div className="text-3xl font-extrabold my-1">{totalBooks} 本书</div>
                        <div className="text-xs text-[#8c827a]">共同读完 {finishedBooks} 本</div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-white rounded-2xl p-4 text-center border border-[#e3d5c5]/50 shadow-sm">
                            <div className="text-xs text-[#8c827a]">我的累计阅读</div>
                            <div className="text-lg font-bold mt-1">14 小时 30 分</div>
                        </div>
                        <div className="bg-white rounded-2xl p-4 text-center border border-[#e3d5c5]/50 shadow-sm">
                            <div className="text-xs text-[#8c827a]">Char 统一共读</div>
                            <div className="text-lg font-bold mt-1">{totalBooks} 本</div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-4 mb-4 border border-[#e3d5c5]/50 shadow-sm">
                        <div className="text-xs text-[#8c827a] mb-2">书房</div>
                        <div className="h-2 bg-[#ede6dc] rounded-full overflow-hidden flex">
                            <div className="bg-[#9e2a2b] h-full" style={{ width: `${totalBooks ? (readingBooks/totalBooks)*100 : 0}%` }} />
                            <div className="bg-[#3b6064] h-full" style={{ width: `${totalBooks ? (finishedBooks/totalBooks)*100 : 0}%` }} />
                            <div className="bg-[#d0c5b6] h-full" style={{ width: `${totalBooks ? (unreadBooks/totalBooks)*100 : 0}%` }} />
                        </div>
                        <div className="flex justify-between text-xs text-[#8c827a] mt-2">
                            <span>{readingBooks} 在读</span>
                            <span>{finishedBooks} 读完</span>
                            <span>{unreadBooks} 未开始</span>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-4 border border-[#e3d5c5]/50 shadow-sm">
                        <div className="text-xs text-[#8c827a] mb-3">页边</div>
                        
                        <div className="flex items-center justify-between py-2 border-b border-[#f4ece1]">
                            <span className="text-sm">划线</span>
                            <div className="flex-1 mx-4 h-1.5 bg-[#efe9e0] rounded-full overflow-hidden">
                                <div className="h-full bg-[#9e2a2b]" style={{ width: `${Math.min(totalAnnosCount * 10, 100)}%` }} />
                            </div>
                            <span className="text-xs font-semibold">{totalAnnosCount}</span>
                        </div>

                        <div className="flex items-center justify-between py-2 border-b border-[#f4ece1]">
                            <span className="text-sm">批注</span>
                            <div className="flex-1 mx-4 h-1.5 bg-[#efe9e0] rounded-full overflow-hidden">
                                <div className="h-full bg-[#9e2a2b]" style={{ width: `${Math.min(totalAnnosCount * 8, 100)}%` }} />
                            </div>
                            <span className="text-xs font-semibold">{totalAnnosCount}</span>
                        </div>

                        <div className="flex items-center justify-between py-2">
                            <span className="text-sm">共读回复</span>
                            <div className="flex-1 mx-4 h-1.5 bg-[#efe9e0] rounded-full overflow-hidden">
                                <div className="h-full bg-[#9e2a2b]" style={{ width: `${Math.min(totalReplies * 5, 100)}%` }} />
                            </div>
                            <span className="text-xs font-semibold">{totalReplies}</span>
                        </div>
                    </div>

                    <div className="flex justify-center gap-4 mt-8 text-xs text-[#8c827a]">
                        <span className="font-bold text-[#2b2622]">共读记录</span>
                        <span>/</span>
                        <span className="cursor-pointer" onClick={() => setShowStatsView(false)}>整理书架</span>
                    </div>
                </div>
            </div>
        );
    }

    if (detailBook) {
        const realProg = progressMap[detailBook.id];
        const rawPct = realProg?.hasProgress
            ? Math.round((realProg.fraction ?? ((realProg.chapterIndex + 1) / (realProg.total || 1))) * 100)
            : 0;
        const realPct = Math.min(100, Math.max(0, rawPct));
        const autoStatus = realPct === 0 ? "未读" : realPct >= 100 ? "读完" : "在读";

        const bookAnnos = annoSearch.trim()
            ? detailAnnos.filter(a => a.quote?.includes(annoSearch) || a.content?.includes(annoSearch))
            : detailAnnos;

        const activeCharMap = new Map<string, string>();
        detailAnnos.forEach(a => {
            if (a.comments) {
                a.comments.forEach(c => {
                    if (c.isAi && c.characterId) {
                        activeCharMap.set(c.characterId, c.author);
                    }
                });
            } else if (a.characterId) {
                activeCharMap.set(a.characterId, a.characterName);
            }
        });
        const activeChars = Array.from(activeCharMap.entries());

        return (
            <div
                className="reading-app-surface absolute inset-0 z-[100] flex flex-col transition-colors duration-300"
                style={{ backgroundColor: activeThemeObj.bg, color: activeThemeObj.textColor }}
            >
                <header
                    className="flex items-center justify-between px-4 pt-10 pb-3 border-b"
                    style={{ backgroundColor: activeThemeObj.bg, borderColor: activeThemeObj.borderColor }}
                >
                    <button type="button" onClick={() => setDetailBook(null)} className="p-2" style={{ color: activeThemeObj.textColor }}>
                        <ChevronLeft size={22} strokeWidth={2.5} />
                    </button>
                    <h1 className="text-base font-semibold tracking-wider" style={{ color: activeThemeObj.textColor }}>BOOKS</h1>
                    <button type="button" onClick={() => handleDelete(detailBook.id)} className="p-2" style={{ color: activeThemeObj.accentColor }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-4" style={{ backgroundColor: activeThemeObj.bg }}>
                    <div className="rounded-2xl p-4 mb-4 border shadow-sm flex gap-4" style={{ backgroundColor: activeThemeObj.cardBg, borderColor: activeThemeObj.borderColor }}>
                        <label className="relative w-24 h-32 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer shadow-md block" style={{ backgroundColor: activeThemeObj.bg }}>
                            {detailBook.coverUrl ? (
                                <img src={detailBook.coverUrl} className="w-full h-full object-cover" />
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full p-2 text-center text-xs" style={{ color: activeThemeObj.subtextColor }}>
                                    <span className="font-bold text-sm mb-1" style={{ color: activeThemeObj.textColor }}>{detailBook.title}</span>
                                    <span>{detailBook.author}</span>
                                </div>
                            )}
                            <input type="file" accept="image/*" onChange={handleCoverChange} className="hidden" />
                        </label>

                        <div className="flex-1 flex flex-col justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span onClick={handleUpdateBookTitle} className="text-lg font-bold cursor-pointer flex items-center gap-1" style={{ color: activeThemeObj.textColor }}>
                                        {detailBook.title}
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </span>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: activeThemeObj.bg, color: activeThemeObj.accentColor }}>
                                        {autoStatus}
                                    </span>
                                </div>
                                <div onClick={handleUpdateBookAuthor} className="text-xs mt-1 cursor-pointer flex items-center gap-1" style={{ color: activeThemeObj.subtextColor }}>
                                    {detailBook.author || "未知作者"}
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => onOpenBook(detailBook)}
                                className="text-white text-xs font-semibold px-5 py-2 rounded-full self-start mt-2 shadow-sm"
                                style={{ backgroundColor: activeThemeObj.accentColor }}
                            >
                                阅读
                            </button>
                        </div>
                    </div>

                    <div className="rounded-2xl p-4 mb-4 border shadow-sm" style={{ backgroundColor: activeThemeObj.cardBg, borderColor: activeThemeObj.borderColor }}>
                        <div className="text-sm font-semibold mb-3" style={{ color: activeThemeObj.textColor }}>我们的共读记录</div>
                        <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: activeThemeObj.borderColor }}>
                            <div className="flex-1">
                                <div className="text-xs" style={{ color: activeThemeObj.subtextColor }}>上次读到</div>
                                <div className="text-lg font-bold my-0.5" style={{ color: activeThemeObj.textColor }}>{realPct}%</div>
                                <div className="text-[10px]" style={{ color: activeThemeObj.subtextColor }}>
                                    {realProg?.hasProgress ? `已读取至第${realProg.chapterIndex + 1}章` : "尚未开始"}
                                </div>
                            </div>
                            <div className="w-px h-9 mx-4" style={{ backgroundColor: activeThemeObj.borderColor }} />
                            <div className="flex-1">
                                <div className="text-xs" style={{ color: activeThemeObj.subtextColor }}>
                                    {activeChars.length > 0 ? `${activeChars.map(c => c[1]).join("、")} · 共读` : "尚未有 Char 批注"}
                                </div>
                                <div className="text-lg font-bold my-0.5" style={{ color: activeThemeObj.textColor }}>
                                    {activeChars.length > 0 ? "已介入" : "0%"}
                                </div>
                                <div className="text-[10px]" style={{ color: activeThemeObj.subtextColor }}>
                                    {activeChars.length > 0 ? `${activeChars.length} 位 Char 参与` : "尚未开始"}
                                </div>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleOpenDelegateModal}
                        className="w-full py-2.5 mb-4 rounded-xl text-xs font-semibold text-white shadow-sm"
                        style={{ backgroundColor: activeThemeObj.accentColor }}
                    >
                        委托 Char 独立阅读并生成批注
                    </button>

                    <div className="flex p-1 rounded-full mb-3" style={{ backgroundColor: activeThemeObj.cardBg, border: `1px solid ${activeThemeObj.borderColor}` }}>
                        <button
                            type="button"
                            onClick={() => setDetailTab("bookmarks")}
                            className="flex-1 py-1.5 text-xs rounded-full font-medium transition-all"
                            style={{
                                backgroundColor: detailTab === "bookmarks" ? activeThemeObj.bg : "transparent",
                                color: detailTab === "bookmarks" ? activeThemeObj.textColor : activeThemeObj.subtextColor,
                                fontWeight: detailTab === "bookmarks" ? "bold" : "normal"
                            }}
                        >
                            书签
                        </button>
                        <button
                            type="button"
                            onClick={() => setDetailTab("annotations")}
                            className="flex-1 py-1.5 text-xs rounded-full font-medium transition-all"
                            style={{
                                backgroundColor: detailTab === "annotations" ? activeThemeObj.bg : "transparent",
                                color: detailTab === "annotations" ? activeThemeObj.textColor : activeThemeObj.subtextColor,
                                fontWeight: detailTab === "annotations" ? "bold" : "normal"
                            }}
                        >
                            批注
                        </button>
                    </div>

                    <div className="flex items-center rounded-full px-3 py-1.5 gap-2 mb-3 border" style={{ backgroundColor: activeThemeObj.cardBg, borderColor: activeThemeObj.borderColor }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: activeThemeObj.subtextColor }}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                        <input
                            type="text"
                            value={annoSearch}
                            onChange={(e) => setAnnoSearch(e.target.value)}
                            placeholder="搜索批注、引文、回复..."
                            className="bg-transparent border-none outline-none text-xs w-full"
                            style={{ color: activeThemeObj.textColor }}
                        />
                    </div>

                    {detailTab === "bookmarks" ? (
                        <div className="text-center py-8 text-xs" style={{ color: activeThemeObj.subtextColor }}>暂无书签，在阅读正文时可点击添加书签</div>
                    ) : bookAnnos.length === 0 ? (
                        <div className="text-center py-8 text-xs" style={{ color: activeThemeObj.subtextColor }}>暂无批注记录，点击正文即可开始划线</div>
                    ) : (
                        bookAnnos.map((anno) => (
                            <div key={anno.id} className="rounded-xl p-3 mb-3 border shadow-sm" style={{ backgroundColor: activeThemeObj.cardBg, borderColor: activeThemeObj.borderColor }}>
                                <div className="flex justify-between items-center text-[11px] mb-2" style={{ color: activeThemeObj.subtextColor }}>
                                    <span>{anno.chapterTitle || "正文"} · {anno.createdAt}</span>
                                    <span
                                        className="font-medium cursor-pointer"
                                        style={{ color: activeThemeObj.accentColor }}
                                        onClick={() => onOpenBook(detailBook)}
                                    >
                                        看原文 &gt;
                                    </span>
                                </div>
                                <div className="p-2.5 rounded-r-lg text-xs leading-relaxed mb-2 border-l-2" style={{ backgroundColor: activeThemeObj.bg, borderColor: activeThemeObj.accentColor, color: activeThemeObj.textColor }}>
                                    {anno.quote || anno.content}
                                </div>
                                <div className="space-y-1.5">
                                    {anno.comments && anno.comments.length > 0 ? (
                                        anno.comments.map((c, i) => (
                                            <div key={i} className="text-xs">
                                                <span className="font-semibold mr-1" style={{ color: activeThemeObj.accentColor }}>
                                                    {c.author}:
                                                </span>
                                                <span style={{ color: activeThemeObj.textColor }}>{c.text}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-xs">
                                            <span className="font-semibold mr-1" style={{ color: activeThemeObj.accentColor }}>{anno.characterName}:</span>
                                            <span style={{ color: activeThemeObj.textColor }}>{anno.content}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {showDelegateModal && (
                    <ContentDialog
                        title="委托阅读"
                        confirmLabel={delegating ? "研读中..." : "开始委托阅读"}
                        cancelLabel="取消"
                        onConfirm={() => { void handleConfirmDelegateReading(); }}
                        onCancel={() => {
                            if (delegating) return;
                            setShowDelegateModal(false);
                        }}
                    >
                        <div className="space-y-3 py-1">
                            <p className="text-xs text-[#8c827a]">
                                选择一位 AI 角色，委托其独立研读《{detailBook?.title}》并为你撰写感悟批注：
                            </p>
                            {availableCharacters.length === 0 ? (
                                <div className="text-center py-6 text-xs text-[#8c827a]">
                                    暂无可选的 AI 角色，请先在通讯录中添加角色。
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2.5 max-h-[30vh] overflow-y-auto p-0.5">
                                    {availableCharacters.map((char) => {
                                        const isSelected = delegateCharId === char.id;
                                        return (
                                            <button
                                                key={char.id}
                                                type="button"
                                                onClick={() => setDelegateCharId(char.id)}
                                                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                                                    isSelected
                                                        ? "border-[#9e2a2b] bg-[#fbf7f2] shadow-sm"
                                                        : "border-[#e3d5c5]/60 bg-white hover:bg-[#faf7f2]"
                                                }`}
                                            >
                                                <div className="w-9 h-9 rounded-full overflow-hidden bg-[#efe9e0] flex-shrink-0 flex items-center justify-center font-bold text-xs text-[#666]">
                                                    {char.avatar ? (
                                                        <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        char.name[0]
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-semibold text-[#2b2622] truncate">{char.name}</div>
                                                    <div className="text-[10px] text-[#8c827a] truncate">{char.identity || "AI 共读伙伴"}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="border-t border-[#e3d5c5]/40 pt-3 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-[#8c827a]">单次分析段落数：</span>
                                    <select
                                        value={delegateBatchSize}
                                        onChange={(e) => setDelegateBatchSize(Number(e.target.value))}
                                        className="bg-[#f7f4ef] border border-[#e3d5c5] rounded-lg px-2 py-1 text-xs text-[#2b2622] outline-none cursor-pointer"
                                    >
                                        <option value={5}>5 段</option>
                                        <option value={10}>10 段</option>
                                        <option value={20}>20 段</option>
                                        <option value={50}>50 段</option>
                                        <option value={0}>全章 (无限制)</option>
                                    </select>
                                </div>

                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-[#8c827a]">API 最多调用次数：</span>
                                    <select
                                        value={delegateMaxCalls}
                                        onChange={(e) => setDelegateMaxCalls(Number(e.target.value))}
                                        className="bg-[#f7f4ef] border border-[#e3d5c5] rounded-lg px-2 py-1 text-xs text-[#2b2622] outline-none cursor-pointer"
                                    >
                                        <option value={1}>1 次</option>
                                        <option value={2}>2 次</option>
                                        <option value={3}>3 次</option>
                                        <option value={5}>5 次</option>
                                        <option value={10}>10 次</option>
                                    </select>
                                </div>
                            </div>

                            {delegateError && (
                                <div className="text-xs text-[#d9534f] bg-[#fdf2f2] p-2 rounded-lg break-all">
                                    {delegateError}
                                </div>
                            )}
                        </div>
                    </ContentDialog>
                )}
            </div>
        );
    }

    const gridFilteredBooks = filteredBooks.filter(b => {
        if (gridFilter === "all") return true;
        const p = progressMap[b.id];
        const pct = p?.hasProgress ? Math.round((p.fraction ?? ((p.chapterIndex + 1) / (p.total || 1))) * 100) : 0;
        if (gridFilter === "unread") return pct === 0;
        if (gridFilter === "finished") return pct >= 100;
        if (gridFilter === "reading") return pct > 0 && pct < 100;
        return true;
    });

    const activeCarouselBook = filteredBooks.length > 0
        ? filteredBooks[Math.abs(carouselIndex) % filteredBooks.length]
        : null;

    return (
        <div
            className="reading-app-surface absolute inset-0 z-[100] flex flex-col transition-colors duration-300"
            style={{ backgroundColor: activeThemeObj.bg, color: activeThemeObj.textColor }}
        >
            <header className="reading-shelf-header border-b" style={{ backgroundColor: activeThemeObj.bg, borderColor: activeThemeObj.borderColor }}>
                <div className="reading-shelf-appbar">
                    <button className="reading-shelf-back" type="button" onClick={onClose} aria-label="返回" style={{ color: activeThemeObj.textColor }}>
                        <ChevronLeft size={22} strokeWidth={2.5} />
                    </button>
                    {/* 右上角线条图标组 (已移除 3D 轮播模式及切换按钮，拒绝 Emoji) */}
                    <div className="reading-shelf-actions flex items-center gap-1">
                        <button className="reading-shelf-action-btn" type="button" onClick={() => setShowSearchBar(!showSearchBar)} aria-label="搜索" style={{ color: activeThemeObj.textColor, backgroundColor: "transparent" }}>
                            <Search size={18} strokeWidth={1.8} />
                        </button>
                        <button className="reading-shelf-action-btn" type="button" onClick={() => setShowStatsView(true)} aria-label="共读统计" style={{ color: activeThemeObj.textColor, backgroundColor: "transparent" }}>
                            <BarChart2 size={18} strokeWidth={1.8} />
                        </button>
                        <button className="reading-shelf-action-btn" type="button" onClick={() => setShowThemeDrawer(true)} aria-label="色彩美化" style={{ color: activeThemeObj.textColor, backgroundColor: "transparent" }}>
                            <Palette size={18} strokeWidth={1.8} />
                        </button>
                        <button className="reading-shelf-action-btn" type="button" onClick={() => setShowInteractionDialog(true)} aria-label="阅读设置" style={{ color: activeThemeObj.textColor, backgroundColor: "transparent" }}>
                            <Settings size={18} strokeWidth={1.8} />
                        </button>
                        <label className="reading-shelf-action-btn reading-shelf-action-primary cursor-pointer">
                            <Plus size={18} strokeWidth={2} />
                            <input ref={fileRef} type="file" accept=".txt,.epub,.pdf" onChange={handleFileUpload} className="hidden" disabled={importing} />
                        </label>
                    </div>
                </div>
                {/* 标题居左 */}
                <div className="reading-shelf-title-stack text-left flex flex-col items-start justify-start px-4 pb-2">
                    <h1 className="reading-shelf-title text-left font-bold text-2xl" style={{ color: activeThemeObj.textColor, textAlign: "left" }}>书房</h1>
                    <span className="reading-shelf-subtitle text-left text-xs" style={{ color: activeThemeObj.subtextColor, textAlign: "left" }}>{books.length} BOOKS IN YOUR LIBRARY</span>
                </div>
            </header>

            <div className="reading-shelf-body flex-1 overflow-y-auto p-4" style={{ backgroundColor: activeThemeObj.bg, color: activeThemeObj.textColor }}>
                {showSearchBar && (
                    <div className="mb-4">
                        <div className="reading-search-bar flex items-center px-3 py-1.5 rounded-full" style={{ backgroundColor: activeThemeObj.cardBg, borderColor: activeThemeObj.borderColor }}>
                            <Search size={14} style={{ color: activeThemeObj.subtextColor }} />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder={`搜索 ${books.length} 本书`}
                                className="reading-search-input bg-transparent border-none outline-none text-xs ml-2 w-full"
                                style={{ color: activeThemeObj.textColor }}
                            />
                        </div>
                    </div>
                )}

                {filteredBooks.length === 0 ? (
                    <div className="py-12 text-center text-xs" style={{ color: activeThemeObj.subtextColor }}>
                        {books.length === 0 ? "还没导入书籍，点击右上角 + 开始阅读" : "没有匹配的书籍"}
                    </div>
                ) : (
                    /* 精致网格模式 (复刻图 2) - 全量响应主题背景 */
                    <div style={{ backgroundColor: activeThemeObj.bg }}>
                        {/* 顶部分组分类 */}
                        <div className="flex items-center gap-2 mb-4 text-xs">
                            {(["all", "reading", "unread", "finished"] as const).map(f => (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => setGridFilter(f)}
                                    className={`px-3 py-1.5 rounded-full font-medium border transition-all ${gridFilter === f ? "font-bold shadow-sm" : "opacity-70"}`}
                                    style={{
                                        backgroundColor: gridFilter === f ? activeThemeObj.accentColor : activeThemeObj.cardBg,
                                        color: gridFilter === f ? "#ffffff" : activeThemeObj.textColor,
                                        borderColor: activeThemeObj.borderColor
                                    }}
                                >
                                    {f === "all" ? "全部" : f === "reading" ? "在读" : f === "unread" ? "未读" : "已读"}
                                </button>
                            ))}
                        </div>

                        {/* 3 列矩阵 */}
                        <div className="grid grid-cols-3 gap-3">
                            {gridFilteredBooks.map(book => {
                                const prog = progressMap[book.id];
                                const pct = prog?.hasProgress ? Math.round((prog.fraction || 0) * 100) : 0;
                                return (
                                    <div
                                        key={book.id}
                                        onClick={() => setDetailBook(book)}
                                        className="flex flex-col cursor-pointer group"
                                    >
                                        <div className="aspect-[3/4] rounded-xl overflow-hidden border shadow-sm mb-1.5 relative" style={{ backgroundColor: activeThemeObj.cardBg, borderColor: activeThemeObj.borderColor }}>
                                            {book.coverUrl ? (
                                                <img src={book.coverUrl} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="p-2 flex flex-col justify-between h-full text-center">
                                                    <span className="font-bold text-xs mt-1" style={{ color: activeThemeObj.textColor }}>{book.title}</span>
                                                    <span className="text-[10px]" style={{ color: activeThemeObj.subtextColor }}>{book.author}</span>
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-xs font-semibold truncate" style={{ color: activeThemeObj.textColor }}>{book.title}</span>
                                        <span className="text-[10px] truncate" style={{ color: activeThemeObj.subtextColor }}>{book.author || "未知作者"}</span>
                                        <span className="text-[10px] mt-0.5" style={{ color: activeThemeObj.subtextColor }}>{pct > 0 ? `${pct}%` : "未开始"}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* 6 色美化抽屉（剧情组件同款 6 主题色，绝无 Emoji） */}
            {showThemeDrawer && (
                <div className="fixed inset-0 z-[200] bg-black/40 flex flex-col justify-end" onClick={() => setShowThemeDrawer(false)}>
                    <div className="bg-white rounded-t-3xl p-5 max-h-[60vh] flex flex-col shadow-2xl text-[#2b2622]" onClick={(e) => e.stopPropagation()}>
                        <div className="w-9 h-1 bg-[#e3d5c5] rounded-full self-center mb-4" />
                        <div className="text-sm font-semibold mb-3">切换色彩主题</div>
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            {READING_THEMES.map((theme) => (
                                <button
                                    key={theme.id}
                                    type="button"
                                    onClick={() => {
                                        setActiveThemeId(theme.id);
                                        void onSaveAppearance({ ...appearance, themeId: theme.id }, { backgroundFile: null, clearBackground: false, customFontFile: null, clearCustomFont: false });
                                        if (typeof window !== "undefined") {
                                            window.dispatchEvent(new Event("reading-appearance-changed"));
                                        }
                                    }}
                                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${activeThemeId === theme.id ? "border-[#9e2a2b] shadow-sm font-semibold" : "border-[#e3d5c5]/60"}`}
                                    style={{ backgroundColor: theme.bg }}
                                >
                                    <div className="w-6 h-6 rounded-full border border-black/10" style={{ backgroundColor: theme.cardBg }} />
                                    <span className="text-xs" style={{ color: theme.textColor }}>{theme.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {showAppearanceDialog && (
                <ReadingAppearanceDialog
                    appearance={appearance}
                    backgroundUrl={backgroundUrl}
                    onClose={() => setShowAppearanceDialog(false)}
                    onSave={onSaveAppearance}
                />
            )}

            {showInteractionDialog && (
                <ReadingInteractionDialog onClose={() => setShowInteractionDialog(false)} />
            )}

            {showDelegateModal && (
                <ContentDialog
                    title="委托阅读"
                    confirmLabel={delegating ? "研读中..." : "开始委托阅读"}
                    cancelLabel="取消"
                    onConfirm={() => { void handleConfirmDelegateReading(); }}
                    onCancel={() => {
                        if (delegating) return;
                        setShowDelegateModal(false);
                    }}
                >
                    <div className="space-y-3 py-1">
                        <p className="text-xs text-[#8c827a]">
                            选择一位 AI 角色，委托其独立研读《{detailBook?.title}》并为你撰写感悟批注：
                        </p>
                        {availableCharacters.length === 0 ? (
                            <div className="text-center py-6 text-xs text-[#8c827a]">
                                暂无可选的 AI 角色，请先在通讯录中添加角色。
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2.5 max-h-[30vh] overflow-y-auto p-0.5">
                                {availableCharacters.map((char) => {
                                    const isSelected = delegateCharId === char.id;
                                    return (
                                        <button
                                            key={char.id}
                                            type="button"
                                            onClick={() => setDelegateCharId(char.id)}
                                            className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                                                isSelected
                                                    ? "border-[#9e2a2b] bg-[#fbf7f2] shadow-sm"
                                                    : "border-[#e3d5c5]/60 bg-white hover:bg-[#faf7f2]"
                                            }`}
                                        >
                                            <div className="w-9 h-9 rounded-full overflow-hidden bg-[#efe9e0] flex-shrink-0 flex items-center justify-center font-bold text-xs text-[#666]">
                                                {char.avatar ? (
                                                    <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    char.name[0]
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs font-semibold text-[#2b2622] truncate">{char.name}</div>
                                                <div className="text-[10px] text-[#8c827a] truncate">{char.identity || "AI 共读伙伴"}</div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <div className="border-t border-[#e3d5c5]/40 pt-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-[#8c827a]">单次分析段落数：</span>
                                <select
                                    value={delegateBatchSize}
                                    onChange={(e) => setDelegateBatchSize(Number(e.target.value))}
                                    className="bg-[#f7f4ef] border border-[#e3d5c5] rounded-lg px-2 py-1 text-xs text-[#2b2622] outline-none cursor-pointer"
                                >
                                    <option value={5}>5 段</option>
                                    <option value={10}>10 段</option>
                                    <option value={20}>20 段</option>
                                    <option value={50}>50 段</option>
                                    <option value={0}>全章 (无限制)</option>
                                </select>
                            </div>

                            <div className="flex items-center justify-between text-xs">
                                <span className="text-[#8c827a]">API 最多调用次数：</span>
                                <select
                                    value={delegateMaxCalls}
                                    onChange={(e) => setDelegateMaxCalls(Number(e.target.value))}
                                    className="bg-[#f7f4ef] border border-[#e3d5c5] rounded-lg px-2 py-1 text-xs text-[#2b2622] outline-none cursor-pointer"
                                >
                                    <option value={1}>1 次</option>
                                    <option value={2}>2 次</option>
                                    <option value={3}>3 次</option>
                                    <option value={5}>5 次</option>
                                    <option value={10}>10 次</option>
                                </select>
                            </div>
                        </div>

                        {delegateError && (
                            <div className="text-xs text-[#d9534f] bg-[#fdf2f2] p-2 rounded-lg break-all">
                                {delegateError}
                            </div>
                        )}
                    </div>
                </ContentDialog>
            )}
        </div>
    );
}

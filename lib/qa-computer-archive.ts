// 浏览器端解包（zip / tar / tar.gz / tgz）：供工坊的「电脑解包」工具使用。
//
// 为什么不在这台「电脑」上解压：
// 1. shell 模式（浏览器内嵌 POSIX 工具集）没有 tar/unzip/python/node，也装不了任何东西；
// 2. 它的管道与重定向走 UTF-8 文本通道，二进制字节会被改写（实测 base64 -d > 文件、
//    gzip -c > 文件得到的都是损坏数据），即使有解压工具也解不出正确文件。
// 所以解压放到本端完成：base64 → Uint8Array → 逐条解出；文本成员经 write 通道写回
// 电脑（该通道对 UTF-8 文本实测保真），二进制成员只列清单。
//
// 仅依赖 Web 标准能力：DecompressionStream（deflate-raw / gzip），Chrome 80+ / Safari 16.4+。
// 局限：加密 zip、Deflate64、PAX/GNU 超长文件名的 tar 不支持（会列入 unsupported 清单）。

export type ArchiveEntry = { name: string; data: Uint8Array };

/** 视为“文本”的扩展名白名单：只有这些会写回电脑（文本通道对它们保真） */
const TEXT_LIKE_EXT =
    /\.(txt|md|markdown|json|jsonc|json5|csv|tsv|ya?ml|toml|ini|cfg|conf|env|log|xml|html?|css|scss|less|js|mjs|cjs|ts|tsx|jsx|vue|svelte|py|rb|go|rs|java|kt|kts|c|h|cpp|hpp|cs|php|sh|bash|zsh|fish|bat|cmd|ps1|sql|svg|gitattributes|gitignore|gitmodules|editorconfig|npmrc|nvmrc|babelrc|eslintrc|prettierrc)$/i;

/** 无扩展名的常见文本文件名（Dockerfile、Makefile、LICENSE 等） */
const TEXT_LIKE_BASENAMES = /^(dockerfile|makefile|cmakelists\.txt|license|licence|notice|changelog|readme|requirements\.txt|package\.json|tsconfig\.json)$/i;

export function isTextLikeName(name: string): boolean {
    const base = name.split("/").pop() ?? name;
    return TEXT_LIKE_EXT.test(name) || TEXT_LIKE_BASENAMES.test(base);
}

export function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function decompress(bytes: Uint8Array, format: "deflate-raw" | "gzip"): Promise<Uint8Array> {
    const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
    if (!DS) throw new Error("当前浏览器不支持 DecompressionStream（需较新的 Chrome / Safari）");
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DS(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ── zip ──

type ZipRawItem = { name: string; method: number; flags: number; comp: Uint8Array };

/** 解析 zip：从尾部找 EOCD → 遍历中央目录 → 取各成员的压缩数据段（本步不解压） */
function parseZipRaw(bytes: Uint8Array): ZipRawItem[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const scanFloor = Math.max(0, bytes.length - 22 - 65536); // 注释区最长 64KB
    for (let i = bytes.length - 22; i >= scanFloor; i -= 1) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的 zip（找不到 EOCD 结束目录）");
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const items: ZipRawItem[] = [];
    for (let n = 0; n < count; n += 1) {
        if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error(`zip 中央目录损坏（第 ${n + 1} 项）`);
        const flags = view.getUint16(p + 8, true);
        const method = view.getUint16(p + 10, true);
        const compSize = view.getUint32(p + 20, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const localOffset = view.getUint32(p + 42, true);
        const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        // 目录项（名以 / 结尾）与 zip64（0xFFFFFFFF）不处理——后者超出本工具场景
        if (!name.endsWith("/") && compSize !== 0xffffffff && localOffset !== 0xffffffff) {
            if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`zip 局部头损坏（${name}）`);
            const lNameLen = view.getUint16(localOffset + 26, true);
            const lExtraLen = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + lNameLen + lExtraLen;
            items.push({ name, method, flags, comp: bytes.subarray(dataStart, dataStart + compSize) });
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    return items;
}

export function looksLikeZip(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function looksLikeGzip(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function looksLikeTar(bytes: Uint8Array): boolean {
    // offset 257 起的 magic "ustar"（POSIX 与 GNU tar 都有）
    return bytes.length > 262 && bytes[257] === 0x75 && bytes[258] === 0x73;
}

// ── tar ──

function parseTar(bytes: Uint8Array): ArchiveEntry[] {
    const decoder = new TextDecoder();
    const entries: ArchiveEntry[] = [];
    for (let off = 0; off + 512 <= bytes.length; ) {
        const header = bytes.subarray(off, off + 512);
        let allZero = true;
        for (let i = 0; i < 512; i += 1) {
            if (header[i] !== 0) { allZero = false; break; }
        }
        if (allZero) { off += 512; continue; }
        const readStr = (start: number, len: number) =>
            decoder.decode(header.subarray(start, start + len)).replace(/\0[\s\S]*$/, "");
        const name = readStr(0, 100);
        const prefix = readStr(345, 155);
        const size = parseInt(readStr(124, 12).trim(), 8) || 0;
        const typeflag = header[156];
        const full = prefix ? `${prefix}/${name}` : name;
        const blocks = Math.ceil(size / 512);
        if ((typeflag === 0x30 || typeflag === 0x00) && full) {
            entries.push({ name: full, data: bytes.subarray(off + 512, off + 512 + size) });
        }
        // 目录 / 软链接 / PAX 头（'L' 超长名）等类型跳过
        off += 512 + blocks * 512;
    }
    return entries;
}

// ── 对外总入口 ──

export type ExtractedArchive = {
    entries: ArchiveEntry[];
    /** 无法解出的成员（加密 zip / 特殊压缩方法等），供提示 */
    unsupported: string[];
};

export async function extractArchive(bytes: Uint8Array, sourceName: string): Promise<ExtractedArchive> {
    const unsupported: string[] = [];
    if (looksLikeZip(bytes)) {
        const items = parseZipRaw(bytes);
        const entries: ArchiveEntry[] = [];
        for (const item of items) {
            if (item.flags & 0x1) {
                unsupported.push(`${item.name}（zip 已加密，暂不支持）`);
            } else if (item.method === 0) {
                entries.push({ name: item.name, data: new Uint8Array(item.comp) });
            } else if (item.method === 8) {
                try {
                    entries.push({ name: item.name, data: await decompress(item.comp, "deflate-raw") });
                } catch {
                    unsupported.push(`${item.name}（deflate 解压失败，数据可能损坏）`);
                }
            } else {
                unsupported.push(`${item.name}（zip 压缩方法 ${item.method} 不支持，如 Deflate64/AES）`);
            }
        }
        return { entries, unsupported };
    }
    if (looksLikeGzip(bytes)) {
        const inner = await decompress(bytes, "gzip");
        if (looksLikeTar(inner)) return { entries: parseTar(inner), unsupported };
        // .gz 里不是 tar：当作单个文件解出，名字去掉 .gz 后缀
        const innerName = sourceName.replace(/\.b64$/i, "").replace(/\.(t?gz|gzip)$/i, "") || "解压结果";
        return { entries: [{ name: innerName, data: inner }], unsupported };
    }
    if (looksLikeTar(bytes)) return { entries: parseTar(bytes), unsupported };
    throw new Error("不是支持的压缩包格式（支持 zip / tar / tar.gz / tgz）");
}

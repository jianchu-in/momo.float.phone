// 工坊的「电脑」工具：小坊的云端工作机（用户自部署的 agent-computer Worker）。
// 只在设置里连接了角色电脑、且「小坊使用」开关打开时才注入（getQaTools 里按 isWorkshopComputerEnabled 判断），
// 未配置时这些工具对模型完全不可见。
// 小坊固定使用 workshop 工作区，与各角色的电脑相互隔离。
//
// 暴露给模型的有三个工具（电脑文件 + 电脑执行命令 + 电脑解包），控制提示词体积；
// 早期的四个单操作工具保留为隐藏别名（可执行、不进提示词），旧调用不报错。

import {
    WORKSHOP_WORKSPACE,
    agentComputerRequest,
    isContainerComputer,
} from "./agent-computer";
import { extractArchive, base64ToBytes, isTextLikeName } from "./qa-computer-archive";

// 与 qa-agent-tools 的 QaTool 结构保持一致（避免循环依赖，重复声明最小形状）
type QaComputerTool = {
    name: string;
    nativeName: string;
    description: string;
    schemaLines: string[];
    parameters: Record<string, unknown>;
    run: (args: Record<string, unknown>) => Promise<string>;
};

// ── 文件卡标记：op=send 的结果里携带，工坊 UI 解析后渲染可保存的文件卡 ──
// 标记随工具结果持久化，刷新后卡片仍在；内容按需从工作机拉取，不占存储。

export type QaFileCardInfo = { workspace: string; path: string; name: string };

const QA_FILE_MARKER_RE = /\n?\[\[qa-file:(\{.*?\})\]\]/;

export function parseQaFileMarker(result: string): { text: string; file: QaFileCardInfo | null } {
    const match = result.match(QA_FILE_MARKER_RE);
    if (!match) return { text: result, file: null };
    try {
        const parsed = JSON.parse(match[1]) as QaFileCardInfo;
        if (parsed && typeof parsed.workspace === "string" && typeof parsed.path === "string" && typeof parsed.name === "string") {
            return { text: result.replace(QA_FILE_MARKER_RE, ""), file: parsed };
        }
    } catch { /* 落回原文 */ }
    return { text: result, file: null };
}

function text(value: unknown, max = 4000): string {
    return typeof value === "string" ? value.slice(0, max).trim() : "";
}

// ── 四种文件操作的实现（统一工具与隐藏别名共用）──

async function runList(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path) || "/";
    const data = await agentComputerRequest<{ entries: Array<{ name: string; dir: boolean }> }>(
        "list", WORKSHOP_WORKSPACE, { path });
    if (!data.entries.length) return `${path} 是空目录。`;
    return `${path} 下共 ${data.entries.length} 项：\n` + data.entries
        .map(entry => `  ${entry.dir ? "📁" : "📄"} ${entry.name}`)
        .join("\n");
}

async function runRead(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path);
    if (!path) return "缺少 path。";
    const maxChars = typeof args.maxChars === "number" ? args.maxChars : undefined;
    const data = await agentComputerRequest<{ content: string; truncated: boolean }>(
        "read", WORKSHOP_WORKSPACE, { path, ...(maxChars ? { maxChars } : {}) });
    return `${path} 的内容：\n${data.content}${data.truncated ? "\n…（文件较长已截断，可用 maxChars 调整）" : ""}`;
}

async function runWrite(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path);
    if (!path) return "缺少 path。";
    const content = typeof args.content === "string" ? args.content : "";
    await agentComputerRequest("write", WORKSHOP_WORKSPACE, { path, content });
    return `✓ 已写入 ${path}（${content.length} 字符）。`;
}

async function runDelete(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path);
    if (!path) return "缺少 path。";
    await agentComputerRequest("delete", WORKSHOP_WORKSPACE, { path });
    return `✓ 已删除 ${path}。`;
}

async function runSend(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path);
    if (!path) return "缺少 path。";
    const name = path.split("/").pop() || path;
    // lastIndexOf 无斜杠时返回 -1，slice(0,-1) 会把末位字符切掉——必须先判界
    const slashIndex = path.lastIndexOf("/");
    const parent = slashIndex <= 0 ? "/" : path.slice(0, slashIndex);
    const data = await agentComputerRequest<{ entries: Array<{ name: string; dir: boolean }> }>(
        "list", WORKSHOP_WORKSPACE, { path: parent });
    const hit = data.entries.find(entry => entry.name === name && !entry.dir);
    if (!hit) return `${path} 不存在或不是文件（先用 op=list 确认路径）。`;
    const marker = `\n[[qa-file:${JSON.stringify({ workspace: WORKSHOP_WORKSPACE, path, name })}]]`;
    return `✓ 已把 ${name} 递给用户：对话里出现了文件卡，用户可预览和保存。${marker}`;
}

// ── 暴露给模型的统一工具 ──

const computerFilesTool: QaComputerTool = {
    name: "电脑文件",
    nativeName: "computer_files",
    description:
        "操作工作机（云端电脑）上的文件：op=list 列目录 / read 读文件 / write 写文件（整文件覆盖，父目录自动创建）/ delete 删除（递归，删了找不回）/ send 把文件递给用户（对话中出现可预览保存的文件卡，交付成果用它）。"
        + "硬盘是持久的，适合保存脚本、中间结果、要交付的文件。",
    schemaLines: [
        "  参数：",
        "    · op (必填) — list / read / write / delete / send",
        "    · path — 文件或目录路径（list 缺省为 /）",
        "    · content — 写入的完整内容（op=write 必填）",
        "    · maxChars (可选) — 读取上限（op=read）",
        '  调用：[执行动作:电脑文件({"op":"write","path":"/notes.md","content":"…"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            op: { type: "string", enum: ["list", "read", "write", "delete", "send"], description: "操作类型" },
            path: { type: "string", description: "文件或目录路径" },
            content: { type: "string", description: "写入内容（op=write 必填）" },
            maxChars: { type: "number", description: "读取上限（op=read）" },
        },
        required: ["op"],
    },
    async run(args) {
        switch (text(args.op, 20)) {
            case "list": return runList(args);
            case "read": return runRead(args);
            case "write": return runWrite(args);
            case "delete": return runDelete(args);
            case "send": return runSend(args);
            default: return "op 需为 list / read / write / delete / send 之一。";
        }
    },
};

const computerExecTool: QaComputerTool = {
    name: "电脑执行命令",
    nativeName: "computer_exec",
    // 描述按连接测试探到的模式动态措辞：容器 = 真 Linux；否则 = 内嵌工具集
    get description() {
        if (isContainerComputer()) {
            return "在工作机上执行 shell 命令。工作机是真 Linux 容器：bash 完整、可 npm/pip 装软件、网络全功能（curl 不限方法）、"
                + "硬盘挂载在 /workspace（持久保存）。适合跑脚本、装工具、生成文档等真实任务。";
        }
        return "在工作机上执行 shell 命令。内嵌 POSIX 工具集：ls/cat/grep/sed/awk/find/sort/wc/xargs/head/tail/cut/tr、jq、base64/od、diff/md5sum/sha256sum、gzip/gunzip（仅原位压缩/解压）、curl（只读 GET/HEAD）等，"
            + "支持管道/重定向/循环/函数。重要限制：①没有 tar/unzip/7z/sqlite3/yq，没有 python/node/perl，也装不了任何软件包；"
            + "②管道与重定向按 UTF-8 文本处理，二进制数据（base64 -d 的输出、gzip -c 的输出等）经重定向会被改写损坏——不要用重定向生成或还原二进制文件；"
            + "③单次执行总输出超过约 200KB 会被强制中止（生成大文件请改用「电脑文件」write 分段写）；"
            + "④解压压缩包请改用「电脑解包」工具。"
            + "基础模式的电脑没有 shell（会返回明确提示），此时改用「电脑文件」完成任务。";
    },
    schemaLines: [
        "  参数：",
        "    · command (必填) — 要执行的命令",
        '  调用：[执行动作:电脑执行命令({"command":"ls /"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            command: { type: "string", description: "shell 命令" },
        },
        required: ["command"],
    },
    async run(args) {
        const command = text(args.command);
        if (!command) return "缺少 command。";
        try {
            const data = await agentComputerRequest<{ exitCode: number; stdout: string; stderr: string }>(
                "exec", WORKSHOP_WORKSPACE, { command });
            const parts = [`$ ${command}`, `退出码：${data.exitCode}`];
            if (data.stdout) parts.push(`stdout：\n${data.stdout}`);
            if (data.stderr) parts.push(`stderr：\n${data.stderr}`);
            if (!data.stdout && !data.stderr) parts.push("（无输出）");
            return parts.join("\n");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/shell 不可用|execution backend/i.test(message)) {
                return "这台工作机是基础模式（没有 shell），无法执行命令。请改用「电脑文件」完成任务，需要计算或转换时在对话里自行完成后写回文件。";
            }
            throw err;
        }
    },
};

// ── 电脑解包 ──
// 为什么需要它：shell 模式的工作机没有 tar/unzip，且重定向走 UTF-8 文本通道会把
// 二进制写坏（详见 qa-computer-archive.ts 头部注释）。解包因此在浏览器端完成：
// 把电脑上的压缩包（原始或 .b64）整体读回 → 逐条解出 → 文本成员写回电脑 → 二进制列清单。

const READ_CHUNK = 3_000_000; // 单次 read 的字符数上限（约覆盖 2.2MB 原始二进制）

async function readWholeFile(path: string): Promise<string> {
    const part = await agentComputerRequest<{ content: string; truncated: boolean }>(
        "read", WORKSHOP_WORKSPACE, { path, maxChars: READ_CHUNK });
    if (part.truncated) {
        throw new Error(`${path} 超过单次读取上限（约 2.2MB 原始文件），无法整体取回解包；请让用户上传更小的包`);
    }
    return part.content;
}

const computerUnpackTool: QaComputerTool = {
    name: "电脑解包",
    nativeName: "computer_unpack",
    description:
        "解压电脑上的压缩包（zip / tar / tar.gz / tgz，原始文件或 .b64 形式均可）。工作机的内嵌 shell 没有解压工具且会损坏二进制，"
        + "解包由浏览器完成：文本类成员（代码/文档/配置等）自动写回电脑 destDir 下，二进制成员（图片/字体/数据文件等）只列出名称与大小。"
        + "只想看看压缩包里有什么也用它（不要试图用「电脑执行命令」解压——必失败或产出损坏文件）。",
    schemaLines: [
        "  参数：",
        "    · path (必填) — 压缩包在电脑上的路径",
        "    · destDir (可选) — 解出的文件写到哪个目录（缺省 /unpacked/<压缩包名>）",
        '  调用：[执行动作:电脑解包({"path":"/uploads/pkg.zip"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "压缩包路径（zip/tar/tar.gz/tgz 或其 .b64）" },
            destDir: { type: "string", description: "解出目录（缺省 /unpacked/<包名>）" },
        },
        required: ["path"],
    },
    async run(args) {
        const path = text(args.path, 400);
        if (!path) return "缺少 path。";
        if (!/\.(zip|tar|gz|tgz|gzip)(\.b64)?$/i.test(path)) {
            return `${path} 不是 zip / tar / tar.gz / tgz，无法解包。`;
        }
        // 原始二进制按 latin1 逐码位还原字节（read 通道是文本，但每字符码位=字节值）；
        // .b64 则先拼完再解码。
        const raw = await readWholeFile(path);
        const bytes = path.toLowerCase().endsWith(".b64")
            ? base64ToBytes(raw)
            : Uint8Array.from(raw, ch => ch.charCodeAt(0) & 0xff);
        const { entries, unsupported } = await extractArchive(bytes, path);
        if (!entries.length) {
            return `解包完成：里面没有可解出的文件${unsupported.length ? `；${unsupported.length} 项不支持：${unsupported.join("、")}` : ""}。`;
        }
        const baseName = (path.replace(/\.b64$/i, "").split("/").pop() || "archive")
            .replace(/\.(zip|tar|tgz|t?gz|gzip)$/i, "") || "archive";
        const destRoot = text(args.destDir, 400).replace(/\/+$/, "") || `/unpacked/${baseName}`;
        const textEntries = entries.filter(e => isTextLikeName(e.name));
        const binEntries = entries.filter(e => !isTextLikeName(e.name));
        const decoder = new TextDecoder("utf-8", { fatal: false });
        const lines: string[] = [`解包 ${path}（共 ${entries.length} 个文件）：`];
        let written = 0;
        for (const entry of textEntries) {
            const content = decoder.decode(entry.data);
            if (content.includes("\uFFFD\uFFFD")) continue; // 连续替换符：内容实为二进制，不写回
            const dest = `${destRoot}/${entry.name.replace(/^\/+/, "")}`;
            try {
                await agentComputerRequest("write", WORKSHOP_WORKSPACE, { path: dest, content });
                written += 1;
                lines.push(`  📄 ${dest}（${content.length} 字符）`);
            } catch (err) {
                lines.push(`  ✗ ${dest} 写入失败：${err instanceof Error ? err.message : String(err)}`);
            }
        }
        if (binEntries.length) {
            lines.push(`另外 ${binEntries.length} 个二进制成员未写回（文本通道会损坏它们）：`);
            for (const entry of binEntries.slice(0, 40)) lines.push(`  🖼 ${entry.name}（${entry.data.length} 字节）`);
            if (binEntries.length > 40) lines.push(`  …等共 ${binEntries.length} 个`);
        }
        if (unsupported.length) lines.push(`不支持的项目：${unsupported.join("、")}`);
        lines.push(`文本成员已写回 ${written}/${textEntries.length} 个到 ${destRoot}/。二进制成员需要取用时：图片可用「电脑文件」send 递给用户（zip 内的暂不可直接 send），或读原包 .b64 后在对话里解码分析。`);
        return lines.join("\n");
    },
};

export const QA_COMPUTER_TOOLS = [computerFilesTool, computerExecTool, computerUnpackTool];

// ── 隐藏别名（可执行、不进提示词）：兼容早期的四个单操作工具名 ──

function alias(name: string, nativeName: string, run: (args: Record<string, unknown>) => Promise<string>): QaComputerTool {
    return {
        name,
        nativeName,
        description: `（隐藏别名）等价于 电脑文件 的对应操作`,
        schemaLines: [],
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, maxChars: { type: "number" } } },
        run,
    };
}

export const QA_COMPUTER_ALIAS_TOOLS = [
    alias("电脑列目录", "computer_list_dir", runList),
    alias("电脑读文件", "computer_read_file", runRead),
    alias("电脑写文件", "computer_write_file", runWrite),
    alias("电脑删除文件", "computer_delete", runDelete),
];

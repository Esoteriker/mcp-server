#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";

const rootArg = process.argv[2];
if (!rootArg) {
  console.error("用法: node build/index.js <允许访问的根目录>");
  process.exit(1);
}
const ROOT = path.resolve(rootArg);

const MAX_READ_BYTES = 1_000_000;
const MAX_SEARCH_RESULTS = 200;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function resolveSafePath(userPath: string): string {
  const resolved = path.resolve(ROOT, userPath);
  const relative = path.relative(ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径超出允许范围（根目录：${ROOT}）：${userPath}`);
  }
  return resolved;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

const server = new McpServer({
  name: "filesystem-mcp-server",
  version: "0.1.0",
});

server.registerTool(
  "list_directory",
  {
    title: "List Directory",
    description: `列出目录下的文件和子目录。路径相对于根目录 ${ROOT}，传 "." 表示根目录本身。`,
    inputSchema: {
      path: z.string().default(".").describe("相对于根目录的路径"),
    },
  },
  async ({ path: userPath }) => {
    try {
      const target = resolveSafePath(userPath);
      const entries = await fs.readdir(target, { withFileTypes: true });
      if (entries.length === 0) {
        return { content: [{ type: "text" as const, text: "（空目录）" }] };
      }
      const lines = entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => `${e.isDirectory() ? "[dir]  " : "[file] "}${e.name}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `列出目录失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "read_file",
  {
    title: "Read File",
    description: "读取文本文件内容（相对于根目录的路径）。文件超过 1MB 会拒绝读取。",
    inputSchema: {
      path: z.string().describe("相对于根目录的文件路径"),
    },
  },
  async ({ path: userPath }) => {
    try {
      const target = resolveSafePath(userPath);
      const stat = await fs.stat(target);
      if (stat.isDirectory()) {
        return {
          content: [{ type: "text" as const, text: `${userPath} 是一个目录，不是文件。` }],
          isError: true,
        };
      }
      if (stat.size > MAX_READ_BYTES) {
        return {
          content: [
            { type: "text" as const, text: `文件太大（${stat.size} 字节，上限 ${MAX_READ_BYTES}），拒绝读取。` },
          ],
          isError: true,
        };
      }
      const content = await fs.readFile(target, "utf-8");
      return { content: [{ type: "text" as const, text: content }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `读取文件失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "write_file",
  {
    title: "Write File",
    description: "写入文本内容到文件（相对于根目录的路径）。文件已存在会被整体覆盖，父目录不存在会自动创建。",
    inputSchema: {
      path: z.string().describe("相对于根目录的文件路径"),
      content: z.string().describe("要写入的文本内容"),
    },
  },
  async ({ path: userPath, content }) => {
    try {
      const target = resolveSafePath(userPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf-8");
      return {
        content: [
          { type: "text" as const, text: `已写入 ${userPath}（${Buffer.byteLength(content, "utf-8")} 字节）` },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `写入文件失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "search_files",
  {
    title: "Search Files",
    description: "在目录下递归搜索文件名匹配指定模式的文件（支持 * 和 ? 通配符）。自动跳过 node_modules 和 .git。",
    inputSchema: {
      pattern: z.string().describe("文件名匹配模式，例如 '*.ts' 或 'config.*'"),
      path: z.string().default(".").describe("搜索起始目录，相对于根目录"),
    },
  },
  async ({ pattern, path: userPath }) => {
    try {
      const startDir = resolveSafePath(userPath);
      const regex = globToRegExp(pattern);
      const matches: string[] = [];

      async function walk(dir: string): Promise<void> {
        if (matches.length >= MAX_SEARCH_RESULTS) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= MAX_SEARCH_RESULTS) return;
          if (SKIP_DIRS.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (regex.test(entry.name)) {
            matches.push(path.relative(ROOT, fullPath));
          }
        }
      }

      await walk(startDir);

      if (matches.length === 0) {
        return { content: [{ type: "text" as const, text: `没有找到匹配 "${pattern}" 的文件。` }] };
      }
      const suffix =
        matches.length >= MAX_SEARCH_RESULTS ? `\n（已达到 ${MAX_SEARCH_RESULTS} 条上限，可能还有更多未列出）` : "";
      return { content: [{ type: "text" as const, text: matches.join("\n") + suffix }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `搜索失败：${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_file_info",
  {
    title: "Get File Info",
    description: "获取文件或目录的元信息：类型、大小、修改时间。",
    inputSchema: {
      path: z.string().describe("相对于根目录的路径"),
    },
  },
  async ({ path: userPath }) => {
    try {
      const target = resolveSafePath(userPath);
      const stat = await fs.stat(target);
      const lines = [
        `路径：${userPath}`,
        `类型：${stat.isDirectory() ? "目录" : "文件"}`,
        `大小：${stat.size} 字节`,
        `修改时间：${stat.mtime.toISOString()}`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `获取信息失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  try {
    const stat = await fs.stat(ROOT);
    if (!stat.isDirectory()) {
      console.error(`根目录不是一个目录：${ROOT}`);
      process.exit(1);
    }
  } catch {
    console.error(`根目录不存在：${ROOT}`);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`filesystem-mcp-server running on stdio, root = ${ROOT}`);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

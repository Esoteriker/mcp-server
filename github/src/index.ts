#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 15_000;
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

async function gh(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      timeout: GH_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr;
    const message = stderr && stderr.trim() ? stderr.trim() : error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
}

const repoSchema = z
  .string()
  .regex(REPO_PATTERN, "格式应为 owner/repo")
  .describe("仓库全名，例如 'Esoteriker/mcp-server'");

const server = new McpServer({
  name: "github-mcp-server",
  version: "0.1.0",
});

server.registerTool(
  "repo_info",
  {
    title: "Repo Info",
    description: "获取 GitHub 仓库的基本信息：描述、star/fork 数、主语言、可见性等（只读）。",
    inputSchema: {
      repo: repoSchema,
    },
  },
  async ({ repo }) => {
    try {
      const stdout = await gh([
        "repo",
        "view",
        repo,
        "--json",
        "nameWithOwner,description,url,isPrivate,stargazerCount,forkCount,primaryLanguage,defaultBranchRef,updatedAt,pushedAt",
      ]);
      const data = JSON.parse(stdout);
      const lines = [
        `仓库：${data.nameWithOwner}`,
        `描述：${data.description || "（无描述）"}`,
        `可见性：${data.isPrivate ? "Private" : "Public"}`,
        `主语言：${data.primaryLanguage?.name ?? "未知"}`,
        `Star：${data.stargazerCount}  Fork：${data.forkCount}`,
        `默认分支：${data.defaultBranchRef?.name ?? "未知"}`,
        `最后推送：${data.pushedAt}`,
        `URL：${data.url}`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `获取仓库信息失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_issues",
  {
    title: "List Issues",
    description: "列出仓库的 issue（只读）。",
    inputSchema: {
      repo: repoSchema,
      state: z.enum(["open", "closed", "all"]).default("open").describe("issue 状态"),
      limit: z.number().int().min(1).max(50).default(20).describe("最多返回条数"),
    },
  },
  async ({ repo, state, limit }) => {
    try {
      const stdout = await gh([
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        state,
        "--limit",
        String(limit),
        "--json",
        "number,title,state,author,createdAt,url",
      ]);
      const data: Array<{
        number: number;
        title: string;
        state: string;
        author?: { login: string };
        createdAt: string;
      }> = JSON.parse(stdout);
      if (data.length === 0) {
        return { content: [{ type: "text" as const, text: `没有 ${state} 状态的 issue。` }] };
      }
      const lines = data.map(
        (i) => `#${i.number} [${i.state}] ${i.title} — @${i.author?.login ?? "unknown"} (${i.createdAt})`
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `获取 issue 列表失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_issue",
  {
    title: "Get Issue",
    description: "获取单个 issue 的详细内容，包括正文（只读）。",
    inputSchema: {
      repo: repoSchema,
      number: z.number().int().positive().describe("issue 编号"),
    },
  },
  async ({ repo, number }) => {
    try {
      const stdout = await gh([
        "issue",
        "view",
        String(number),
        "--repo",
        repo,
        "--json",
        "number,title,body,state,author,createdAt,url,labels",
      ]);
      const data = JSON.parse(stdout);
      const labels = (data.labels ?? []).map((l: { name: string }) => l.name).join(", ") || "无";
      const lines = [
        `#${data.number} ${data.title}`,
        `状态：${data.state}  作者：@${data.author?.login ?? "unknown"}  创建于：${data.createdAt}`,
        `标签：${labels}`,
        `URL：${data.url}`,
        "",
        data.body || "（无正文）",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `获取 issue 详情失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_pull_requests",
  {
    title: "List Pull Requests",
    description: "列出仓库的 PR（只读）。",
    inputSchema: {
      repo: repoSchema,
      state: z.enum(["open", "closed", "merged", "all"]).default("open").describe("PR 状态"),
      limit: z.number().int().min(1).max(50).default(20).describe("最多返回条数"),
    },
  },
  async ({ repo, state, limit }) => {
    try {
      const stdout = await gh([
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        state,
        "--limit",
        String(limit),
        "--json",
        "number,title,state,author,createdAt,url,isDraft",
      ]);
      const data: Array<{
        number: number;
        title: string;
        state: string;
        author?: { login: string };
        createdAt: string;
        isDraft: boolean;
      }> = JSON.parse(stdout);
      if (data.length === 0) {
        return { content: [{ type: "text" as const, text: `没有 ${state} 状态的 PR。` }] };
      }
      const lines = data.map(
        (p) =>
          `#${p.number}${p.isDraft ? " [draft]" : ""} [${p.state}] ${p.title} — @${p.author?.login ?? "unknown"} (${p.createdAt})`
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `获取 PR 列表失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "search_repos",
  {
    title: "Search Repositories",
    description: "按关键词搜索 GitHub 上的公开仓库（只读）。",
    inputSchema: {
      query: z.string().min(1).describe("搜索关键词，例如 'mcp server language:typescript'"),
      limit: z.number().int().min(1).max(30).default(10).describe("最多返回条数"),
    },
  },
  async ({ query, limit }) => {
    try {
      const stdout = await gh([
        "search",
        "repos",
        query,
        "--limit",
        String(limit),
        "--json",
        "fullName,description,stargazersCount,url,updatedAt",
      ]);
      const data: Array<{
        fullName: string;
        description?: string;
        stargazersCount: number;
      }> = JSON.parse(stdout);
      if (data.length === 0) {
        return { content: [{ type: "text" as const, text: `没有找到匹配 "${query}" 的仓库。` }] };
      }
      const lines = data.map((r) => `${r.fullName} ⭐${r.stargazersCount} — ${r.description || "（无描述）"}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `搜索仓库失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  try {
    await execFileAsync("gh", ["auth", "status"], { timeout: 10_000 });
  } catch {
    console.error("gh CLI 未安装或未登录，请先运行 `gh auth login`。");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("github-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

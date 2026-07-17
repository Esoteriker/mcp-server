# mcp-server

个人 MCP（Model Context Protocol）server 练习仓库。每个 server 独立一个文件夹，互不依赖，可以单独构建、单独注册到 MCP 客户端（Claude Code / Claude Desktop 等）。

## 约定

- 语言：TypeScript，基于官方 `@modelcontextprotocol/sdk` + `zod`，统一用 stdio 传输
- 每个 server 文件夹结构一致：`package.json` / `tsconfig.json` / `src/index.ts` / `.gitignore`
- 构建：进入对应文件夹执行 `npm install && npm run build`，产物输出到 `build/`
- 注册到 Claude Code：`claude mcp add <name> -- node <server目录>/build/index.js [启动参数...]`
- **新增 server 时**：新建独立文件夹，构建/测试通过后在下面的列表里加一节，保持文档同步

## Servers

### [weather](weather)

查询天气。数据来自 [Open-Meteo](https://open-meteo.com)，免费、无需 API key，支持中英文地名。

| 工具 | 说明 |
|---|---|
| `search_location` | 地名（支持中文）→ 经纬度坐标，同名地点返回多个候选消歧义 |
| `get_weather` | 经纬度 → 当前天气实况 + 未来 3 天预报 |

```bash
claude mcp add weather -- node weather/build/index.js
```

### [filesystem](filesystem)

读写、搜索本地文件系统，限定在启动时指定的根目录内（越界路径会被拒绝，防止访问根目录以外的文件）。

| 工具 | 说明 |
|---|---|
| `list_directory` | 列出目录下的文件和子目录 |
| `read_file` | 读取文本文件内容（限制 1MB） |
| `write_file` | 写入/覆盖文本文件，自动创建父目录 |
| `search_files` | 按文件名模式（支持 `*` `?`）递归搜索，自动跳过 `node_modules`/`.git` |
| `get_file_info` | 获取文件/目录的类型、大小、修改时间 |

没有提供删除文件的工具（破坏性操作，按需再加）。

```bash
claude mcp add filesystem -- node filesystem/build/index.js <允许访问的根目录>
```

### [github](github)

只读查询 GitHub。直接调用本机已登录的 `gh` CLI（复用其认证），不做创建 issue/评论/合并 PR 等会产生公开内容的操作。

| 工具 | 说明 |
|---|---|
| `repo_info` | 仓库基本信息：描述、star/fork 数、主语言、可见性等 |
| `list_issues` | 列出仓库 issue（可按 open/closed/all 筛选） |
| `get_issue` | 单个 issue 的详细内容，含正文 |
| `list_pull_requests` | 列出仓库 PR（可按 open/closed/merged/all 筛选） |
| `search_repos` | 按关键词搜索 GitHub 公开仓库 |

依赖：本机已安装并登录 `gh` CLI（`gh auth status` 通过）。

```bash
claude mcp add github -- node github/build/index.js
```

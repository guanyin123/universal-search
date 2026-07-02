# universal-search · 万能搜索

> [English](./README.md) | **简体中文**

[![CI](https://github.com/guanyin123/universal-search/actions/workflows/ci.yml/badge.svg)](https://github.com/guanyin123/universal-search/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

一个本地研究工具：把一个问题变成一份综合好的报告，并沉淀进你的笔记。你提出问题 →
编辑 AI 给出的多源搜索计划 → 应用并行检索、逐源压缩、用强模型综合成报告 →（可选）
带自动 git commit 地写入你的 Obsidian 第二大脑。

整条链路是一个可复用范式：**可编辑的搜索计划 → 便宜模型铺广度 → 强模型收口 →
合规安全地写入 vault。**

<!-- 需要截图时，把图片放到 docs/screenshot.png 并取消下一行注释： -->
<!-- ![universal-search](./docs/screenshot.png) -->

## 功能

- **三种搜索模式**
  - **Report（报告）** — 多维检索（Web、社区、他人写作、图片）。AI 为每个维度提出
    2–3 条查询，你增删改后并行搜索、压缩结果，综合成一份 Markdown 报告。
  - **GitHub** — 描述你需要的工具，AI 提出 GitHub 搜索查询、检索并按声誉 + 契合度
    对仓库排序。
  - **Quick（快速）** — 直连 web 搜索（无 LLM、无计划），快速拿到 URL + 摘要。
- **Provider 无关的 LLM** — 支持任意 OpenAI 兼容端点（OpenAI、DeepSeek、Ollama
  等）。便宜的 "fanout" 模型铺广度，强的 "synth" 模型收口写报告。渠道在应用内配置。
- **可复用工作流** — 把一次成功的流程另存为工作流，下次同类问题直接加载、跳到搜索。
- **安全写 vault** — 原子写（temp → rename）、断言路径在 vault 内、自动 git commit
  且只 stage 自己写的文件。

## 快速开始（npm）

**前置：** Node.js **≥ 22.5**（推荐 Node 24 —— 应用用到内置 `node:sqlite`）；一个
免费的 [Tavily](https://tavily.com) API key。

```bash
git clone https://github.com/guanyin123/universal-search.git
cd universal-search
npm install
cp .env.example .env      # 填 TAVILY_API_KEY（唯一必填项）
npm run dev               # → http://localhost:5173
```

首次启动会有**新手向导**引导你选择 AI provider + 模型、设置保存目录。其余全部可选。

## 快速开始（Docker）

一条命令跑起来，无需安装 Node。

```bash
cp .env.example .env      # 填 TAVILY_API_KEY
docker compose up --build # → http://localhost:3000
```

应用状态（设置 + 运行历史）持久化到宿主的 `./.data` 与 `./.runs`。若要开启
**沉淀到 vault**，在 [`docker-compose.yml`](./docker-compose.yml) 里取消注释挂载
vault 的卷，并在应用设置里把保存目录设为 `/vault`。

> 注意：开发模式端口是 **5173**（Vite）；Docker / 生产服务端口是 **3000**
> （adapter-node）。

## 配置说明

配置有意分成两处：

- **应用内（推荐）**：LLM provider/密钥、保存目录，通过新手向导与
  **设置 → 管理渠道** 配置，加密存于本地 SQLite（`.data/`）。
- **环境变量（`.env`）**：只有 `TAVILY_API_KEY` 必填，其余都是可选种子/开关。

| 变量 | 必需 | 用途 |
|---|:---:|---|
| `TAVILY_API_KEY` | **是** | Web 检索 —— 唯一启动必需的变量 |
| `VAULT_ROOT` | 否 | 保存目录种子（推荐在应用内设置） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `FANOUT_MODEL` / `SYNTH_MODEL` / `LLM_MODELS` | 否 | LLM 首启种子（推荐用应用内「管理渠道」） |
| `COMMUNITY_ENABLED` | 否 | 设为 `true` 开启社区维度 |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | 否 | Reddit app-only OAuth（数据中心 IP 需要） |
| `EXA_API_KEY` | 否 | 开启「他人写作」维度（Exa） |
| `UNSPLASH_ACCESS_KEY` | 否 | 开启「图片」维度（Unsplash） |
| `JINA_API_KEY` | 否 | URL → Markdown 阅读器（留空走免费档） |
| `GITHUB_TOKEN` | 否 | 提升 GitHub 检索模式的速率限额 |

## 流程（5 步）

1. 输入问题。
2. AI 为每个维度提出 2–3 条搜索查询 —— 可增、删、改。
3. 确认后并行搜索所有来源，逐源压缩。
4. 强模型用默认「Smart Research」模板综合成报告。
5. 预览报告 → 确认 → 沉淀进 vault + 自动 commit。

### 搜索维度与密钥

| 维度 | 来源 | 密钥 |
|---|---|---|
| Web | Tavily | **必需**（`TAVILY_API_KEY`） |
| 社区与网站 | Reddit + Hacker News | 可选（`COMMUNITY_ENABLED`、Reddit OAuth） |
| 他人写作 | Exa | 可选（`EXA_API_KEY`） |
| 图片 | Unsplash | 可选（`UNSPLASH_ACCESS_KEY`） |

缺少密钥时对应维度会静默跳过 —— Web 搜索始终可用。

## 生产构建

```bash
npm run build     # 构建 adapter-node 服务
node build        # 在 http://localhost:3000 提供服务（读取 PORT / HOST）
```

## 测试

```bash
npm test          # 单元 + 集成测试（vitest）
npm run check     # 类型检查（svelte-check）
```

## 路线图

- **v1** —— 单 Web 维度，跑通整条脚骨。✅
- **v2** —— 追加社区（Reddit/HN）、他人写作（Exa）、图片（Unsplash）维度；tags 复用
  vault 既有词汇、`related[]` 自动关联。✅
- **v3（当前）** —— 把一次成功的流程另存为可复用工作流
  （`.research-workflows/<slug>.md`），下次同类问题加载工作流即跳过「提问 → 编辑
  计划」直接并行搜索，并复用该工作流自带的报告模板与综合 prompt。✅

## 已知问题

**检索 + 合成**这半边端到端可用；**写 vault（deposit）**这半边在大型、iCloud 同步的
Obsidian vault 上目前受限：

- **脏树硬中止** —— 写前用**全树** `git status` 断言 vault 干净。Obsidian 插件会持续
  改写未 gitignore 的缓存文件（如 `.obsidian/*`、`.smart-env/*.ajson`），使工作树
  长期为"脏"，从而挡下 deposit。
- **iCloud 下 `git status` 极慢** —— vault 在 iCloud 上时，全树 `git status` 可能
  非常慢（受 I/O 限制的文件实体化）。

**缓解：** 对 vault 的 git 仓库开启 `core.fsmonitor` 与 `core.untrackedCache`。把
干净检查收窄到只检查本次 deposit 的目标路径是一个已记录的改进方向 —— 欢迎贡献。

## 贡献

欢迎提 issue / PR —— 环境搭建与需通过的检查见 [CONTRIBUTING.md](./CONTRIBUTING.md)，
并请阅读[行为准则](./CODE_OF_CONDUCT.md)。安全问题见 [SECURITY.md](./SECURITY.md)。

## 许可证

[Apache License 2.0](./LICENSE) © guanyin

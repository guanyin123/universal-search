# Universal Search — 设计文档（Spec）

- **日期**: 2026-06-17
- **状态**: Draft（待用户审阅）
- **项目路径**: `/Users/admin/ai-developer/universal-search`
- **第二大脑（沉淀目标）**: `/Users/admin/Documents/ObsidianVault`
- **设计来源**: brainstorming 会话 + 一轮 `+100k` 调研工作流（8 个 Haiku 铺广度 → Opus 收口）

---

## 1. 背景与动机

用户想了解某些知识时，直接用搜索引擎"费劲且分散"；让 AI 去找又因为"没有固定范式"，每次步骤多少不一、产出接口差别很大。

**核心诉求：把"搜索 → 沉淀知识"的方式与过程固定成一个可复用的范式**，让同类问题每次都能得到结构一致、可复现、可回找的结果，并自动沉淀进第二大脑。

调研结论：搜索（`deep-research` / `last30days`）与沉淀（`/ingest`）的能力已部分存在；本项目真正新增的是 **范式层**——(a) AI 提出可编辑的搜索维度+源，(b) 一致地编排执行，(c) 一次成功的流程能"凝固"成可复用工作流。区别于 GPT Researcher / Perplexity（黑盒、不可编辑搜索计划、结果不可复现）。

## 2. 目标 / 非目标

**目标（MVP）**
- 本地运行的 Web App，输入问题 → AI 提出搜索计划 → **用户可增删改** → 执行搜索 → 强模型综合成报告 → 经确认后安全沉淀进 vault。
- 模型层 **provider 无关**，默认 OpenAI，兼容 DeepSeek / 任意 OpenAI 兼容端点（可改 `base_url`）；**允许用户在 UI 选择模型**。
- 沉淀严格复用 vault 既有三层 schema 与 frontmatter，遵循"先列计划→确认→写入→autocommit"的半主动模式。

**非目标（MVP 不做）**
- 社区 / 人物写作 / 图片三个维度（v2 以适配器形式追加）。
- 可复用工作流的保存与回放、"另存为工作流"（v3）。
- 每工作流自带模板、问题类型自动识别（v3）。
- 写入 `wiki/entities/`、`wiki/concepts/`（仍交给既有 `/ingest`）。
- 云端部署、多用户、鉴权（这是单用户本地工具）。

## 3. 核心范式（产品流程）

1. 用户提出问题。
2. AI 提出**搜索维度**（MVP 仅 `web`）+ 每个维度 2–3 个**搜索源**（具体查询串）。
3. UI 渲染维度/源列表，用户**增 / 删 / 改**。
4. 确认后按计划并行搜索。
5. 综合成详细**报告**，经"列文件计划 → 确认"后沉淀进第二大脑。
6.（v3）流程走完可"另存为工作流"，下次同类问题跳过第 2、3 步。

## 4. 范围：MVP 与分期

| 阶段 | 内容 |
|---|---|
| **v1（本 spec）** | 单 `web` 维度跑通整条脚骨：可编辑计划 → cheap 模型 fanout → 强模型收口 → SSE 进度 → 合规沉淀。仅默认模板。 |
| **v2** | 追加 `community(Reddit/HN)` / `peoples_writing(Exa)` / `images(Unsplash)` 维度（实现 `SourceRunner` 适配器即可，不改主干）。 |
| **v3** | 可复用工作流（`.research-workflows/<slug>.md` 数据模型 + 回放 + 另存为）；每工作流自带模板 + 6 种 archetype 模板 + 类型自动识别。 |

## 5. 架构总览

### 5.1 技术栈
- **Next.js（App Router，Node runtime —— 非 Edge，因需 `node:fs` 与本地网络）**，TypeScript，本地 `npm run dev` 启动。**Node 服务进程是唯一能访问 vault 的实体。**
- 模型层：**Vercel AI SDK**（`ai` + `@ai-sdk/openai`，可选 `@ai-sdk/anthropic`）。统一 `generateText` / `streamText`，切换 provider 仅改配置。
- 搜索层（MVP）：**Tavily**（web 检索）+ **Jina Reader**（`r.jina.ai`，URL→markdown）。
- 沉淀层：自研 vault writer，镜像 `/ingest` 的 schema 与安全规则。
- 编排：**不引入 LangGraph**。自研服务端**运行状态机**，状态落盘 `.runs/<id>.json`（可断点续跑）。
- 进度：**SSE**（`text/event-stream`）。

### 5.2 模型层（provider 无关 + 模型选择）
- 配置：`LLM_BASE_URL` / `LLM_API_KEY` + 角色化模型 `FANOUT_MODEL`（便宜）、`SYNTH_MODEL`（强）。
- **用户选择模型**：`GET {LLM_BASE_URL}/models` 拉取可用模型列表（OpenAI / DeepSeek 均支持），UI 给出 **Fanout 模型** 与 **Synthesis 模型** 两个下拉，默认取 env，可在每次运行前临时切换；该端点不支持时回退到 env 配置的模型白名单 `LLM_MODELS`。
- DeepSeek 切换示例：`LLM_BASE_URL=https://api.deepseek.com`，`FANOUT_MODEL=deepseek-chat`，`SYNTH_MODEL=deepseek-reasoner`。
- 抽象：`callModel({ role: 'fanout'|'synth', model?, messages, stream? })`，业务代码不出现任何 provider 专属字段。

### 5.3 运行状态机
状态：`proposing → awaiting_edit → searching → synthesizing → awaiting_deposit → depositing → done | error`

`Run` 对象（落盘 `.runs/<id>.json`）：
```ts
interface Run {
  id: string
  createdAt: string
  status: RunStatus
  question: string
  models: { fanout: string; synth: string }
  plan: {
    dimensions: Array<{
      key: 'web'                       // v1 仅 web
      label: string
      enabled: boolean
      sources: Array<{ id: string; api: 'tavily'; query: string; params?: object; enabled: boolean }>
    }>
  }
  evidence: Array<{ sourceId: string; url: string; title: string; compressed: string; retrievedAt: string }>
  report?: { templateKey: 'smart-default'; frontmatter: object; markdown: string }
  depositPlan?: { files: Array<{ path: string; kind: 'synthesis' | 'raw' }> }
  error?: { stage: RunStatus; message: string }
}
```

### 5.4 API 端点
| 方法 路径 | 作用 | 状态迁移 |
|---|---|---|
| `POST /api/run` | 建 run；cheap 模型提出 web 维度的 Tavily 查询串 | → `proposing` → `awaiting_edit` |
| `GET /api/run/:id/stream` | SSE 推送进度 | — |
| `POST /api/run/:id/plan` | 提交用户编辑后的源列表 | `awaiting_edit` → `searching` → `synthesizing` → `awaiting_deposit` |
| `POST /api/run/:id/deposit` | 确认沉淀 | `awaiting_deposit` → `depositing` → `done` |
| `GET /api/models` | 拉取可用模型列表供 UI 选择 | — |

### 5.5 数据流
问题 → cheap 模型产出 2–3 条 Tavily 查询 → 用户编辑 → 并行执行 Tavily → 每个结果 URL 过 Jina Reader 得 markdown → cheap 模型**逐源压缩**（控成本）→ 强模型用默认模板**综合报告** → 列文件计划 → 确认 → 写 `wiki/synthesis/<slug>.md` + `raw/research/<date>-<slug>/` → git autocommit。

### 5.6 进度流（SSE）
事件类型：`{phase:'proposing'}` · `{phase:'querying', source, status}` · `{phase:'synthesizing', token?}` · `{phase:'plan', files}` · `{phase:'done'}` · `{phase:'error', message}`；每 ~15s 发 heartbeat 防代理超时。前端 `EventSource` 消费，按事件更新 React 状态。

## 6. 搜索层（适配器接口，为 v2 预留）
```ts
interface SourceResult { url: string; title: string; snippet: string; publishedAt?: string }
interface SourceRunner {
  dimension: 'web' | 'community' | 'peoples_writing' | 'images'
  api: string
  run(query: string, params?: object): Promise<SourceResult[]>
}
```
MVP 仅实现 `TavilyWebRunner` + `JinaExtractor`。v2 新维度 = 新增 `SourceRunner` 实现，主干不动。

## 7. 沉淀与安全（镜像 `/ingest` 半主动模式）
- **报告** → `wiki/synthesis/<slug>.md`，frontmatter 用 vault 既有格式：`title / type: synthesis / created / updated / tags[] / sources[] / related[] / confidence / status: draft`。
- **原始快照** → `raw/research/<YYYY-MM-DD>-<slug>/<n>-<source-slug>.md`（冻结证据，保证可复现）。
- **安全闸（全部强制）**：
  1. 所有 LLM 派生文件名严格 `slugify`（去 `/ : ` 等）。
  2. `path.join(VAULT_ROOT, ...)` 后断言路径仍在 `VAULT_ROOT` 内，否则拒写。
  3. 先写临时文件 → 原子 `rename` 落位。
  4. **写前必过"列计划 → 用户确认"闸**。
  5. 写后 `git add` 指定文件 + `git commit`（autocommit）。
  6. **run 开始时若 vault git 树为脏 → 硬中止**，绝不与用户未提交改动混提交。
  7. v1 只写 `wiki/synthesis/` 与 `raw/research/`，**绝不**程序化写入更大的 `wiki/` 树。
- 写入范围窄化也用于规避 Obsidian Sync / iCloud 同步冲突；遇 git 冲突**大声报错**，不自动解决。

## 8. 报告模板（MVP 默认 "Smart Research"）
Markdown 标题结构：
```
# {问题}
> {1–2 句执行摘要}
## 问题界定（Question Clarity）
## 核心发现（Core Findings）— 每条带 [引用] 与 (置信度: 高/中/低)
## 详细展开（Detail）
## 分歧与警示（Contradictions & Caveats）
## 开放问题（Open Questions）
## 行动项（Action Items）
## 来源（Sources）— 按维度分组，标注检索日期
```
（v3 起每工作流可携带自己的模板覆盖默认；6 种 archetype 模板：concept / comparison / community-pulse / how-to / landscape / decision。）

## 9. 可复用工作流（前向兼容数据模型，feature 在 v3）
MVP 即把维度/源/模板建成**结构化数据**（见 §5.3 `Run.plan` 与 `templateKey`），使 v3 的"另存为工作流"只是序列化，而非重写。v3 目标存储形态：`.research-workflows/<slug>.md`（vault 内 dotfolder，git 跟踪、Obsidian 隐藏），frontmatter 含 `id/name/version/archetype/question_pattern/dimensions/sources/deposit/model_config/run_history`，正文为该工作流专属模板 + 综合 system prompt；回放时跳过 §3 第 2、3 步，直接 hydrate 进入 fanout。

## 10. 配置（`.env.local`）
```bash
VAULT_ROOT=/Users/admin/Documents/ObsidianVault
# —— 模型层（默认 OpenAI；改 base_url 即切 DeepSeek/兼容端点）——
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
FANOUT_MODEL=gpt-4o-mini
SYNTH_MODEL=gpt-4o
# 可选：当端点无 /models 时，UI 模型下拉的白名单（逗号分隔）
LLM_MODELS=gpt-4o,gpt-4o-mini,o4-mini
# —— 搜索层 ——
TAVILY_API_KEY=tvly-...
JINA_API_KEY=            # 留空走免费档
# DeepSeek 切换示例：
# LLM_BASE_URL=https://api.deepseek.com
# FANOUT_MODEL=deepseek-chat
# SYNTH_MODEL=deepseek-reasoner
```

## 11. 错误处理与降级
- 单个源失败（搜索/抓取/压缩）**不杀整 run**，标记该源失败并继续；报告"来源"区注明缺失。
- 强模型综合前先 cheap 模型逐源压缩，封顶源数（默认 ≤8）控制 token 成本。
- LLM / 搜索 API 报错带阶段信息进 `Run.error`，SSE `error` 事件回前端。
- 沉淀阶段任一安全闸不过 → 中止并明确提示，不留半写状态（靠原子 rename）。

## 12. 测试策略
- **单元**：`slugify` / 路径安全断言 / frontmatter 构建 / 模板渲染。
- **集成**：mock-LLM + mock-Tavily，端到端走 **dry-run**（综合但不写盘）。
- **安全**：脏 vault 必中止；路径逃逸（`../`、绝对路径）必拒。
- 真实联网搜索/真实 LLM 仅做手动冒烟，不入自动化测试。

## 13. 风险与缓解
| 风险 | 缓解 |
|---|---|
| 写盘误伤真实笔记（最高危） | §7 七道安全闸；写入仅限 `wiki/synthesis/` + `raw/research/` |
| 结果不可复现（搜索 API 漂移、定价突变） | 范式层复现"过程"而非"结果"；`raw/` 冻结证据快照 |
| 社区维度免费覆盖有限（仅 Reddit+HN；X 已封锁） | v2 再做，并明确不承诺广覆盖；可选 ScrapeCreators 升级 |
| token 成本失控 | 封顶源数 + 逐源压缩 + prompt 缓存（共享指令前缀） |
| SSE 长流被代理 ~60s 截断 | heartbeat + `.runs` 落盘断点续跑 |
| 过度铺摊导致难产 | 先单维度跑通脚骨；其余皆适配器/配置，非新架构 |

## 14. 里程碑（v1）
1. 项目脚手架 + 配置加载 + 模型层抽象（`callModel` + `/api/models`）。
2. 运行状态机 + `.runs` 落盘 + SSE 通道。
3. `proposing`：cheap 模型产出 Tavily 查询；UI 可编辑源列表。
4. `searching`：`TavilyWebRunner` + `JinaExtractor` + 逐源压缩。
5. `synthesizing`：强模型 + 默认模板 → 报告预览。
6. `depositing`：vault writer + 七道安全闸 + autocommit；列计划→确认。
7. 测试（§12）+ 手动端到端冒烟。

## 15. 仍待确认（写实现计划前）
- `o4-mini` 等具体默认模型名，是否就用上面 env 示例值（你也可在 UI 现选）。
- `tags` 生成策略：让强模型产出标签，还是固定一组 + 模型补充。
- `related[]` 是否在 v1 自动关联 vault 既有页面（需读 `index.md`），还是先留空交给你手动补。

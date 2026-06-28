# universal-search · 万能搜索

本地研究应用：提出问题 → 编辑 AI 给出的搜索计划 → 综合成报告 → 沉淀进你的 Obsidian 第二大脑。

把「搜索 → 沉淀知识」的过程固定成一个可复用的范式：**可编辑的搜索计划 → 便宜模型铺广度 → 强模型收口 → 合规安全地写入 vault**。

## 快速开始

1. `npm install`
2. `cp .env.example .env`，填好 `VAULT_ROOT`、`LLM_API_KEY`、`TAVILY_API_KEY`
3. `npm run dev` → http://localhost:5173

## 配置说明

- **模型层 provider 无关**：默认 OpenAI。改 `LLM_BASE_URL` 即可切到 DeepSeek（`https://api.deepseek.com`）或任意 OpenAI 兼容端点；`FANOUT_MODEL`（铺广度，便宜）/ `SYNTH_MODEL`（收口，强）可在 UI 里现切。
- **搜索**：Tavily（web 检索，免费档）+ Jina Reader（URL→markdown，免费档，`JINA_API_KEY` 可留空）。
- **沉淀目标**：报告写到 `wiki/synthesis/<slug>.md`，原始快照写到 `raw/research/<date>-<slug>/`，沿用 vault 既有 frontmatter（`type: synthesis`）。

## 安全规则（写第二大脑）

- 写前严格断言路径在 vault 内、原子写（temp→rename）、先列文件计划等你确认。
- 写后自动 `git commit`；**若 vault 工作区在开跑时是脏的，硬中止**，绝不和你未提交的改动混提交。
- v1 只写 `wiki/synthesis/` 与 `raw/research/`，不碰 vault 其他区域。

## 流程（5 步）

1. 输入问题。
2. AI 提出 web 维度的 2–3 条搜索查询（可增删改）。
3. 确认后并行搜索 + 逐源压缩。
4. 强模型用默认「Smart Research」模板综合报告。
5. 预览报告 → 确认 → 沉淀 + autocommit。

## 测试

```bash
npm test          # vitest 全量单元/集成测试
npx svelte-check  # 类型检查
```

## 路线图

- **v1**：单 web 维度跑通整条脚骨。✅
- **v2**：追加社区(Reddit/HN) / 人物写作(Exa) / 图片(Unsplash) 维度（实现 `SourceRunner` 适配器即可）；tags 复用 vault 既有词汇、`related[]` 自动关联。✅
- **v3（当前）**：把一次成功的流程「另存为可复用工作流」（`.research-workflows/<slug>.md`，复用 vault 写盘安全闸），下次同类问题加载工作流即跳过「提问→编辑计划」直接并行搜索，并复用该工作流自带的报告模板与综合 prompt。✅

设计与计划文档见 `docs/superpowers/`。

## 已知问题（2026-06-24 真机冒烟发现）

端到端真机冒烟验证了**检索 + 合成**这半边（web=Tavily、community=HN 真实 API 通过；Reddit 在部分网络下不可达，按设计降级为 HN-only）。但 **deposit（写 vault）这半边在 iCloud 同步的大型 vault 上目前不可用**，有两个待修问题（代码暂未改）：

- **脏树硬中止**：`assertCleanVault` 用**全树** `git status` 判断，只要 vault 有任何未提交改动就 `throw`。Obsidian 本体与 Smart Connections 等插件会持续改写 `.obsidian/*`、`.smart-env/*.ajson` 等**未 gitignore** 的状态/缓存文件，使工作树长期为"脏"，deposit 永远被这一步挡下。
  - 修复方向：把 `assertCleanVault` 从全树检查改为**只检查本次 deposit 的目标路径**（`git status --porcelain -- <files>`）；`autocommit` 本就只 `git add` 自己的文件，不会与你未提交的改动混提交，安全意图不变。
- **iCloud 下 `git status` 极慢**：vault 在 iCloud Drive 上，`git status` 实测约 **47 分钟**（2237 个文件逐个实体化，CPU 0%、全程等 I/O）。即便工作树干净，`assertCleanVault` 也会卡 40+ 分钟。
  - 缓解：上面的"路径范围检查"只 stat 少量目标文件，可同时大幅提速；另可对 vault `.git` 开启 `core.fsmonitor` + `core.untrackedCache`。

> 运行前置（配置类，非代码缺陷）：LLM 需可用的 OpenAI 兼容 key/endpoint，且 `FANOUT_MODEL`/`SYNTH_MODEL` 必须是该 provider **实际提供**的模型 id；`peoples_writing` / `images` 维度分别需要 `EXA_API_KEY` / `UNSPLASH_ACCESS_KEY`，缺失时该维度静默跳过。

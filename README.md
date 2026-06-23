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

# Universal Search — GitHub Issue 轨道 设计文档（Spec）

- **日期**: 2026-06-25
- **状态**: Draft（待用户审阅）
- **项目路径**: `/Users/admin/ai-developer/universal-search`
- **沉淀目标（本轨道）**: `/Users/admin/Documents/ObsidianVault/05-NightShift/inbox/`
- **设计来源**: brainstorming 会话（2026-06-25）。四个关键分叉均由用户在会话中拍板（见 §15）。
- **关联现有设计**: `docs/superpowers/specs/2026-06-17-universal-search-design.md`（报告轨道 v1/v2/v3）。

---

## 1. 背景与动机

现有 universal-search 的核心能力是**「搜索 → 综合报告 → 沉淀进 vault」**。用户希望新增一个**同级能力**：

> **「搜索出 GitHub 工具 → 跟我讨论得出 issue → 把 issue 写进 `/nightshift-issue`（NightShift 收件箱）」**。

即：当用户想找一个开源工具来解决某需求时，App 搜出候选 repo，用户挑选并与 App 结构化地「讨论」出一个**自包含的 `code` 任务 issue**，落进 `05-NightShift/inbox/`，由 NightShift 夜间无人值守 runner（每晚 01:30 launchd）去**实际动手集成/试用**那个工具。

报告轨道产出「知识」，本轨道产出「夜间待办的动手任务」。两者共用同一套检索/计划编辑骨架，只在尾部分叉。

## 2. 目标 / 非目标

**目标（v1）**
- App 内新增一个与报告模式**同级的「GitHub Issue」模式**（顶部模式切换）。
- 流程：问题 → AI 提出 GitHub 搜索查询（可编辑）→ 搜出候选 repo → 用户挑工具 + 设 `workdir` 等字段 → 强模型起草 `code` issue → 结构化审阅/重写 → 写入 `05-NightShift/inbox/NS-<date>-<slug>.md`。
- issue 严格符合 `05-NightShift/_template.md` 的字段契约（runner 无人值守，正文须自包含）。
- 写入是**对收件箱的原子文件写**，**不走** vault 的 `assertCleanVault`/autocommit 闸（与现有 `/nightshift-issue` skill 行为一致：只写不提交，NightShift 自管 git）。

**非目标（v1 不做）**
- `research` / `vault` / `misc` 类型 issue（v1 固定 `type=code`；渲染器保持通用，后续加类型只是开关）。
- 真正的多轮对话面板（用户已选「结构化」而非「对话式」——讨论 = 挑选 + 字段编辑 + 单次「按批注重写」）。
- 把 GitHub 维度并进报告轨道的综合（两轨道产出不同，不混用）。
- 写完后替用户 git 提交收件箱文件（交给 NightShift 自身的 `merge-night.sh`/runner）。
- 直接触发夜跑或改 launchd（只负责入队）。

## 3. 核心流程（产品）

1. 用户切到「GitHub Issue」模式，输入需求/问题。
2. AI 提出 2–3 条 **GitHub 仓库搜索查询**（带 `language:` / `stars:>N` 等限定符），用户可增删改（复用报告轨道的「编辑计划」面板）。
3. 确认后执行 GitHub 搜索，列出**候选 repo**（name / 描述 / stars / 语言 / license / 最近 push / topics）。
4. 用户**勾选 1+ 工具**，设 `workdir`（白名单下拉）+ `priority` + `allow_push` + `allow_network`，可写备注。
5. 强模型抓取选中 repo 的 README，**起草一份自包含的 `code` issue**（🎯/📋/✅/📤/🚫）。
6. **讨论（结构化）**：用户编辑草稿字段/正文；可点「让 AI 按我的批注重写」做单次重写。
7. 确认 → 原子写入 `05-NightShift/inbox/NS-<date>-<slug>.md`，提示「今晚 01:30 自动跑，醒来看 `reports/<次日>.md`」。

## 4. 架构决策：尾部分叉的 mode 标志（用户选 ②）

候选架构对比见 §15。**采用「现有 `Run` 加 `mode` 标志」**：共用 `Run`/types/store/路由/UI，分叉的尾部逻辑放进**独立的同级函数**（非塞进 `runPlan` 的条件分支），以收敛分支、保报告流不变。

- 报告流代码**行为不变**：`startRun` 仅新增 `mode` 入参（默认 `'report'`）；`runPlan`/`depositRun` 原路径保留。
- 新增的检索/起草/写盘是 `machine.ts` 内的**新函数**，按 `mode` 由路由层分派。

## 5. 数据模型（`runs/types.ts`）

```ts
export type RunMode = 'report' | 'github_issue';

export type RunStatus =
  | 'proposing' | 'awaiting_edit' | 'searching'
  | 'awaiting_pick'           // 新增：搜出候选、等用户挑工具+设字段
  | 'synthesizing'            // 复用：此处含义=「AI 起草 issue 中」
  | 'awaiting_deposit'        // 复用：此处含义=「审阅 issue 草稿」
  | 'depositing'              // 复用：此处含义=「写入收件箱」
  | 'done' | 'error';

export type DimensionKey = 'web' | 'peoples_writing' | 'community' | 'images' | 'github'; // += github
export type SourceApi    = 'tavily' | 'exa' | 'community' | 'unsplash' | 'github';        // += github

// SourceResult 增可选 repo 字段（非破坏）
interface SourceResult {
  url: string; title: string; snippet: string; publishedAt?: string; imageUrl?: string;
  stars?: number; language?: string; license?: string; pushedAt?: string; topics?: string[];
}

interface NightShiftIssue {
  id: string;            // NS-<date>-<slug>
  title: string;
  type: 'code';          // v1 固定
  priority: 'high' | 'normal' | 'low';
  workdir: string;       // 绝对路径，须 ∈ 白名单
  allowNetwork: boolean;
  allowPush: boolean;
  timeoutMin: number;    // 默认 60
  created: string;       // YYYY-MM-DD
  body: string;          // 🎯/📋/✅/📤/🚫 markdown
  picks: string[];       // 选中的 repo url
}

interface Run {
  // …既有字段不变…
  mode: RunMode;                 // 默认 'report'（旧 run / 回放向后兼容）
  candidates?: SourceResult[];   // 搜出的候选 repo（供挑选）
  issue?: NightShiftIssue;       // issue 草稿
}
```

向后兼容：`mode` 缺省视为 `'report'`；workflow 回放沿用报告流，不受影响。

## 6. 运行状态机（issue 模式，`runs/machine.ts`）

`proposing → awaiting_edit → searching → awaiting_pick → synthesizing(draft) → awaiting_deposit(review) → depositing(write) → done | error`

新增/改动函数（均为 `machine.ts` 内同级函数，保持各函数聚焦、文件 <500 行）：
- `startRun(input + mode)`：`github_issue` 时只提一个 `github` 维度，用 **`buildGithubProposePrompt`** 产出仓库搜索查询。
- `runIssueSearch(runId, editedPlan)`：跑 `GitHubRunner` 收集候选 repo（**不**逐 repo 过 Jina/压缩——那是报告流专属）→ 存 `run.candidates` → `awaiting_pick`。
- `draftIssue(runId, { picks, workdir, priority, allowPush, allowNetwork, timeoutMin, notes? })`：抓取选中 repo 的 README，强模型按 `buildIssueDraftPrompt` 起草 → 存 `run.issue` → `awaiting_deposit`。`notes` 非空即为「按批注重写」（同一函数，单次重跑）。

错误处理：GitHub 搜索全失败 → 在 `searching` 阶段报错中止（对齐报告流「所有源失败即中止」）。

## 7. GitHub 检索层（`search/github.ts`）

`SourceRunner` 形态（`dimension:'github'`, `api:'github'`）：
- `GET https://api.github.com/search/repositories?q=<query>&sort=stars&order=desc&per_page=8`
- 鉴权：有 `GITHUB_TOKEN` 则带 `Authorization: Bearer`（限速 30 req/min），否则匿名（10 req/min）——单用户本地够用，缺 token **不阻断**（优雅降级）。
- 映射：`title=full_name`、`url=html_url`、`snippet=description`，并填 `stars/language/license/pushedAt/topics`。
- 非 2xx → throw（被 `runIssueSearch` 捕获为该源失败）。

## 8. 起草 + 写盘

### 8.1 起草（`pipeline/issue-draft.ts`，与 `template.ts`/`tags.ts` 同级）
- `buildGithubProposePrompt(question)`：产出 2–3 条仓库搜索查询（鼓励带 `language:`/`stars:>N`/topic 限定）。
- `buildIssueDraftPrompt({ question, repos(README 摘要), workdir, notes? })`：产出一份**自包含**的 `code` issue：
  - 🎯 目标：在 `<workdir>` 用 `<选中工具>` 达成 `<问题>`。
  - 📋 上下文：自足背景——工具是什么/选它的理由/repo 链接/目标 repo 现状/约束（runner 问不了人，全写进去）。
  - ✅ 验收标准：逐条可判定。
  - 📤 产出位置：改动落在 `<workdir>`；结果摘要追加进本 issue / reports。
  - 🚫 禁区：叠加全局护栏（默认不乱 push、不购买服务等）。
- **草稿默认字段值**（UI 内均可改）：`priority=normal`、`allow_network=true`（code 集成常需装依赖/拉包）、`allow_push=false`、`timeout_min=60`。

### 8.2 写盘（`vault/nightshift.ts`）
- 渲染 frontmatter（`id/title/type/priority/workdir/allow_network/allow_push/timeout_min/created`）+ 正文。
- **校验 `workdir ∈ 白名单**：读 `05-NightShift/runner-settings.json › permissions.additionalDirectories`；读不到则降级为「自由输入 + 警告不阻断」。
- slug：复用 `slugify`，**拒绝 `_` 开头**（runner 会跳过）；文件名冲突时加数字后缀。
- 路径安全：复用 `resolveInsideVault` 思路，断言落点在 `05-NightShift/inbox/` 内。
- **原子写**（temp→rename）。**不** `assertCleanVault`、**不** autocommit。
- `depositRun` 按 `run.mode` 分派：`report` → 既有 vault 路径；`github_issue` → 本写盘。

> 设计副作用：本轨道天然绕开了报告轨道 deposit 的两个已知阻断（脏树硬中止、iCloud `git status` ~47 min），因为完全不触碰整树 git。

## 9. API 路由

| 方法 路径 | 作用 | 备注 |
|---|---|---|
| `POST /api/run` | 建 run，`+ mode` 入参 | `github_issue` 时提 GitHub 查询 |
| `POST /api/run/:id/plan` | 提交编辑后的计划 | report→`runPlan`；issue→`runIssueSearch` |
| `POST /api/run/:id/pick` | **新增**：提交挑选+字段，触发起草 | → `draftIssue` |
| `POST /api/run/:id/redraft` | **新增（可选）**：带 `notes` 重写草稿 | → `draftIssue`（notes 非空） |
| `POST /api/run/:id/deposit` | 确认写盘 | 按 mode 分派 vault / inbox |
| `GET /api/run/:id/stream` | SSE 进度 | 复用 |

## 10. UI（`+page.svelte` + 新组件）

- 问题框旁加**模式切换**：`报告 ｜ GitHub Issue`。
- issue 模式复用「编辑计划」面板（查询串即 GitHub 搜索）+ 实时检索列表。
- 新增**候选挑选 + 草稿编辑**面板：候选 repo（带 stars/语言/license/最近 push，复选）→ `workdir` 下拉（白名单）+ priority + allow_push + allow_network + 备注 → 「起草 issue」。
- 草稿区：issue markdown 预览 + 可编辑字段 + **「让 AI 按我的批注重写」** + 「写入 NightShift inbox」。
- done：显示落点路径 + 「今晚 01:30 自动跑」。
- **抽出一个组件 `src/lib/IssueMode.svelte`** 承载 issue 模式 UI，使 `+page.svelte` 保持 <500 行（这是对「尽量少新增文件」的有意偏离，以守住文件大小红线）。

## 11. 配置（`config.ts` / `.env`）

```bash
# —— GitHub Issue 轨道 ——
GITHUB_TOKEN=            # 可选；缺省走匿名（限速更低，本地单用户够用）
# NightShift 收件箱位置由 VAULT_ROOT 派生：<VAULT_ROOT>/05-NightShift/inbox
```
- `AppConfig += github: { token?: string }`、`nightshift: { dir: <vaultRoot>/05-NightShift }`。
- 白名单在写盘时**惰性读** `runner-settings.json`，不进 env。

## 12. 错误处理与降级

- GitHub 搜索失败/无候选 → `searching` 阶段中止并经 SSE `error` 回前端（不让后续无候选起草）。
- 缺 `GITHUB_TOKEN` → 匿名搜索，正常工作（仅限速更低）。
- 读不到 `runner-settings.json` → workdir 校验降级为「自由输入 + 警告」，不阻断。
- workdir 不在白名单 → 写盘前**拒绝**并提示（避免夜里被权限层拒、白写）。
- slug 以 `_` 开头或冲突 → 自动修正（去前导 `_` / 加后缀）。

## 13. 测试策略

- **单元**：`GitHubRunner`（mock fetch，映射字段 + 鉴权头）；`buildGithubProposePrompt`/`buildIssueDraftPrompt`；`vault/nightshift` 渲染 + 白名单校验 + `_` 前缀拒绝 + 冲突后缀 + 路径安全。
- **状态机**：`startRun(mode=github_issue)` 提案、`runIssueSearch`→`awaiting_pick`、`draftIssue`→`awaiting_deposit`、`depositRun` 的 mode 分派（mock store/bus）。
- **回归**：现有 123 测试全绿（报告流行为不变）；`mode` 缺省回退 `report` 的兼容性测试。
- 真实 GitHub API / 真实写收件箱仅做手动冒烟，不入自动化。

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 误写到收件箱外 / 覆盖已有 issue | 路径断言 ∈ inbox；冲突加后缀；原子写 |
| workdir 写了白名单外 → 夜里被拒白跑 | 写盘前校验 ∈ `additionalDirectories` |
| 上下文太简 → 夜里跑偏 | 起草 prompt 强制「自包含」，把 repo/workdir/约束写进正文 |
| GitHub 匿名限速 | 支持可选 `GITHUB_TOKEN`；per_page 控量；失败优雅降级 |
| `+page.svelte` 膨胀过 500 行 | 抽 `IssueMode.svelte` 组件 |
| 给报告流引入回归 | 尾部走新函数、`depositRun` 仅加 mode 分派；mode 默认 report |

## 15. 已定决策（2026-06-25 brainstorming 确认）

1. **「讨论→出 issue」放在哪**：**全在 App 内·结构化**（非对话式、非 Claude 端）。讨论 = 挑选 + 字段编辑 + 单次「按批注重写」。
2. **issue 类型**：**code 为主·集成/动手**（v1 固定 `type=code`，需 `workdir`，UI 采集 workdir/push/network）。
3. **架构落法**：**现有 `Run` 加 `mode` 标志**（②）——共用骨架，尾部走同级新函数；报告流行为不变。
4. **写盘**：plain 原子写入 `05-NightShift/inbox/`，**不走** `assertCleanVault`/autocommit（对齐 `/nightshift-issue` skill；顺带绕开报告 deposit 的 Blockers B/C）。

## 16. 里程碑（v1）

1. 数据模型：`Run.mode` + `awaiting_pick` + `SourceResult` repo 字段 + `NightShiftIssue`（`runs/types.ts`），向后兼容。
2. `GitHubRunner`（`search/github.ts`）+ 单测。
3. `config.ts` 增 `github`/`nightshift` + `deps.ts` 注册 `runners.github`。
4. 状态机：`startRun` mode 分支 + `runIssueSearch` + `draftIssue`（+ `pipeline/issue-draft.ts`）。
5. 写盘：`vault/nightshift.ts`（白名单校验 + 安全写）+ `depositRun` mode 分派 + 单测。
6. 路由：`/api/run` 加 mode、`/plan` 分派、新增 `/pick`（+ 可选 `/redraft`）、`/deposit` 分派。
7. UI：模式切换 + `IssueMode.svelte`（候选挑选 + 字段 + 草稿编辑 + 写入）。
8. 测试（§13）全绿 + 手动端到端冒烟（搜真实 repo → 起草 → 写一条 issue 到 inbox）。

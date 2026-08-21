[English](./README.md) | 简体中文

![Replay Lab 证据摘要：使用带精确数值标签的条形图比较观察基线与所有已保存回放运行](./assets/replay-run-detail.png)

# DSH Replay Lab（ReplayLab）

**DSH Replay Lab - DeepSeek Harness 请求面重放与 A/B 实验插件：冻结 turn、隔离候选 session、对比 Request Surface/轨迹/成本**

**回放请求面，而不只是提示词。**

`dsh-replay-lab` 是一个 DeepSeek Harness 插件，可使用不同 preset 或
plugin 重新运行已完成的 Agent turn，并比较它们的请求面、轨迹、成本、错误和结果。

它适合复现和调试冗长的 Agent 轨迹、重复工具调用循环、无进展 turn，以及由 preset
或 plugin 差异引发的回归。

冻结一个已完成的 DeepSeek Harness turn，明确批准一个隔离候选项，然后比较结果、
轨迹、错误、成本，以及产生这些行为的请求面。源 session 和源 workspace 永远不会
被重写或回滚；候选文件变更会在运行后恢复到 replay checkpoint，同时保留持久
session 事件与对比证据。

[安装](#安装) · [验证](#验证) · [安全](./SECURITY.md) ·
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![DeepSeek Harness plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-111827)

## 为什么需要 Replay Lab

### 问：最初观察到的问题是什么？

V4 Pro 在不同的 harness 请求面下，可能表现出明显不同的推理方式和执行轨迹。

在一些已观测的运行中，推理呈现被动响应、逐步探索的模式：

```text
Let me check...
Let me try...
Let me inspect another file...
```

另一些运行则呈现更偏向共同规划的模式：

```text
We need to locate...
We should verify...
We can test this assumption...
```

这些短语可以用来描述已观察到的轨迹，但它们不是能力评分。`we` 不能证明一次运行
更聪明，`let me` 也不能证明模型发生了退化。

真正重要的观察更为有限：使用相同产品标签的模型，在外围 harness 构造出不同请求时，
可能走出明显不同的执行路径。

### 问：我们知道究竟是哪个变量造成了差异吗？

不知道。现有观察尚未隔离出一个普遍成立的单一原因。

Harness 可能同时改变多个变量：

- system prompt 和 persona；
- 模型能够看到哪些工具 schema；
- 这些 schema 的描述有多冗长；
- skills、仓库指令和运行时上下文；
- 会话历史和工具调用历史；
- reasoning 配置和输出 token 预算；
- provider 请求的组装方式。

Persona 可能有影响，工具暴露方式也可能有影响；二者的交互同样可能有影响。Token
预算或注入的 skills 也可能改变轨迹。不同任务、语言、模型变体和样本量会带来更多
不确定性。

因此，更有用的工作假设并不只是“prompt 变了”或“模型变了”，而是：

> **观察到的 Agent 行为由 Model × Harness 的组合共同产生。**

Replay Lab 的目的，是研究这个组合，而不是假装一次比较已经证明了因果机制。

### 问：`xiaobright/modeltest` 发现了什么？

[xiaobright/modeltest](https://github.com/xiaobright/modeltest) 比较了 V4 Pro
在不同 harness 配置下的表现，并报告了特定任务中的轨迹风格和结果差异。这项工作
帮助人们把对模型行为的非正式抱怨，转化为一个可以测试的 harness 问题。

它也揭示了 DSH 中一个实际的权衡：

| 方案 | 请求面策略 | 权衡 |
| --- | --- | --- |
| **Minimal** | 以较小的 persona 和工具面开始 | 缩小首个请求的请求面，但也缺少更广泛的 DSH 能力 |
| **Standard** | 一开始就暴露更完整的 DSH 请求面 | 保留完整能力集，但部分已观测运行更长或更偏探索 |
| **Anchored Standard** | 先使用类似 Minimal 的请求面，再恢复更广泛的能力 | 保留分阶段暴露假设，但引入 promotion 时机及其他实现变量 |

随后出现的
[Anchored Standard](https://github.com/xiaobright/dsh-anchored-standard)
preset 是一个两阶段社区 workaround：它先使用较窄的 bootstrap 请求，随后把 Agent
promote 到更广泛的能力面。

Anchored Standard 是重要的动机证据，也是 Replay Lab 中一个有用的候选项。但它
不能证明分阶段暴露总能改善 V4 Pro，不能证明 Standard 普遍更差，也不能证明某个
特定工具或 persona 造成了报告中的差异。

这些比较仍然保留了重要的混杂变量，包括 `maxTokens`、skill 目录注入、persona、
schema 冗长度、任务选择、较小样本量，以及没有呈现相同结果模式的 V4 Flash 结果。

### 问：什么是 Request Surface（请求面）？

先从工具和 preset 退后一步，问一个最简单的问题：

> **模型的行为到底由什么决定？**

我们很容易把一次 Agent 请求想象成：

```text
用户 prompt → 模型 → 输出
```

实际请求更接近：

```text
用户 prompt
+ system prompt 和 persona
+ 模型可见的工具 schema
+ 会话历史和工具调用历史
+ reasoning 配置
+ token 预算
+ preset 或 plugin 注入的 skills 与运行时上下文
────────────────────────────────────────────────
= Request Surface（请求面）
          ↓
         模型
          ↓
      执行轨迹与输出
```

**Request Surface（请求面）是模型开始生成前实际收到的全部输入。**

用户 prompt 只是请求面的一部分，而不是请求面的全部。

### 问：preset、plugin 和 configuration 会怎样影响请求面？

**Preset** 会组装一套 Agent 配置，例如 persona、工具和运行时行为。**Plugin** 可以
添加工具、上下文或请求 hook。**Configuration** 负责选择和参数化这些组件，包括
模型设置和预算。

因此，更换 preset 或 plugin 可能形成这样的链条：

```text
更换 preset 或 plugin
  → persona、工具、上下文、历史或预算可能发生变化
  → 实际生效的 Request Surface 发生变化
  → 模型可能进入不同的执行轨迹
  → 只检查用户 prompt，可能会得到不完整的诊断
```

这就是为什么 `Minimal`、`Standard` 或 `Anchored Standard` 这样的 preset 名称
不足以构成实验性证据。名称描述的是预期配置；实际请求证据描述的则是发往 provider
的请求中真正出现了什么。

### 问：为什么普通的前后对比很困难？

两个独立创建的 session，差异可能不只在被测试的 preset。Prompt 可能有细微变化，
workspace 可能已经继续演进，注入的上下文可能不同，provider 设置和 token 预算也
可能已经不再一致。

如果缺少共同的 case 和 provenance 边界，对比通常会变成：

```text
更换 preset
  → 行为发生变化
  → 检查两个关联边界松散的 session
  → 猜测究竟是哪项差异产生了影响
```

这种比较可以产生有价值的假设，但不足以支撑强因果主张。

### 问：Replay Lab 实际 replay 的是什么？

Replay Lab 从一个真实、已完成的 DSH turn 开始。这个已完成的源 turn 成为已观测
baseline；Replay Lab 不会再次执行 baseline。

对于一次经过批准的实验，它会：

```text
选择一个已完成的 DSH turn
  → 冻结 replay case 和 provenance
  → 若存在，则使用 turn 开始时捕获的 workspace checkpoint
  → 选择一个 preset 或 Agent-scoped plugin 候选项
  → 要求明确批准
  → 创建一个隔离的候选 session
  → 在隔离 workspace 副本中重新执行该 turn 的 prompt
  → 在终态边界把候选文件恢复到 checkpoint
  → 记录候选项实际生效的请求证据和执行指标
  → 将候选项与已观测 baseline 进行比较
```

这是对同一个已完成任务/turn 的一次新候选执行，而不是播放此前记录的文本。

### 问：这里的“freeze（冻结）”是什么意思？

Freeze 并不意味着 Replay Lab 会存储并重新发送旧 provider 请求的逐字节副本。

它意味着 Replay Lab 会创建一个稳定的 replay case，其中包含所选 turn 的身份、
prompt 及其 hash、provider、model、reasoning 设置、`maxTokens`、已观测 preset
标签、system 和 tool-schema 指纹、baseline 证据、源 workspace 路径，以及冻结时的
workspace hash。

对于插件实时观察到的 turn，Replay Lab 会尝试在 `turn/start` 捕获 workspace，
包括 dirty 和 untracked 文件。Git 源使用内部 commit/tree 和 detached worktree；
非 Git 源使用彼此分离的文件快照，不会自动执行 `git init`。候选项从该 checkpoint
物化。如果历史 turn-start checkpoint 不可用，当前实现会退回为源 workspace 当前
状态创建隔离 checkpoint，并记录 capture provenance；这种运行属于 post-turn-state
rerun，而不是严格的 S0 replay。

这个措辞很重要：Replay Lab 冻结的是 case 和 provenance，随后记录并比较已观测的
请求面证据。它不会声称把完整的旧 Request Surface 冻结成一个可重复使用的 payload。

### 问：为什么需要明确批准和隔离 workspace？

规划候选项本身是只读操作。明确批准是一条授权边界：它允许一个已选择的候选实验
调用模型，并执行该候选项可用的工具。

候选项在经过验证的 workspace 副本中运行，而不会重写源 session，也不会直接在
源 workspace 中执行。路径包含性保护会把候选项和 subagent 的结构化文件操作限制
在该副本内。成功、失败或 abort 都会保留持久 session 证据，并把候选文件恢复到
checkpoint。源 workspace 永远不会成为 rollback 或 cleanup 目标。

同一个源 turn 可以保留多个实验，但每次批准只授权一次候选运行。

### 问：Replay Lab 会比较哪些证据？

Replay Lab 把已完成的源 turn 保留为独立观测的 baseline 证据。对于候选项，它会从
持久化的 `request/header` 事件中恢复发往 provider 的请求证据，包括：

- provider、model、reasoning 设置，以及存在时的 `maxTokens`；
- 请求阶段；
- system prompt 指纹；
- tool schema 指纹；
- 模型可见的工具名称；
- workspace 的来源、执行位置和 drift provenance。

当 baseline 和候选项都包含完整且相互独立的运行证据时，Replay Lab 会为以下指标
生成 baseline/candidate/delta 评分卡：

- fresh input tokens；
- output tokens；
- cache-read tokens；
- 耗时；
- step 数量；
- 工具调用数量。

评分卡衡量的是记录到的执行特征。它不是智能评分，不是正确性 evaluator，目前也
不是货币成本计算器。

### 问：Replay Lab 能得出什么结论？

Replay Lab 可以展示：

- 哪个已完成 turn 被用作 baseline；
- 运行了哪个候选 preset 或 plugin；
- 源 workspace 是否发生 drift；
- 记录到了哪些实际生效的候选请求证据；
- 独立记录的执行指标发生了怎样的变化；
- 证据是否不完整，而不是静默填补缺口。

Replay Lab 无法通过一次 rerun 证明：

- 是哪个单独的请求面变量造成了差异；
- `we` 或 `let me` 等措辞能够衡量能力；
- V4 Pro 在 Standard 下会普遍退化；
- Minimal 或 Anchored Standard 会普遍提升智能；
- 一个任务的结果能够泛化到其他模型、语言、provider 或 harness；
- 模型的私有内部路由或训练机制如何运作。

目标不是把一个 workaround 变成普遍理论，而是让 Model × Harness 比较变得更窄、
可重复、具备 provenance，并诚实说明现有证据究竟能够证明什么。

## 功能

```text
已完成的 DSH turn
  → 冻结已记录的请求面和 workspace fixture
  → 选择 Standard / Minimal / Anchored / plugin 候选项
  → 人工明确批准
  → checkpoint → 运行一个隔离的候选 session → 恢复候选文件
  → 比较结果、steps、工具调用、tokens、错误和请求面差异
```

- 在每个 session 的 Conversation 和 Trajectory 旁增加一个 **Replay** 标签页。
- 使用持久化 session projection 构建行，而不是依赖分页聊天节点。
- 冻结 prompt、workspace hash、model、reasoning、max tokens、preset/plugin 请求面、
  system hash 和 tool-schema hash。
- host event 到达时捕获实时 turn-start workspace 状态；保持已观测的源 turn 不变，
  只有候选项会执行。
- 在经过验证的 workspace 副本中运行候选项，并使用路径包含性保护；源 session 和
  源 workspace 永远不会被重写或回滚。
- 在终态边界恢复候选文件，同时保留持久事件、checkpoint hash、provenance 和对比证据。
- host 重启后恢复带 checkpoint 的持久候选 workspace；当源/候选边界不分离时拒绝 cleanup。
- 历史 turn-start checkpoint 不可用时，退回为带 provenance 标记的当前状态隔离
  checkpoint；这不是严格的 S0 replay。
- 只使用独立记录的证据生成评分卡。
- 拒绝不受支持的 host-plane 变更和不完整变体。

## Replay 证据

顶部的运行详情截图比较观察基线与每个已保存的回放运行。每项指标独立缩放，并保留
精确记录值；步骤数和工具调用数描述执行活动，不代表结果质量。下面的截图展示语言
信号在 session chat 的 thinking 行中实际出现的位置，而不是重新生成的计数标签。

![Anchored Standard session chat：thinking 行中真实的 Let's 和 We 已被框出](./assets/replay-thinking-anchored.png)

*Anchored Standard：实际出现的 `let's` 和 `we`。*

![Standard replay session chat：thinking 行中真实的 Let me 已被框出](./assets/replay-thinking-standard.png)

*Standard replay：实际出现的 `let me`。*

这些短语是轨迹描述符，不是能力指标。

## 安装

需要 DeepSeek Harness `0.1.0-rc.6`、Node.js 22.19+ 或 24+，以及 pnpm。
从 npm 安装固定版本 `v0.1.3` 的组织包：

```sh
dsh plugin --profile web add @webwalkerhq/dsh-replay-lab@0.1.3
```

也可以使用相同版本的不可变 GitHub 源码 tag：

```sh
dsh plugin --profile web add github:tbxy09/dsh-replay-lab#v0.1.3
```

安装后重启 Web profile：

```sh
dsh web
```

Bundle 会把 `@webwalkerhq/dsh-replay-lab` 挂载到 `/replay-lab-dsh`，并将其
client module 注入 Web profile。

### 启用 Anchored Standard

[Anchored Standard](https://github.com/xiaobright/dsh-anchored-standard) 是
DSH preset，而不是 plugin package。请把它复制到 Replay Lab 使用的同一个
`DSH_HOME` 下；不要使用 `dsh plugin add` 安装。

```sh
git clone --depth 1 https://github.com/xiaobright/dsh-anchored-standard.git
dsh_home="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$dsh_home/.agent-presets"
test ! -e "$dsh_home/.agent-presets/anchored-standard"
cp -R dsh-anchored-standard/preset "$dsh_home/.agent-presets/anchored-standard"
```

完全重启 DSH，创建一个新的空白 session，然后选择
`Anchored Standard (experimental)`。不要把已经活跃的 session 从其他 preset
切换过来。当 `anchored-standard` 无法解析时，Replay Lab 会把 Anchored 候选项
标记为不可用。

## 配置

安装后的 bundle 包含以下 baseline：

```yaml
- insert:
    - id: replay-lab-dsh
      name: '@webwalkerhq/dsh-replay-lab'
      config:
        routeBase: /replay-lab-dsh
        historyFixture: ./node_modules/@webwalkerhq/dsh-replay-lab/fixtures/history-turns.json
        workspaceFixture: ./node_modules/@webwalkerhq/dsh-replay-lab/fixtures/workspace
        stateFile: ./.tmp/state.json
        artifactDirectory: ./.tmp/artifacts
        provider: replay-lab-fake
        fakeAdapter: false
```

在 `0.1.x` 中请保持 `routeBase` 为 `/replay-lab-dsh`。仅在确定性离线验证时设置
`fakeAdapter: true`；正常运行使用 profile 的 provider。

## 许可证

[MIT](./LICENSE)

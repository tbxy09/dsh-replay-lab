[English](./README.md) | 简体中文

![Replay Lab 运行详情：展示 Anchored Standard、请求阶段、工具面和完整评分卡](./assets/replay-run-detail.png)

# DSH Replay Lab（ReplayLab）

**回放完整请求面，而不只是提示词。**

`dsh-replay-lab` 是一个 DeepSeek Harness 插件，可使用不同 preset 或
plugin 回放已完成的 Agent turn，并比较它们的请求面、轨迹、成本、错误和结果。

它适合复现和调试长 Agent 轨迹、重复工具调用循环、无进展轮次，以及由 preset
或 plugin 差异引发的回归。

冻结一个已完成的 DeepSeek Harness turn，明确批准一个隔离候选项，然后比较其
结果、轨迹、错误、成本和产生这些行为的请求面。

[安装](#安装) · [验证](#验证) · [安全](./SECURITY.md) ·
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![DeepSeek Harness plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-111827)

## 为什么需要 Replay Lab

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 让 Agent
运行时具备可编程能力，但修改 preset 或 plugin 也会改变模型实际看到的内容。
Replay Lab 让请求面变得可观察、可测试，而不是把所有行为变化都归因于提示词。

这条能力谱系包含五个相互衔接的阶段：

1. **请求面成为变量。** 较长的工具和上下文历史会产生可观察故障，例如
   [工具调用退化为普通文本](https://github.com/deepseek-ai/DeepSeek-V3/issues/1244)
   和[工具结果之后返回空响应](https://github.com/deepseek-ai/DeepSeek-V3/issues/1453)。
2. **窄工具面和宽工具面可以比较。** DSH 的
   [Minimal](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/config/agent-presets/minimal/agent.cordis.yml)
   与
   [Standard](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/config/agent-presets/standard/agent.cordis.yml)
   preset 暴露不同工具和运行时指导；
   [modeltest](https://github.com/xiaobright/modeltest) 则把“模型 × harness”组合
   作为实验对象。
3. **能力暴露时机变得明确。**
   [Anchored Standard](https://github.com/xiaobright/dsh-anchored-standard)
   把类似 Minimal 的 bootstrap 与后续 Standard promotion 分开。因此，schema、
   注入上下文、token budget、promotion 时机及 Agent/session 作用域成为独立证据字段；
   其他运行时的
   [per-request tool visibility](https://github.com/Kohaku-Lab/KohakuTerrarium/pull/163)
   工作进一步强化了这个边界。
4. **一次性比较可以回放。** Replay Lab 冻结提示词、workspace、模型设置、哈希和
   工具面，以便对
   [循环和无进展行为](https://github.com/deepseek-ai/deepseek-harness/discussions/1742)
   做受控诊断；随后只执行一个经过批准的候选项，不重写源 session。
5. **回放具备治理边界。** 明确批准、隔离 workspace、终态记录、独立证据和
   fail-closed 变体让每次实验都可审计、可逆。

简而言之：**请求面 → 可观察轨迹 → 分阶段暴露 → 受控回放 → 受治理的回归验证。**
这支持行为路由假设，但不能证明 DeepSeek 私有的内部路由机制。证据使用 mdview
捕获；公开主张直接链接到原始来源。

## 功能

```text
已完成的 DSH turn
  → 冻结记录的请求面和 workspace fixture
  → 选择 Standard / Minimal / Anchored / plugin 候选项
  → 人工明确批准
  → 运行一个隔离候选 session
  → 比较结果、steps、工具调用、tokens、错误和请求面差异
```

- 在每个 session 的 Conversation 和 Trajectory 旁增加一个 **Replay** 标签页。
- 使用持久 session projection 构造行，而不是依赖分页聊天节点。
- 冻结提示词、workspace hash、模型、reasoning、max tokens、preset/plugin 请求面、
  system hash 和 tool-schema hash。
- 保持观测到的源 turn 不变；只有候选项会执行。
- 在经过验证的 workspace 副本中运行候选项，并执行路径包含性保护。
- 如果源 workspace 在冻结后变化，则从当前状态的隔离副本运行，同时记录两个 hash
  作为 workspace drift provenance。
- 只使用独立记录的证据生成评分卡。
- 拒绝不受支持的 host-plane 变更和不完整变体。

## 回放证据

顶部运行详情截图展示完整的 baseline/candidate/delta 评分卡。以下截图展示语言信号
在 session chat 的 thinking 行中实际出现的位置，而不是重新生成的计数标签。

![Anchored Standard session chat：thinking 行中真实的 Let's 和 We 已被框出](./assets/replay-thinking-anchored.png)

*Anchored Standard：实际出现的 `let's` 和 `we`。*

![Standard replay session chat：thinking 行中真实的 Let me 已被框出](./assets/replay-thinking-standard.png)

*Standard replay：实际出现的 `let me`。*

这些短语只是轨迹描述符，不是能力指标。

## 安装

需要 DeepSeek Harness `0.1.0-rc.6`、Node.js 22.19+ 或 24+，以及 pnpm。
`v0.1.0` 保持不可变。当前 GitHub 源码 release 为 `v0.1.1`；两个 release
都没有发布到 npm。

```sh
dsh plugin --profile web add github:tbxy09/dsh-replay-lab#v0.1.1
```

安装后重启 Web profile：

```sh
dsh web
```

bundle 会把 `@tbxy09/dsh-replay-lab` 挂载到 `/replay-lab-dsh`，并将其
client module 注入 Web profile。

### 启用 Anchored Standard

[Anchored Standard](https://github.com/xiaobright/dsh-anchored-standard) 是
DSH preset，不是 plugin package。请把它复制到 Replay Lab 所使用的同一个
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
      name: '@tbxy09/dsh-replay-lab'
      config:
        routeBase: /replay-lab-dsh
        historyFixture: ./node_modules/@tbxy09/dsh-replay-lab/fixtures/history-turns.json
        workspaceFixture: ./node_modules/@tbxy09/dsh-replay-lab/fixtures/workspace
        stateFile: ./.tmp/state.json
        artifactDirectory: ./.tmp/artifacts
        provider: replay-lab-fake
        fakeAdapter: false
```

在 `0.1.x` 中保持 `routeBase` 为 `/replay-lab-dsh`。仅在确定性离线验证时设置
`fakeAdapter: true`；正常运行使用 profile 的 provider。

## 候选项边界

`v0.1.1` 支持：

- Standard、Minimal 和 Anchored Standard presets
- Agent-scoped preset/request-hook plugins

`v0.1.1` 拒绝：

- 替换 provider 或 session store
- 替换 sandbox provider 或 host singleton
- 缺少独立记录证据的变体

## 验证

```sh
pnpm install --frozen-lockfile
pnpm run verify
pnpm run pack:check
```

测试覆盖 freeze/approval/run 状态转换、持久 projection history、独立评分卡、
未变化和发生 drift 的 workspace provenance、workspace containment，以及
fail-closed 变体。CI 在 macOS 和 Linux 上使用 Node 22.19 与 24 运行同一验证门。

## 安全与证据边界

- 候选项执行需要明确批准，并使用隔离副本。
- Workspace drift 不会阻止执行：已完成的 run 和评分卡会标明候选项使用了当前源状态，
  因而不是严格受控比较。副本完整性和 containment 检查仍会 fail closed。
- 当来自候选项或 subagent 的结构化路径逃出隔离副本时会被拒绝，包括通过 symlink
  逃逸的情况。
- Web client 只与 plugin Host API 通信；它不会直接读取文件或调用模型 provider。
- Replay artifact 可能包含提示词、路径、输出和成本数据。分享前请检查，并通过 GitHub
  私密报告流程提交漏洞；参见 [SECURITY.md](./SECURITY.md)。
- `we`、`let's`、`let me` 等短语是不稳定的语言指纹，不是能力指标。

## 许可证

[MIT](./LICENSE)

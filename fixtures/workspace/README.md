# Replay Lab fixture workspace 说明

此目录只用于 legacy fixture case source，为冻结 fixture replay case 提供稳定的 `sourceWorkspaceHash`。

- `task.txt`：一个最小说明文件，保证目录非空且哈希稳定。
- per-session replay 不使用此目录；它从 durable `session.header.cwd` 解析来源 workspace。
- fixture case 中，此目录会被 `hashDirectory()` 递归哈希后写入 `FrozenReplayCase.sourceWorkspaceHash`。
- runner 创建全新实验 session 时，只把该目录路径作为 `meta.cwd` 传入，绝不写回此目录。

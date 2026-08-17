# DSH 控制台

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面控制台：启停 `dsh`、管理多份 `$DSH_HOME`、从精选目录装插件。只调用你本机已有的 `dsh` CLI。界面为中文。

## 运行

需要 Node 22+、Rust、[pnpm](https://pnpm.io/)，以及一份能用的 `dsh`（在 `PATH` 上，或在设置里指向已构建的 harness checkout）。

```sh
pnpm install
pnpm tauri dev
```

## 说明

- 关窗口只是隐藏；托盘「退出」才会停掉本应用拉起的全部进程。
- 插件来源：[awesome-dsh-plugin](https://awesome-dsh-plugin.com/)。
- 配置在系统应用目录（Windows 下是 `%APPDATA%\dsh-console\`），不写进某个 `DSH_HOME`。

## 开发

规格见 [docs/spec.md](docs/spec.md)。给 Agent 的红线见 [AGENTS.md](AGENTS.md)。

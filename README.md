# DSH Console

English | [Chinese](README_zh.md)

Desktop console for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): start and stop `dsh`, manage multiple `$DSH_HOME` instances, install plugins from the curated catalog. It only spawns the `dsh` CLI you already have. The app UI is Chinese.

## Run

Needs Node 22+, Rust, [pnpm](https://pnpm.io/), and a working `dsh` (on `PATH`, or a built harness checkout in Settings).

```sh
pnpm install
pnpm tauri dev
```

## Notes

- Closing the window hides the console; tray **Quit** stops every process this app started.
- Plugins come from [awesome-dsh-plugin](https://awesome-dsh-plugin.com/).
- Config lives under the OS app-data dir (`%APPDATA%\dsh-console\` on Windows), not inside a `DSH_HOME`.

## Development

Spec (Chinese): [docs/spec.md](docs/spec.md). Agent guidelines (Chinese): [AGENTS.md](AGENTS.md).

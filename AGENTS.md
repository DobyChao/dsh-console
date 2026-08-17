# AGENTS.md — dsh 控制台

DeepSeek Harness 的**旁路桌面控制台**：启停 `dsh`、多 `DSH_HOME` 实例、按社区目录安装 profile bundle。不是 harness 本体，也不嵌聊天 UI。

**先读 [docs/spec.md](docs/spec.md)。** 那是完整产品规格、CLI 契约、UI、插件获取规则、实现顺序和当前进度。本文件只放站着的红线。

## 红线

- **禁止** import `@deepseek-ai/dsh-*`。只 spawn 已安装 / PATH / 源码 checkout 的 `dsh` CLI，以及读磁盘上的 `$DSH_HOME`。
- 前端 **不能** 任意 exec。进程、探测、plugin/dump-config 全部走 Rust `#[tauri::command]`。
- 打开 Web UI 只用系统浏览器（`tauri-plugin-opener`）。**不要** WebView / BrowserView 加载 `dsh web`。
- 视觉跟 dsh Web 同一家族，但 token **手抄**进本仓库；不要依赖 `dsh-client-ui-theme`。
- Tailwind CSS v4 + `clsx`。token 经 `@theme inline` 接到 `bg-ds` / `text-label` 等工具类。页面仍可保留 CSS Modules。不加组件库。
- 中文 UI。窗口标题「dsh 控制台」。不抄鲸标。口语不要直接上屏（例如不要写「OK / 不OK」）。
- 三栏布局跟 hybrid B+D：80px 图标轨（图标 + 中文标签）、运行页 220px 实例列、主区白卡。选中浅蓝/白底 + 左侧 DeepSeek 蓝条，主按钮近黑。
- Windows 原生标题栏（不 frameless）。关窗口只隐藏；托盘「退出」才停掉本控制台拉起的全部子进程。

## 本仓库 vs harness

| 路径 | 角色 |
|---|---|
| 本仓库（包名 `dsh-console`；本地目录可能仍叫 `dsh-launcher`） | 要改的代码 |
| `G:\AI\deepseek-harness` | **只读参考**：CLI 契约、token 色值、文档。不要往那边提 PR 来做控制台 |

token 色值抄自 harness 的 `packages/client/ui-theme/src/styles/design-platform.css`。

## 命令

```sh
pnpm install
pnpm tauri dev
```

网页预览（给浏览器 / 代理看 UI）：

```sh
pnpm web
```

打开 [http://localhost:1420/](http://localhost:1420/)。**要测真实后端**请先 `pnpm tauri dev`：浏览器会连 `127.0.0.1:1422` 网页桥，启停走同一套 Rust。探测会重试，桥起来后刷新真数据，不要锁死 mock。只开 `pnpm web` 时顶栏会写「假数据」。

图标轨三页：运行 / 插件 / 设置（不要「资档」）。插件目录固定 awesome-dsh-plugin 精选源。

需要本机：Node 22+、Rust、pnpm、以及一份可用的 `dsh`（PATH 上的安装，或 harness checkout 且已 `pnpm run build`）。桌面窗口仍走 Tauri invoke。

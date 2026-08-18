# AGENTS.md — DSH 控制台

DeepSeek Harness 的旁路桌面控制台：启停 `dsh`、管理多个 `DSH_HOME` 实例、按社区精选目录安装 profile bundle。它不是 harness 本体，也不嵌入聊天 UI。

**动手前先读 [docs/spec.md](docs/spec.md)**。完整产品规格、CLI 契约、UI 与交互规范、插件获取规则、实现进度都在 spec 里；当前实现状态与近期改动见 [docs/progress.md](docs/progress.md)。本文件只列必须遵守的约束，不重复 spec 细节。布局、配色、三栏结构、状态点等视觉规范以 spec 的「窗口结构」「环境检查」章节为准，改动前先核对。

## 红线

- **禁止** import `@deepseek-ai/dsh-*`。与 harness 的交互只有两条路：spawn 已安装 / PATH / 源码 checkout 的 `dsh` CLI，以及读写磁盘上的 `$DSH_HOME`。
- 前端**不得**直接执行进程或探测系统。进程管理、环境探测、plugin / dump-config 等一律走 Rust `#[tauri::command]`，前端只 invoke。
- 打开 Web UI 一律用系统浏览器（`tauri-plugin-opener`）；不得用 WebView / BrowserView 加载 `dsh web`。
- 视觉与 dsh Web 同族，但设计 token 是**手抄**进本仓库的（`src/styles/tokens.css`），不得依赖 `dsh-client-ui-theme` 包。
- 技术栈固定：Tailwind CSS v4 + `clsx`，token 经 `@theme inline` 映射成工具类，页面布局可继续用 CSS Modules。基础按钮 / 输入 / 卡片收敛在 `src/components/Button.tsx`、`TextInput.tsx` 与 `src/styles/ui.module.css`，不要造平行实现。不引入组件库。
- 界面为中文，窗口标题「DSH 控制台」。上屏文案一律通过 `src/i18n` 字典取用（`t("key")`），组件内不得硬编码；后端返回的错误信息与 spec 要求原样展示的 dsh 消息除外。文案用书面中文，口语表述不上屏。不得使用 DeepSeek 鲸标。
- 状态与业务逻辑集中在 `src/lib/launcher.tsx`（LauncherProvider），页面通过 `useLauncher()` 取用；不要在页面里另起裸 `setState` + try/catch 的调用模式。
- Windows 原生标题栏（不 frameless）。关闭窗口仅隐藏；托盘「退出」才会终止本控制台拉起的全部子进程。

## 本仓库与 harness

| 路径 | 角色 |
|---|---|
| 本仓库（包名 `dsh-console`；本地目录可能仍叫 `dsh-launcher`） | 唯一要改的代码 |
| `G:\AI\deepseek-harness` | **只读参考**：CLI 契约、token 色值、文档。不要为控制台功能向 harness 提 PR |

token 色值抄自 harness 的 `packages/client/ui-theme/src/styles/design-platform.css`。

## 命令

```sh
pnpm install
pnpm tauri dev   # 桌面应用开发
pnpm web         # 浏览器预览，http://localhost:1420/
pnpm lint        # ESLint
pnpm test        # vitest 单测（src/lib 解析逻辑）
pnpm build       # tsc + vite 构建
```

浏览器预览说明：`pnpm web` 的页面会连接 `127.0.0.1:1422` 网页桥（由 `pnpm tauri dev` 的桌面进程提供），启停等操作与桌面端走同一套 Rust 命令；探测自动重试，桥可用后刷新为真实数据，桥不可用时降级为假数据并在顶栏标明。网页桥只接受白名单 Origin（localhost:1420 / tauri），无 Origin 的本机工具请求放行。

本机环境：Node 22+、Rust、pnpm，以及一份可用的 `dsh`（PATH 上的安装，或已 `pnpm run build` 的 harness checkout）。

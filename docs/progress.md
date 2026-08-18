# DSH 控制台 — 项目进度与交接备忘

> 更新时间:2026-08-17。本文记录当前实现状态、前端架构、已修复的关键问题和后续候选事项,供新会话快速接手。产品规格、CLI 契约、视觉规范以 [spec.md](spec.md) 为准,红线见 [AGENTS.md](../AGENTS.md)。

## 当前状态

- **v1 功能已全部按 spec 落地**,之后做了一轮前端大重构(状态层、i18n、基础组件、交互补全)并加固了网页桥。
- 已提交并推送 `origin/master`:最新两个提交为 `aa5b7ad`(重构)与 `ad3a12c`(品牌改名 + 配置目录迁移)。
- 验证基线:ESLint、tsc、vitest 34 个测试、`cargo test` 全部通过;桥的跨域行为经真实桌面进程 curl 验证。
- 配置目录:`%APPDATA%\dsh-console\`(从旧 `dev.dsh.console` 自动迁移改名)。

## 前端架构(重构后)

| 位置 | 职责 |
|---|---|
| `src/i18n/zh.ts` + `src/i18n/index.ts` | 全部上屏文案的扁平字典;`t(key, params)` 支持 `{name}` 插值,`useT()` 留了切 locale 的口子。以后国际化:新增 `en.ts`,改 `index.ts` 即可 |
| `src/lib/launcher.tsx` | **LauncherProvider**:全部业务状态与 action。`run(key, fn)` 统一 busy(前缀匹配 `isBusy`)/错误上报;`confirm(req)` 返回 Promise 的确认框(删除实例、卸载插件用);竞态防护 = invoke 请求序号丢弃过期响应 + `runtimes-changed` 事件时间戳不回退;页面一律 `useLauncher()` 取数,不再传裸 setState |
| `src/lib/api.ts` | backend 探测与降级(tauri / http / mock)。事件 hub:监听只注册本地,实际通道(tauri listen / **单条共享 EventSource** / mock 发射器)随 backend 切换自动重绑;mock 判定一次后不再重复探测(发现桥交给 2 秒轮询);错误一律 `throw new Error`(带 cause) |
| `src/components/Button.tsx` / `TextInput.tsx` / `Modal.tsx` / `ConfirmDialog.tsx` | 基础件唯一来源:variant + busy 转圈、invalid 红框、focus trap(Esc / Tab 循环 / 焦点还原)、确认对话框。样式收敛在 `src/styles/ui.module.css` |
| `src/lib/status.ts` | 状态 → i18n 文案映射(空闲/启动中/就绪/停止中/错误) |
| `src/lib/use-dismiss.ts` | 浮层外点 / Esc 关闭 hook(实例右键菜单、实例胶囊下拉用) |
| `src/lib/use-window-list.ts` | 定高列表窗口化 hook(插件目录用)。返回 `attach`(callback ref)/`onScroll`/`scrollToTop` 与 `first`/`last`/`totalHeight`/`offsetTop`。**必须传 `{ visible }`**:三页常驻,挂载时本页多半还是 `display:none`、量到的高度是 0,而 ResizeObserver 在 not-rendered → rendered 这一跳上不可靠(实测只靠它会永远停在 0、一屏只渲染 overscan 行),所以重新显示时用 layout effect 补一次测量。窗口缩放 / 实例列折叠不会触发重渲染,那部分仍交给 ResizeObserver;jsdom 没有 ResizeObserver,已做存在性判断 |

插件页(2026-08-18 重做):精选目录实测 **1200+ 条**,原先是「每条一张白卡 + 字母头像 + 两行描述 + 独占一行的 mono 仓库路径」,一屏只放得下 5 条、全量渲染堆出 1.8 万 DOM 节点、滚动条被拉到 15 万像素。现在改成:

- **定高紧凑行**(`ROW_HEIGHT = 56`,与 `.row` 的实际盒模型严格对齐:`8 + 20 + 1 + 18 + 8 + 1px 分隔线`)。去掉字母头像,名称 + 分类徽标同行、仓库路径推到行尾压成弱色 mono、描述压成一行。**改 `.row` 的 padding 必须同步改常量**,否则窗口化会错位。
- **窗口化**(`useWindowList`):只渲染视口 ± 6 行。一屏 11 条,DOM 从 1201 个 li 降到 17 个。
- **分类 chip 行**:横向可滚,标签取目录自带的 `categories` 映射(中文名来自远端数据,和插件名 / 描述同一性质),计数由 `catalogCategories()` 统计。spec 禁的是「精选 / 已验证 / 全部发现」这类**来源**筛,分类筛是另一根轴,已确认可加。
- **安装按钮降权**:默认描边,`.row:hover` / `:focus-visible` 才升为近黑主按钮——1200 个高对比黑块会盖过插件名本身。仓库图标按钮常驻但压到 `opacity .45`,悬停/聚焦转实。
- 整个目录装在**一张白卡**里、行间用发丝分隔线,而不是 1200 张独立描边卡片。
- 侧栏已装列表:`内置` 原先在 caption 与右侧标签各写一遍,现在只留右侧标签;caption 为空时不再渲染空行。

页面布局要点:`App.tsx` 里**三页常驻**,切页只切 `display`(内联样式,避免 Tailwind `flex` 类压过 `hidden`)——切插件 tab 不再重新拉目录。`RunPage` 日志贴底滚动(距底 <40px 才自动滚 + 「回到底部」浮钮),`visible` prop 处理重新显示时贴底。

## 已修复的关键问题(避免回退)

1. **桥 CORS 回归**:`http_bridge.rs` 的 `json_response` 必须把放行的 Origin 回显成 `Access-Control-Allow-Origin`(浏览器页面 localhost:1420 → 127.0.0.1:1422 是跨域,少了这个头 fetch 会被拦、探测永远失败落 mock)。已有单测 `cors_reflects_allowed_origin_only` 锁住。
2. **mock 模式重复探测**:原 `ensureBackend` 在 mock 下每次 invoke 重新空等 ~7 秒桥探测;现用 `mockSettled` 缓存判定,发现桥交给后台轮询。
3. **事件监听不随 backend 重绑**:监听方只注册本地 hub,通道在 kind 变化时解绑重绑——桥起来后实时日志才能到达网页端。
4. **清空日志被刷新复活**:新增 Rust `clear_logs` 命令,前端清空后端日志,刷新不再复活。
5. **invoke 响应与事件竞态**:慢的 invoke 响应不再覆盖更新的 runtimes 事件状态。
6. **pnpm 11**:`onlyBuiltDependencies` 从 package.json 迁到 `pnpm-workspace.yaml`(`allowBuilds: esbuild: true`),否则 esbuild 二进制装不上、vite 起不来。
7. **插件行分类胶囊被挤换行**:`.badge` 原先没有 `white-space: nowrap` / `flex-shrink: 0`，窄行里「记忆」一类两字标签会竖折并溢出胶囊。名称与仓库路径各自 `min-width: 0` 吸收收缩，胶囊保持固有宽度。
8. **CSS layer 次序倒挂(全站按钮/输入框/卡片失去样式)**:`ui.module.css` 包了一层 `@layer components` 压低优先级,但 CSS layer 的次序由首次出现的位置决定。`main.tsx` 原先先 `import App`(链式带出 `ui.module.css`)再 import `global.css`,于是 `components` 被登记在 `base` 之前,Tailwind preflight 的 `*{margin:0;padding:0;border:0}` 与 `button{background-color:transparent}` 反过来压掉 `.primary`/`.input`/`.card`/`.badge` 的填充、描边与内边距——表现为按钮变纯文字、搜索框没框、侧栏卡片内容贴边。修法:`global.css` 必须排在 `App` 之前 import(它的 `@import "tailwindcss"` 负责声明 layer 次序)。顺带删掉 `main.tsx` 里重复的 `tokens.css` import(global.css 已 @import),产物 CSS 从 64.9 kB 降到 46.6 kB。校验方式:构建产物里 `@layer` 首次出现次序应为 `properties → theme → base → components → utilities`。

## 测试与命令

```sh
pnpm lint   # ESLint 9 flat config(eslint.config.js)
pnpm test   # vitest:解析 31(catalog / install-target / install-reference)
            #        + jsdom 整树冒烟 5(src/__tests__/app-smoke.test.tsx)
pnpm build  # tsc + vite
cargo test  # src-tauri:桥 Origin/ACAO 单测 2 个
```

冒烟测试注意:jsdom 下会先探测网页桥再落 mock(首轮 ~7 秒,`testTimeout: 20000`);**跑前端测试时不要同时开着 `pnpm tauri dev`**,否则会连上真桥且 jsdom 没有 EventSource。桥在跑时那 5 个冒烟测试必然红,先停桥再判断是不是真回归——临时验证办法:加一份 setupFiles 把 `fetch` 里命中 `127.0.0.1:1422` 的请求打成 reject,逼回 mock。

## 已知限制与后续候选

- 本开发环境 IAB 浏览器面板起不来,未做人工视觉冒烟;桌面端(Tauri invoke 事件流、真实 dsh 启停)建议本地 `pnpm tauri dev` 复核一遍。
- 发现目录 / README 安装路径(`planFromReadme`、`fetch_discovery`、`fetch_readme`)按 spec 保留为参考实现,v1 UI 未接;接入前先读 spec「插件获取规则」。
- 未引入 Prettier(现有代码风格统一,如需可后续加);Rust 侧除桥外无测试。
- spec「明确不做」清单(updater、主题热切换、内嵌 Web UI 等)仍然不做。
- 网页桥安全:Origin 白名单已生效(localhost:1420 / tauri 放行,无 Origin 本机工具放行,其它 403);若未来加 token 方案,改 `http_bridge.rs` 的 `origin_of` 一带。

## 环境备忘

- Node 22+、Rust、pnpm;需要一份可用的 `dsh`(PATH 安装或已 `pnpm run build` 的 harness checkout)。
- `pnpm web` 要真实数据必须同时开 `pnpm tauri dev`(桥在 `127.0.0.1:1422`);只开 web 是假数据 + 顶栏提示,属预期。
- `G:\AI\deepseek-harness` 为只读参考(CLI 契约、token 色值),不向其提 PR。

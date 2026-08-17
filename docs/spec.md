# dsh 控制台 — 实现规格

给在本仓库开新会话的代理：按本文实现，不必回 harness 会话或改 Cursor plan 文件。

参考实现（只读，不要内嵌它们的 Web 插件）：

- harness CLI：`G:\AI\deepseek-harness\apps\cli`
- 精选目录规则：<https://github.com/dsh-market/dsh-market> 的 `src/sources.ts`（`installTargetFor`）
- 发现目录 + README 安装解析：<https://github.com/ZASENJC/dsh-plugins-store> 的 `src/lib/install-reference.ts`、`packages/dsh-plugin-store/src/installed-plugins.js`

---

## 现在做到哪了

产品功能已按本文落地：token 表、三页中文 UI（运行 / 插件 / 设置）、环境探测、进程监督（含 Windows `cmd` / 进程树 / 关窗隐藏 / 托盘退出杀进程）、精选插件目录与 add/remove/update。

本地开发：`pnpm install` 后 `pnpm tauri dev`。桌面窗走 Tauri invoke；浏览器打开 [http://localhost:1420/](http://localhost:1420/) 会连本机 `127.0.0.1:1422` 网页桥，**同一套 Rust 命令 / 真启停 dsh**。探测会重试；桥起来后要从假数据切到真状态，不要锁死 mock。只有一直连不上（例如只开了 `pnpm web`）才用内存假数据（顶栏会写明）。已经连上过后，桥短暂断开应报错，不要再偷偷换成「默认 / 实验室」。网页桥只绑 localhost。

---

## 产品是什么

独立桌面/托盘应用。第一版三块：

1. 启停焦点实例（主路径 profile `web`），看状态和日志；「打开 Web UI」只开系统浏览器。
2. 对焦点实例从精选目录安装 / 更新 / 卸载插件。
3. 环境探测与控制台级设置（dsh 路径、外观）。

明确不做：行级 Loader enable/disable、改 bash/agent-loop/web-search 配置、把 dsh Web 套进窗口、内嵌 dsh-market / dshmk 的 Web 插件、主题热切换、WebDAV、沙箱验证器、「刷新即可热加载」、headless 一次性任务、开机自启、updater（可后补）。

---

## 架构

```
前端 (React, Tailwind + CSS Modules)
  → invoke / event
Rust (std::process::Command + CREATE_NO_WINDOW)
  → 每次 spawn 都设子进程 env DSH_HOME = 该实例绝对路径
  → dsh --profile <p> --port <port>
  → dsh plugin --profile <p> <pnpm args>
  → dsh --profile <p> --dump-config
  → dsh -V / node -v / pnpm -v
系统浏览器 ← opener 打开 http(s)
配置文件 ← %APPDATA%/dev.dsh.console/ 下的 JSON
```

建议 Rust 拆分：

- `src-tauri/src/config.rs` — 读写启动器配置
- `src-tauri/src/process.rs` — Windows `cmd /D /C` 包装、超时 capture、进程树杀除
- `src-tauri/src/supervisor.rs` — 多实例 spawn、日志、home 锁、端口检查、就绪 URL
- `src-tauri/src/envcheck.rs` — Node / dsh / pnpm / 焦点 home
- `src-tauri/src/catalog.rs` — 拉两个目录 JSON、缓存到 app config、拉 GitHub README
- `src-tauri/src/lib.rs` — commands、托盘、关窗隐藏、退出时杀全部

前端建议：

```
src/styles/tokens.css          # 手抄补集 token
src/styles/tailwind-theme.css  # @theme inline 接到 Tailwind
src/styles/global.css
src/lib/types.ts
src/lib/api.ts                 # invoke 包装
src/lib/catalog.ts             # 合并去重、筛
src/lib/install-target.ts      # 精选 installTargetFor（抄 dsh-market sources.ts）
src/lib/install-reference.ts   # README 解析（抄 dsh-plugins-store，MIT）
src/components/IconRail.tsx
src/components/InstanceList.tsx
src/components/InstanceCapsule.tsx
src/components/AddInstanceDialog.tsx
src/pages/RunPage.tsx
src/pages/PluginsPage.tsx
src/pages/SettingsPage.tsx
src/App.tsx
```

serde 与前端一律 **camelCase**。

---

## 配置模型

存在启动器自己的 config，**不写进某个 DSH_HOME**。

```ts
type Appearance = 'light' | 'dark' | 'system'
type DshMode = 'path' | 'checkout'

interface Instance {
  id: string
  displayName: string
  dshHome: string   // 绝对路径
  port: number
  profile: string   // 默认 web
  cwd?: string
}

interface LauncherConfig {
  instances: Instance[]
  focusedId: string
  dshMode: DshMode
  dshPath?: string       // 空 = PATH 上的 dsh
  checkoutPath?: string  // pnpm --dir <checkout> dsh …
  appearance: Appearance
}
```

默认实例：显示名「默认」，home = `%USERPROFILE%\.dsh`（`dirs::home_dir()/.dsh`），端口 `3080`，profile `web`。

规范化后的 `dshHome` 在表里唯一（Windows 大小写不敏感，用 `dunce` 去掉 `\\?\`）。空文件夹合法。新实例端口建议 `max(已有)+1`，没有则 3080。

`DSH_HOME` 不是启动器进程的环境变量覆盖，而是**每个实例字段**；每一次 spawn（boot / plugin / dump / -V 若需要 home）都写入子进程环境。

---

## dsh CLI 契约（harness 只读对照）

| 动作 | argv | 说明 |
|---|---|---|
| 启动 | `dsh --profile <p> --port <port>` | `--port` 是 web 应用 flag，跟在 launcher flags 后面。`dsh web` 等价 `--profile web` |
| 版本 | `dsh -V` | 环境检查 |
| 装插件 | `dsh plugin --profile <p> add <spec>` | 相对路径必须先收成绝对路径再传 |
| 卸/更 | `remove` / `update` | 同上 |
| 已装 | `dsh plugin --profile <p> list --depth=0 --json` | 转发给 pnpm |
| 新建 profile | `dsh plugin --profile <name> list` | 无 `package.json` 时会 `initProfile` |
| 组合树 | `dsh --profile <p> --dump-config` | stdout YAML，启动器只展示 |

模板：`web` = base + web-app；`headless` = base + headless；**其它名字只有 base，没有 Web UI**。第一版实例一律 `web`，不在图标轨上单独做 profile 管理页。

内置 bundle：在 `dsh.profile.bundles` 里、**不在** `dependencies` 里。禁止卸载。

就绪：stdout 一行 `dsh web: http://127.0.0.1:<port>`，可选 `(LAN: …)`。Loader 结算后才打印。解析第一个 URL，供「打开 Web UI」。

停止：先温和结束，等 **5 秒**，再强杀**进程树**。Windows：`taskkill /PID <pid> /T`，超时后再 `/F`。Unix：进程组 SIGTERM → SIGKILL。退出启动器时停掉它拉起的全部实例。

锁：

- **按规范化 home，不按整机。** 同一 home 已有本启动器拉起的进程 → 拒绝。不同 home 可并行。
- 启动前：端口已被本启动器其它实例占用，或 `127.0.0.1:port` bind 失败 → 拒绝并说明（第二实例改端口，建议 3081）。

Windows spawn（硬性）：

- 不要让 Rust 直接 `Command::new("dsh")`（`.cmd` shim）。用 `cmd /D /C <bin> <args…>`，并设 `CREATE_NO_WINDOW`（`0x08000000`）。
- `pnpm`、`node` 同样走 cmd。
- checkout 模式：`cmd /D /C pnpm --dir <checkout> dsh --profile … --port …`
- git 依赖失败时 pnpm 会提 `allowBuilds`：把 stderr 原文展示出来，并加一句可行动提示（改 profile 目录的 `pnpm-workspace.yaml` / `package.json` pnpm.allowBuilds）。第一版不必自动改文件。
- `pnpm not found`：dsh 自己会写「install pnpm to manage profile plugins」。设置页对应行给同样提示。

---

## 环境检查

轨宽 80px，每项图标在上、中文标签在下。设置按钮正上方放环境摘要（勾 = 环境正常，三角警告 = 未就绪），标签写「环境」。Tooltip：正常时「环境正常」，否则第一项未就绪原因。点击 → 打开设置页并滚到环境区块。不要和实例进程状态点混用。

计入总状态（任一项未就绪 → 轨上警告）：

1. Node（`node -v`）
2. dsh（PATH / `dshPath` / checkout 的 `dsh -V`）
3. pnpm（`pnpm -v`）
4. 焦点实例 `DSH_HOME` 的**父路径**可访问。路径尚不存在但父目录在 → 正常（首次启动会建）。空目录正常。

不计入总状态：端口占用、git 是否在 PATH（设置里可多一行提示，缺了只影响 `github:` 安装）。

探测时机：控制台打开、改 dsh 路径/checkout、切焦点实例、设置页「重新检测」。**不轮询。**

设置页顶：清单（名称、**正常 / 未就绪**、版本或路径、一句怎么修）+「重新检测」。未就绪行可跳到对应设置控件。其下才是 dsh 二进制/checkout、外观。实例增删改以运行页左列为准；设置里可再列一份表，冲突以运行页为准。

外观：`light` / `dark` / `system`。暗色：`body[data-ds-dark-theme]`。品牌强调只用 DeepSeek 蓝 `rgb(65, 118, 230)`。主按钮用近黑/近白 `--dsw-alias-label-primary` 实心，蓝不当大面积填充。正文字号 14/22，卡片标题 15/600，说明 12。字体：`-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei'`；日志/YAML：`'JetBrains Mono', Consolas, 'Microsoft YaHei'`。圆角 12 / 8 / 胶囊 999。动效 200ms `cubic-bezier(0.4, 0, 0.2, 1)`，`prefers-reduced-motion` 关掉。

布局锚点：三栏 hybrid（80px 图标轨 | 220px 实例列 | 主区）。图标轨每项图标 + 中文标签。选中态是白底圆角 + 左侧 DeepSeek 蓝条，不是蓝描边环。运行页主区是两张白卡：「运行」卡只有状态（点 + 文案）和可点地址；日志卡标题「日志」、右上蓝字「清空」。实例列标题「实例」，行内名左端口右、路径在名下，底部分隔线 + 居中「+ 添加实例」。profile / 端口 / home 细节放在实例列，不要再堆进运行状态卡。

---

## 窗口结构

最左 **80px 图标轨**：运行 / 插件；底钉环境 + 设置。图标在上、标签在下。选中白底圆角，左侧 DeepSeek 蓝条，图标与字用蓝。不要「资档」页。

**运行页**另出 **220px 实例列**（绿/灰状态点、名、路径、端口）。底「+ 添加实例」，不要虚线框。只在运行页出现；可折叠，折上后主区出现「显示实例」。切焦点 **不** 停止其它进程。添加实例对话框：说明 + Home 目录（浏览，可自动带出显示名）+ 显示名 + 端口。

插件 / 设置：无实例列。顶栏一条实例胶囊（名 · 端口 · 状态点），点击切换。

进程状态点：灰 idle / 琥珀 starting·stopping / 绿 ready / 红 error。托盘：任一实例 ready 为蓝点，否则灰。菜单：显示窗口、启动当前、停止当前、在浏览器中打开当前、退出（停全部）。

三页：

- **运行**：白卡「运行」+ 近黑「启动/停止」+ 描边「打开 Web UI」；行「状态」「地址」（地址是可点链接，不要「复制 URL」主按钮）；其下日志卡。
- **插件**：只拉精选目录；搜索；白卡列表一键安装；右侧已装卡 + 开发安装（本地绝对路径或手输 spec）与目录一键分开；层变且进程在跑 → 琥珀条「需重启」+ 重启按钮。不要「精选 / 已验证 / 全部发现」筛。
- **设置**：环境清单 + 控制台级 dsh/checkout/外观。实例表里 profile 列写「启动配置」。

---

## 插件获取（精选）

自己画插件页。目录固定 `https://awesome-dsh-plugin.com/plugins.json`。按 `owner/repo` 大小写不敏感去重。

| | 精选 `https://awesome-dsh-plugin.com/plugins.json` |
|---|---|
| 收录 | 人工 PR |
| 安装 spec | `installTargetFor`：合法 `npm` 用包名，否则 `github:owner/repo`（可 `#path:`） |
| 钉版本 | 一般不钉 |
| 信任 | 精选即 allowlist |

拉目录：

- 精选缓存约 1 小时；失败用上次成功文件（可放 `src-tauri` 或 app config）。不要在启动器里爬 GitHub topic。
- 建议 **Rust reqwest** 拉目录，避开 WebView CORS。
- 不处理 `http://127.0.0.1:<port>/#dsh-plugin-id=` 深链。
- 发现目录 `fetch_discovery` 可留在 Rust，第一版 UI **不要用**。

算出 `add` 的 target（按条）：

1. 精选命中且 `npm` 合法 → npm 包名。
2. 否则精选命中 → `github:owner/repo` 或 `#path:/sub`。
3. 开发安装分开。

精选 `installTargetFor`（逻辑抄自 market `sources.ts`）：

- GitHub URL：`https://github.com/owner/repo` 或 `/tree/<branch>/subpath`
- npm 字段匹配 `/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/` → 返回包名
- 否则 `github:owner/repo` 或 `github:owner/repo#path:/sub`

执行：`dsh plugin --profile <当前实例 profile> add <target>`。已装用 `list --depth=0 --json`，再对照 profile `package.json` 的 `dependencies` + `dsh.profile.bundles` 标内置。

---

## invoke 建议

前端只调这些（名字可改，职责不要散）：

- `get_state` — config + 各实例 runtime（status/url/error/pid）
- `save_settings` / `upsert_instance` / `remove_instance` / `set_focused`
- `probe_env`
- `start_instance` / `stop_instance` / `restart_instance`
- `open_instance_url` — 只允许 http(s)
- `list_profiles` / `create_profile` / `dump_config` — Rust 保留，第一版 UI 不用
- `run_plugin` — 传入已算好的 pnpm args 数组
- `list_installed`
- `pick_folder`
- `fetch_curated` — 精选目录；`fetch_discovery` / `fetch_readme` 可留在 Rust，第一版 UI 不用

事件：`instance-log` `{ id, line }`，`runtimes-changed` 快照。日志每实例保留约 1500–2000 行。

---

## 实现顺序

1. token 表 + 图标轨壳（轨底环境图标，无「OK/不OK」字）+ 运行页实例列空状态 + `probe_env`。删掉 greet 示例。
2. 进程监督：DSH_HOME / --port / 解析 `dsh web:` / home 锁 / 多进程 / opener / 托盘 / 关窗隐藏。
3. 精选目录 + target 规则 + add/remove/update + 重启横幅。
4. Windows `.cmd`、进程树、allowBuilds 文案收尾。updater 不做。

## 验收

- checkout 模式能启动 → 日志出现 `dsh web: http://127.0.0.1:3080` → 系统浏览器打开该地址；启动器窗口仍是控制面。
- 停止后端口释放，再启动成功。
- 第二实例（另一 home + 3081）可同时就绪；同一 home 再启动被拒绝。
- 精选里带 `npm` 的插件走包名安装，提示重启。
- remove 后层消失。
- 无 pnpm → 轨上警告图标，设置页 pnpm 行「未就绪」。
- 关窗口不杀 dsh；托盘退出才杀本启动器拉起的全部实例。

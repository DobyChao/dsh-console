// global.css 必须排在 App 之前：它的 `@import "tailwindcss"` 负责声明
// theme / base / components / utilities 的 layer 次序。CSS layer 的优先级由首次出现
// 的位置决定，若先加载了 App 里的 ui.module.css（内含 @layer components），
// components 会被登记在 base 之前，preflight 反过来压掉按钮 / 输入框 / 卡片的样式。
import "./styles/global.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LauncherProvider } from "./lib/launcher";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LauncherProvider>
      <App />
    </LauncherProvider>
  </React.StrictMode>,
);

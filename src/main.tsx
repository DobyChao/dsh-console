import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LauncherProvider } from "./lib/launcher";
import "./styles/tokens.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LauncherProvider>
      <App />
    </LauncherProvider>
  </React.StrictMode>,
);

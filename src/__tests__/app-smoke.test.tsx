// @vitest-environment jsdom
/**
 * 黑盒冒烟：mock 后端下整棵 App 树的渲染与基础交互。
 * 不校验业务细节，只保证三页、添加/编辑对话框、实例操作菜单、确认流程能跑通。
 * 注意：mock 数据是模块内单例，最后一个用例删除的「实验室」不要在更早的用例里依赖。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, test } from "vitest";
import React from "react";
import App from "../App";
import { LauncherProvider } from "../lib/launcher";

beforeAll(() => {
  // jsdom 缺的 API
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Element.prototype.scrollTo = Element.prototype.scrollTo || (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
});

afterEach(() => {
  cleanup();
});

async function renderApp() {
  render(
    <React.StrictMode>
      <LauncherProvider>
        <App />
      </LauncherProvider>
    </React.StrictMode>,
  );
  // 三页常驻后实例名会同时出现在列表 / 胶囊 / 设置表格里，用 findAll 断言至少渲染
  // 首次探测先尝试网页桥（本地无桌面进程，立即失败）再退回 mock，等实例列表出现
  const hits = await screen.findAllByText("默认", {}, { timeout: 15000 });
  expect(hits.length).toBeGreaterThan(0);
}

test("运行页：实例列表、状态卡、日志卡渲染", async () => {
  await renderApp();
  expect((await screen.findAllByText("实验室")).length).toBeGreaterThan(0);
  // mock 默认实例 ready：状态「就绪」、主按钮是「停止」
  expect(screen.getAllByText("就绪").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  expect(screen.getByText(/dsh v0\.9\.0/)).toBeTruthy();
});

test("插件页：目录、已装列表、开发安装", async () => {
  await renderApp();
  fireEvent.click(screen.getByRole("button", { name: "插件" }));
  expect(await screen.findByText("精选目录 · awesome-dsh-plugin.com")).toBeTruthy();
  expect(await screen.findByText("example-tools")).toBeTruthy();
  expect(screen.getByText("@dsh/example-tools")).toBeTruthy();
  expect(screen.getByText("开发安装")).toBeTruthy();
});

test("设置页：环境清单、dsh 来源、实例一览", async () => {
  await renderApp();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(await screen.findByText("环境", { selector: "h1" })).toBeTruthy();
  expect(screen.getByText("dsh 来源")).toBeTruthy();
  expect(screen.getByText("外观")).toBeTruthy();
  expect(screen.getByText("实例一览")).toBeTruthy();
  expect(screen.getByText("DSH_HOME", { selector: "th" })).toBeTruthy();
});

test("添加实例对话框：填 Home 后提交并出现在列表里", async () => {
  await renderApp();
  fireEvent.click(screen.getByRole("button", { name: "+ 添加实例" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  const home = screen.getByLabelText("Home 目录");
  fireEvent.change(home, { target: { value: "D:\\dsh-smoke" } });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  await waitFor(() => {
    expect(screen.getAllByText("D:\\dsh-smoke").length).toBeGreaterThan(0);
  });
});

test("实例 ⋯ 菜单可打开编辑对话框", async () => {
  await renderApp();
  // 焦点仍是「默认」（就绪 → 主按钮「停止」）；点另一条的 ⋯ 不得切走焦点
  expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "实例操作" })[1]);
  expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("menuitem", { name: "编辑" }));
  expect(await screen.findByRole("heading", { name: "编辑实例" })).toBeTruthy();
  expect((screen.getByLabelText("显示名") as HTMLInputElement).value).toBe("实验室");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
});

test("右键实例 → 删除菜单 → 确认后移除", async () => {
  await renderApp();
  // 列表项按钮（不是设置页表格里的同名文本）
  fireEvent.contextMenu(screen.getByRole("button", { name: /实验室/ }));
  const remove = await screen.findByRole("menuitem", { name: "删除" });
  fireEvent.click(remove);
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("实验室");
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() => {
    expect(screen.queryByText("实验室")).toBeNull();
  });
});

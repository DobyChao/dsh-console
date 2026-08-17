import { describe, expect, it } from "vitest";
import { findInstalledAlias, installTargetFor, parseSourceUrl } from "../install-target";

describe("parseSourceUrl", () => {
  it("解析普通仓库地址", () => {
    expect(parseSourceUrl("https://github.com/owner/repo")).toEqual({ repo: "owner/repo", subpath: null });
    expect(parseSourceUrl("https://github.com/owner/repo/")).toEqual({ repo: "owner/repo", subpath: null });
  });

  it("解析 tree 子路径", () => {
    expect(parseSourceUrl("https://github.com/owner/repo/tree/main/packages/plugin")).toEqual({
      repo: "owner/repo",
      subpath: "packages/plugin",
    });
  });

  it("拒绝非 github、多级仓库名和路径穿越", () => {
    expect(parseSourceUrl("https://gitlab.com/owner/repo")).toBeNull();
    expect(parseSourceUrl("https://github.com/a/b/c/d")).toBeNull();
    expect(parseSourceUrl("https://github.com/owner/repo/tree/main/../etc")).toBeNull();
  });
});

describe("installTargetFor", () => {
  it("npm 字段合法时优先用包名", () => {
    expect(installTargetFor({ url: "https://github.com/o/r", npm: "@scope/pkg" })).toBe("@scope/pkg");
    expect(installTargetFor({ url: "https://github.com/o/r", npm: "bad name!" })).toBe("github:o/r");
  });

  it("无 npm 时退回 github spec，子路径用 #path:", () => {
    expect(installTargetFor({ url: "https://github.com/o/r" })).toBe("github:o/r");
    expect(installTargetFor({ url: "https://github.com/o/r/tree/main/sub" })).toBe("github:o/r#path:/sub");
  });

  it("URL 无法解析时返回 null", () => {
    expect(installTargetFor({ url: "https://example.com/x" })).toBeNull();
  });
});

describe("findInstalledAlias", () => {
  it("按 npm 包名或仓库名匹配已装条目", () => {
    const installed = { "@scope/pkg": "github:o/r#path:/sub", "plain": "npm:plain@1.0.0" };
    expect(findInstalledAlias({ name: "x", npm: "@scope/pkg", url: "https://github.com/o/r" }, installed)).toBe(
      "@scope/pkg",
    );
    expect(findInstalledAlias({ name: "x", url: "https://github.com/o/r" }, installed)).toBe("@scope/pkg");
    expect(findInstalledAlias({ name: "plain", url: "https://github.com/other/plain" }, installed)).toBe("plain");
  });

  it("带子路径的条目要 #path 完全一致", () => {
    const installed = { "@scope/pkg": "github:o/r#path:/sub" };
    expect(findInstalledAlias({ name: "x", url: "https://github.com/o/r/tree/main/other" }, installed)).toBeNull();
    expect(findInstalledAlias({ name: "x", url: "https://github.com/o/r/tree/main/sub" }, installed)).toBe("@scope/pkg");
  });
});

import { describe, expect, it } from "vitest";
import { extractInstallReference, isPinnedSha, resolveCatalogInstallReference } from "../install-reference";

const readme = (blocks: string[]) => blocks.join("\n\n");

describe("extractInstallReference", () => {
  it("识别 dsh plugin add 命令", () => {
    const ref = extractInstallReference(readme(["```", "dsh plugin --profile web add @scope/pkg", "```"]), "web");
    expect(ref.status).toBe("recognized");
    expect(ref.candidate?.source).toBe("npm");
    expect(ref.candidate?.target).toBe("@scope/pkg");
    expect(ref.candidate?.executable).toBe(true);
  });

  it("github spec 可识别；其它 profile 标记为不可执行", () => {
    const ref = extractInstallReference(readme(["```", "dsh plugin add github:o/r", "```"]), "headless");
    // 未写 --profile 时按当前实例 profile 处理，这里与 headless 相同所以可执行
    expect(ref.candidate?.executable).toBe(true);
    const other = extractInstallReference(readme(["```", "dsh plugin --profile web add github:o/r", "```"]), "headless");
    expect(other.candidate?.executable).toBe(false);
  });

  it("$ 前缀与安装小节内的包管理器命令可识别但默认不可执行", () => {
    const ref = extractInstallReference(
      readme(["## 安装", "", "```", "$ pnpm add @scope/pkg", "```"]),
      "web",
    );
    expect(ref.status).toBe("recognized");
    expect(ref.candidate?.evidence.pattern).toBe("package-manager-add");
    expect(ref.candidate?.executable).toBe(false);
  });

  it("多条冲突命令判 ambiguous", () => {
    const ref = extractInstallReference(
      readme(["```", "dsh plugin add @scope/one", "dsh plugin add @scope/two", "```"]),
      "web",
    );
    expect(ref.status).toBe("ambiguous");
  });

  it("含 shell 元字符的命令被丢弃", () => {
    const ref = extractInstallReference(readme(["```", "dsh plugin add pkg && rm -rf /", "```"]), "web");
    expect(ref.status).toBe("unrecognized");
  });

  it("没有可识别命令时 unrecognized", () => {
    expect(extractInstallReference("# hi\n\nnothing here", "web").status).toBe("unrecognized");
  });
});

describe("resolveCatalogInstallReference", () => {
  it("verified 仓库的 github 命令钉上 sourceSha", () => {
    const sha = "c".repeat(40);
    const ref = extractInstallReference(readme(["```", "dsh plugin add github:o/r", "```"]), "web");
    const resolved = resolveCatalogInstallReference(
      ref,
      { fullName: "o/r", validation: { overall: "verified", sourceSha: sha } },
      "web",
    );
    expect(resolved.candidate?.args).toEqual(["add", `github:o/r#${sha}`]);
  });

  it("命令指向别的仓库时不可执行", () => {
    const ref = extractInstallReference(readme(["```", "dsh plugin add github:other/repo", "```"]), "web");
    const resolved = resolveCatalogInstallReference(
      ref,
      { fullName: "o/r", validation: { overall: "verified", sourceSha: "c".repeat(40) } },
      "web",
    );
    expect(resolved.candidate?.executable).toBe(false);
  });
});

describe("isPinnedSha", () => {
  it("只认 40 位十六进制后缀", () => {
    expect(isPinnedSha("github:o/r")).toBe(false);
    expect(isPinnedSha("github:o/r#path:/sub")).toBe(false);
    expect(isPinnedSha(`github:o/r#${"a".repeat(40)}`)).toBe(true);
  });
});

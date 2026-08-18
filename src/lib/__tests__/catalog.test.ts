import { describe, expect, it } from "vitest";
import {
  catalogCategories,
  filterPlugins,
  findInstalledName,
  mergeCatalogs,
  planFromKnownFields,
} from "../catalog";
import type { CuratedCatalog, DiscoveryCatalog, DiscoveryRepo, InstalledPlugin, MergedPlugin } from "../types";

const curated: CuratedCatalog = {
  plugins: [
    {
      name: "tools",
      owner: "dsh-market",
      url: "https://github.com/dsh-market/tools",
      npm: "@dsh/tools",
      stars: 12,
      category: "tools",
    },
    {
      name: "no-npm",
      owner: "someone",
      url: "https://github.com/someone/no-npm/tree/main/pkg",
      description: { zh: "中文描述", en: "english" },
    },
  ],
  categories: { tools: { zh: "工具", en: "Tools" } },
};

const discovery: DiscoveryCatalog = {
  repositories: [
    {
      fullName: "dsh-market/tools",
      name: "tools",
      description: "from discovery",
      stargazersCount: 30,
      validation: { overall: "verified", sourceSha: "a".repeat(40) },
      projectType: "plugin",
    },
    {
      fullName: "other/repo",
      name: "repo",
      install: { status: "recognized", candidate: { source: "github", target: "other/repo", executable: true } },
    },
  ],
};

describe("mergeCatalogs", () => {
  it("按 owner/repo 去重合并，取星数最大值", () => {
    const merged = mergeCatalogs(curated, discovery);
    const tools = merged.find((p) => p.fullName === "dsh-market/tools");
    expect(tools?.curated).toBe(true);
    expect(tools?.stars).toBe(30);
    expect(tools?.verified).toBe(true);
    expect(merged.find((p) => p.fullName === "other/repo")?.curated).toBe(false);
  });

  it("中文描述优先于英文", () => {
    const merged = mergeCatalogs(curated, null);
    expect(merged.find((p) => p.name === "no-npm")?.description).toBe("中文描述");
  });
});

describe("filterPlugins", () => {
  const merged = mergeCatalogs(curated, discovery);
  const all: MergedPlugin[] = [
    ...merged,
    {
      key: "plain/plain",
      fullName: "plain/plain",
      name: "plain",
      description: "普通插件",
      url: "https://github.com/plain/plain",
      stars: 1,
      curated: false,
      verified: false,
      securityReview: false,
      projectType: "plugin",
    },
  ];

  it("curated 只留精选条目", () => {
    expect(filterPlugins(all, "curated", "").map((p) => p.fullName)).toEqual(["dsh-market/tools", "someone/no-npm"]);
  });

  it("按分类筛选，并可与搜索叠加", () => {
    expect(filterPlugins(all, "curated", "", "tools").map((p) => p.name)).toEqual(["tools"]);
    expect(filterPlugins(all, "curated", "no-npm", "tools")).toEqual([]);
    // 空分类等于不筛
    expect(filterPlugins(all, "curated", "", null)).toHaveLength(2);
  });

  it("搜索匹配名称、全名、描述", () => {
    expect(filterPlugins(all, "curated", "中文")).toHaveLength(1);
    expect(filterPlugins(all, "all", "plain/plain")).toHaveLength(1);
  });
});

describe("catalogCategories", () => {
  it("统计条目数并取目录自带的中文名，无分类的条目不计入", () => {
    const merged = mergeCatalogs(curated, null);
    // curated 里 tools 有分类、no-npm 没有
    expect(catalogCategories(merged, curated.categories)).toEqual([
      { key: "tools", label: "工具", count: 1 },
    ]);
  });

  it("缺中文名时回落英文名，再回落 key", () => {
    const merged = mergeCatalogs(curated, null);
    expect(catalogCategories(merged, { tools: { en: "Tools" } })[0].label).toBe("Tools");
    expect(catalogCategories(merged, undefined)[0].label).toBe("tools");
  });

  it("按条目数降序", () => {
    const many: CuratedCatalog = {
      plugins: [
        { name: "a", owner: "o", url: "https://github.com/o/a", category: "ui" },
        { name: "b", owner: "o", url: "https://github.com/o/b", category: "ui" },
        { name: "c", owner: "o", url: "https://github.com/o/c", category: "git" },
      ],
    };
    expect(catalogCategories(mergeCatalogs(many, null)).map((c) => [c.key, c.count])).toEqual([
      ["ui", 2],
      ["git", 1],
    ]);
  });
});

describe("planFromKnownFields", () => {
  it("精选 + 合法 npm → add 包名", () => {
    const plan = planFromKnownFields(mergeCatalogs(curated, null)[0]);
    expect(plan?.kind).toBe("ready");
    expect(plan?.args).toEqual(["add", "@dsh/tools"]);
  });

  it("精选无 npm → github spec（含 #path）", () => {
    const plan = planFromKnownFields(mergeCatalogs(curated, null)[1]);
    expect(plan?.kind).toBe("ready");
    expect(plan?.args).toEqual(["add", "github:someone/no-npm#path:/pkg"]);
  });

  it("verified 的 github 候选必须钉 40 位 SHA", () => {
    const merged = mergeCatalogs(curated, discovery);
    const plan = planFromKnownFields(merged[0]);
    // dsh-market/tools 是精选条目，走 npm 分支；这里构造纯 discovery 的 verified 条目
    const verifiedRepo: DiscoveryRepo = {
      fullName: "v/v",
      name: "v",
      stargazersCount: 1,
      validation: { overall: "verified", sourceSha: "b".repeat(40) },
      projectType: "plugin",
      install: { status: "recognized", candidate: { source: "github", target: "v/v", executable: true } },
    };
    const plan2 = planFromKnownFields(mergeCatalogs(null, { repositories: [verifiedRepo] })[0]);
    expect(plan2?.kind).toBe("confirm");
    expect(plan2?.args).toEqual(["add", `github:v/v#${"b".repeat(40)}`]);
    expect(plan?.spec).toBe("@dsh/tools");
  });

  it("security-review 禁止一键安装", () => {
    const repo: DiscoveryRepo = {
      fullName: "s/s",
      name: "s",
      validation: { overall: "security-review" },
      projectType: "plugin",
    };
    const plan = planFromKnownFields(mergeCatalogs(null, { repositories: [repo] })[0]);
    expect(plan?.kind).toBe("disabled");
  });
});

describe("findInstalledName", () => {
  const merged = mergeCatalogs(curated, null);

  it("匹配 npm 包名", () => {
    const installed: InstalledPlugin[] = [{ name: "@dsh/tools", from: "npm", builtin: false }];
    expect(findInstalledName(merged[0], installed)).toBe("@dsh/tools");
  });

  it("未安装返回 null", () => {
    expect(findInstalledName(merged[1], [])).toBeNull();
  });
});

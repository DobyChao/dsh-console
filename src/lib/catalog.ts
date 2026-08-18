import type {
  CatalogFilter,
  CuratedCatalog,
  CuratedPlugin,
  DiscoveryCatalog,
  InstallPlan,
  InstalledPlugin,
  MergedPlugin,
} from "./types";
import { findInstalledAlias, installTargetFor, parseSourceUrl } from "./install-target";
import {
  extractInstallReference,
  isPinnedSha,
  resolveCatalogInstallReference,
} from "./install-reference";

function descText(entry: CuratedPlugin): string {
  const d = entry.description;
  if (!d) return "";
  if (typeof d === "string") return d;
  return d.zh || d.en || "";
}

export function repoKey(fullName: string): string {
  return fullName.trim().replace(/^github:/i, "").toLowerCase();
}

export function mergeCatalogs(
  curated: CuratedCatalog | null | undefined,
  discovery: DiscoveryCatalog | null | undefined,
): MergedPlugin[] {
  const map = new Map<string, MergedPlugin>();

  for (const repo of discovery?.repositories ?? []) {
    if (!repo?.fullName) continue;
    const key = repoKey(repo.fullName);
    const name = repo.fullName.split("/")[1];
    map.set(key, {
      key,
      fullName: repo.fullName,
      name: repo.name || name || repo.fullName,
      description: repo.description ?? "",
      url: repo.url || repo.htmlUrl || `https://github.com/${repo.fullName}`,
      stars: repo.stargazersCount ?? repo.stars ?? 0,
      curated: false,
      verified: repo.validation?.overall === "verified",
      securityReview: repo.validation?.overall === "security-review",
      projectType: repo.projectType || "unknown",
      discovery: repo,
    });
  }

  for (const plugin of curated?.plugins ?? []) {
    const parsed = parseSourceUrl(plugin.url) ?? (plugin.owner ? { repo: `${plugin.owner}/${plugin.name}`, subpath: null } : null);
    if (!parsed) continue;
    const key = repoKey(parsed.repo);
    const existing = map.get(key);
    const next: MergedPlugin = existing ?? {
      key,
      fullName: parsed.repo,
      name: plugin.name,
      description: "",
      url: plugin.url,
      stars: plugin.stars ?? 0,
      curated: true,
      verified: false,
      securityReview: false,
      projectType: "plugin",
    };
    next.curated = true;
    next.curatedEntry = plugin;
    next.name = plugin.name || next.name;
    next.description = descText(plugin) || next.description;
    next.url = plugin.url || next.url;
    next.stars = Math.max(next.stars, plugin.stars ?? 0);
    map.set(key, next);
  }

  return [...map.values()].sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
}

export function filterPlugins(
  list: MergedPlugin[],
  filter: CatalogFilter,
  query: string,
  category?: string | null,
): MergedPlugin[] {
  const q = query.trim().toLowerCase();
  return list.filter((p) => {
    if (filter === "curated" && !p.curated) return false;
    if (filter === "verified") {
      if (p.projectType !== "plugin" || !p.verified) return false;
    }
    if (category && p.curatedEntry?.category !== category) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.fullName.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  });
}

export interface CatalogCategory {
  key: string;
  label: string;
  count: number;
}

/**
 * 精选目录的分类 + 条目数，按条目数降序。分类的中文名取自目录自身的 `categories`
 * 映射（远端数据，和插件名 / 描述同一性质），缺失时回落到英文名、再回落到 key。
 */
export function catalogCategories(
  list: MergedPlugin[],
  labels?: CuratedCatalog["categories"],
): CatalogCategory[] {
  const counts = new Map<string, number>();
  for (const p of list) {
    const key = p.curatedEntry?.category?.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const label = labels?.[key];
      return { key, label: label?.zh || label?.en || key, count };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"));
}

function pnpmArgsFromCandidate(args: string[] | undefined, fallbackSpec: string): string[] {
  if (args && args.length > 0) {
    const addAt = args.lastIndexOf("add");
    if (addAt >= 0) return args.slice(addAt);
    if (args[0] === "plugin") {
      const rest = args.slice(1).filter((a, i, all) => !(a === "--profile" || all[i - 1] === "--profile"));
      return rest;
    }
    return args;
  }
  return ["add", fallbackSpec];
}

function githubSpec(fullName: string, sha?: string | null): string {
  if (sha && /^[a-f0-9]{40}$/i.test(sha)) return `github:${fullName}#${sha.toLowerCase()}`;
  return `github:${fullName}`;
}

export function planFromKnownFields(plugin: MergedPlugin): InstallPlan | null {
  const repoUrl = plugin.url || `https://github.com/${plugin.fullName}`;

  if (plugin.securityReview) {
    return { kind: "disabled", reason: "该仓库处于 security-review，一键安装已禁用。", repoUrl };
  }

  if (plugin.curatedEntry) {
    const spec = installTargetFor(plugin.curatedEntry);
    if (!spec) {
      return { kind: "link-only", reason: "精选条目没有可用的安装目标。", repoUrl };
    }
    return { kind: "ready", spec, args: ["add", spec], repoUrl };
  }

  const install = plugin.discovery?.install;
  const candidate = install?.candidate;
  if (install?.status === "recognized" && candidate?.executable && candidate.target) {
    const source = candidate.source ?? "";
    if (source !== "github" && source !== "npm") {
      return { kind: "disabled", reason: "安装源不是 github / npm，一键已禁用。", repoUrl };
    }
    let spec = candidate.target;
    if (source === "github") {
      if (plugin.verified) {
        const sha = plugin.discovery?.validation?.sourceSha;
        if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) {
          return { kind: "disabled", reason: "已验证 GitHub 插件缺少 40 位 SHA，一键已禁用。", repoUrl };
        }
        spec = githubSpec(plugin.fullName, sha);
      } else if (!spec.startsWith("github:")) {
        spec = `github:${spec}`;
      }
    }
    return {
      kind: plugin.curated ? "ready" : "confirm",
      spec,
      args: pnpmArgsFromCandidate(candidate.args, spec),
      repoUrl,
    };
  }

  return null;
}

/**
 * v1 UI 不用：README 安装命令解析入口，供后续发现目录 / README 安装流程复用
 * （spec「插件获取规则」保留的参考实现）。精选目录一键安装走 planFromKnownFields。
 */
export function planFromReadme(
  plugin: MergedPlugin,
  currentProfile: string,
  readme: string,
): InstallPlan {
  const repoUrl = plugin.url || `https://github.com/${plugin.fullName}`;
  const extracted = extractInstallReference(readme, currentProfile);
  if (extracted.status === "ambiguous") {
    return { kind: "disabled", reason: "README 里有多条冲突的安装命令。", repoUrl };
  }
  const resolved = resolveCatalogInstallReference(
    extracted,
    {
      fullName: plugin.fullName,
      validation: plugin.discovery?.validation,
    },
    currentProfile,
  );
  const candidate = resolved.candidate;
  if (!candidate || resolved.status !== "recognized") {
    return { kind: "link-only", reason: "无法从 README 解析唯一安装命令。", repoUrl };
  }
  if (candidate.profile !== currentProfile) {
    return {
      kind: "link-only",
      reason: `README 指定的启动配置是 ${candidate.profile}，与当前实例不一致。`,
      repoUrl,
    };
  }
  if (candidate.source !== "github" && candidate.source !== "npm") {
    return { kind: "disabled", reason: "安装源不是 github / npm。", repoUrl };
  }
  if (!candidate.executable) {
    return { kind: "link-only", reason: "这条 README 命令不能代跑。", repoUrl };
  }
  let spec = candidate.args[1] ?? candidate.target;
  if (candidate.source === "github" && plugin.verified && !isPinnedSha(spec)) {
    const sha = plugin.discovery?.validation?.sourceSha;
    if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) {
      return { kind: "disabled", reason: "已验证 GitHub 插件缺少 40 位 SHA。", repoUrl };
    }
    spec = githubSpec(plugin.fullName, sha);
  }
  return {
    kind: plugin.curated ? "ready" : "confirm",
    spec,
    args: ["add", spec],
    repoUrl,
  };
}

export function installedMap(list: InstalledPlugin[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of list) {
    out[p.name] = p.from || p.resolved || p.version || p.name;
  }
  return out;
}

export function findInstalledName(plugin: MergedPlugin, installed: InstalledPlugin[]): string | null {
  const map = installedMap(installed);
  if (plugin.curatedEntry) {
    const alias = findInstalledAlias(plugin.curatedEntry, map);
    if (alias) return alias;
  }
  const lower = plugin.fullName.toLowerCase();
  for (const p of installed) {
    const blob = `${p.name} ${p.from ?? ""} ${p.resolved ?? ""}`.toLowerCase();
    if (p.name.toLowerCase() === plugin.name.toLowerCase()) return p.name;
    if (blob.includes(lower)) return p.name;
  }
  return null;
}

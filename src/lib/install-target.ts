const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function parseSourceUrl(url: string): { repo: string; subpath: string | null } | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\/tree\/[^/]+\/(.+?))?\/?$/.exec(url);
  if (m === null || !REPO_RE.test(m[1])) return null;
  const subpath = m[2] ?? null;
  if (subpath !== null) {
    if (!/^[A-Za-z0-9_./-]+$/.test(subpath)) return null;
    if (subpath.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  }
  return { repo: m[1], subpath };
}

export function installTargetFor(entry: { url: string; npm?: unknown }): string | null {
  const source = parseSourceUrl(entry.url);
  if (source === null) return null;
  if (typeof entry.npm === "string" && NPM_NAME_RE.test(entry.npm)) return entry.npm;
  return source.subpath !== null
    ? `github:${source.repo}#path:/${source.subpath}`
    : `github:${source.repo}`;
}

export function findInstalledAlias(
  entry: { name: string; npm?: unknown; url: string },
  installed: Record<string, string>,
): string | null {
  const source = parseSourceUrl(entry.url);
  const entryRepoId =
    source === null
      ? null
      : source.subpath === null
        ? source.repo.toLowerCase()
        : `${source.repo.toLowerCase()}#path:/${source.subpath.toLowerCase()}`;
  const ids = new Set([entry.name.toLowerCase()]);
  if (typeof entry.npm === "string" && entry.npm !== "") ids.add(entry.npm.toLowerCase());
  if (entryRepoId !== null) ids.add(entryRepoId);
  for (const [name, spec] of Object.entries(installed)) {
    const dep = new Set([name.toLowerCase()]);
    const scoped = /^@([^/]+)\/(.+)$/.exec(name);
    if (scoped !== null) dep.add(`${scoped[1]}/${scoped[2]}`.toLowerCase());
    const m = /github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:#path:\/([A-Za-z0-9_./-]+))?/i.exec(spec);
    if (m !== null) {
      dep.add(m[1].toLowerCase());
      if (m[2] !== undefined) dep.add(`${m[1].toLowerCase()}#path:/${m[2].toLowerCase()}`);
      if (entryRepoId !== null) {
        if (dep.has(entryRepoId)) return name;
        continue;
      }
    }
    for (const id of dep) if (ids.has(id)) return name;
  }
  return null;
}

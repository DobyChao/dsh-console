export type Appearance = "light" | "dark" | "system";
export type DshMode = "path" | "checkout";
export type PageId = "run" | "plugins" | "settings";
export type ProcStatus = "idle" | "starting" | "ready" | "stopping" | "error";

export interface Instance {
  id: string;
  displayName: string;
  dshHome: string;
  port: number;
  profile: string;
  cwd?: string;
}

export interface LauncherConfig {
  instances: Instance[];
  focusedId: string;
  dshMode: DshMode;
  dshPath?: string;
  checkoutPath?: string;
  appearance: Appearance;
}

export interface RuntimeInfo {
  id: string;
  status: ProcStatus;
  url?: string | null;
  error?: string | null;
  pid?: number | null;
  needsRestart: boolean;
}

export interface LauncherState {
  config: LauncherConfig;
  runtimes: Record<string, RuntimeInfo>;
  logs: Record<string, string[]>;
}

export interface ProbeItem {
  id: string;
  name: string;
  ok: boolean;
  detail?: string | null;
  hint: string;
}

export interface EnvProbe {
  ok: boolean;
  firstFailure?: string | null;
  items: ProbeItem[];
  gitOk: boolean;
  gitHint?: string | null;
}

export interface SettingsPatch {
  dshMode: DshMode;
  dshPath?: string | null;
  checkoutPath?: string | null;
  appearance: Appearance;
}

export interface InstancePatch {
  id?: string;
  displayName: string;
  dshHome: string;
  port: number;
  profile?: string;
  cwd?: string | null;
}

export interface ProfileInfo {
  name: string;
  path: string;
  kind: string;
  note?: string | null;
}

export interface InstalledPlugin {
  name: string;
  from?: string;
  version?: string;
  resolved?: string;
  builtin: boolean;
}

export interface CatalogPayload<T = unknown> {
  data: T;
  stale: boolean;
  fetchedAt?: number | null;
  error?: string | null;
}

export interface CuratedPlugin {
  name: string;
  owner: string;
  url: string;
  page?: string;
  category?: string;
  description?: { en?: string; zh?: string } | string;
  npm?: string | null;
  stars?: number;
  install?: string;
  added?: string;
}

export interface CuratedCatalog {
  plugins?: CuratedPlugin[];
  categories?: Record<string, { en?: string; zh?: string }>;
}

export interface DiscoveryInstallCandidate {
  source?: string;
  target?: string;
  command?: string;
  args?: string[];
  executable?: boolean;
  version?: string;
}

export interface DiscoveryRepo {
  fullName: string;
  name: string;
  description?: string;
  url?: string;
  htmlUrl?: string;
  defaultBranch?: string;
  stargazersCount?: number;
  stars?: number;
  topics?: string[];
  projectType?: string;
  validation?: {
    overall?: string;
    sourceSha?: string | null;
  };
  install?: {
    status?: string;
    candidate?: DiscoveryInstallCandidate;
    candidates?: DiscoveryInstallCandidate[];
  };
}

export interface DiscoveryCatalog {
  schemaVersion?: number;
  repositories?: DiscoveryRepo[];
}

export type CatalogFilter = "curated" | "verified" | "all";

export interface MergedPlugin {
  key: string;
  fullName: string;
  name: string;
  description: string;
  url: string;
  stars: number;
  curated: boolean;
  verified: boolean;
  securityReview: boolean;
  projectType: string;
  curatedEntry?: CuratedPlugin;
  discovery?: DiscoveryRepo;
}

export interface InstallPlan {
  kind: "ready" | "disabled" | "link-only" | "confirm";
  spec?: string;
  args?: string[];
  reason?: string;
  repoUrl: string;
}

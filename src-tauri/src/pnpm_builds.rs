use std::fs;
use std::path::Path;

pub fn ignored_build_packages(output: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in output.lines() {
        let Some(rest) = line.split("Ignored build scripts:").nth(1) else {
            continue;
        };
        for spec in rest.split(',') {
            let spec = spec.trim();
            if spec.is_empty() {
                continue;
            }
            let name = strip_version(spec);
            if !name.is_empty() && !names.iter().any(|n| n == &name) {
                names.push(name);
            }
        }
    }
    names
}

pub fn looks_like_ignored_builds(output: &str) -> bool {
    output.contains("ERR_PNPM_IGNORED_BUILDS")
        || output.contains("Ignored build scripts:")
        || output.contains("approve-builds")
        || output.contains("set this to true or false")
}

/// 把 pnpm 留下的占位符和本次点名的包写成 `allowBuilds: true`。已是 `true`/`false` 的键不改。
pub fn approve_pending_builds(dir: &Path, extra_names: &[String]) -> Result<Vec<String>, String> {
    let path = dir.join("pnpm-workspace.yaml");
    let original = if path.exists() {
        fs::read_to_string(&path).map_err(|e| format!("读取 pnpm-workspace.yaml 失败：{e}"))?
    } else if extra_names.is_empty() {
        return Ok(Vec::new());
    } else {
        String::new()
    };
    let (next, changed) = merge_allow_builds(&original, extra_names);
    if changed.is_empty() {
        return Ok(changed);
    }
    fs::write(&path, next).map_err(|e| format!("写入 pnpm-workspace.yaml 失败：{e}"))?;
    Ok(changed)
}

fn strip_version(spec: &str) -> String {
    let spec = spec.trim().trim_matches(['"', '\'']);
    if spec.starts_with('@') {
        if let Some(i) = spec.rfind('@') {
            if i > 0 {
                return spec[..i].to_string();
            }
        }
        return spec.to_string();
    }
    spec.rsplit_once('@')
        .map(|(name, _)| name.to_string())
        .unwrap_or_else(|| spec.to_string())
}

fn yaml_key(name: &str) -> String {
    if name.chars().any(|c| !c.is_ascii_alphanumeric() && c != '-' && c != '_') {
        format!("'{name}'")
    } else {
        name.to_string()
    }
}

fn line_key(line: &str) -> Option<String> {
    let (raw_key, _) = line.trim().split_once(':')?;
    let key = raw_key.trim().trim_matches(['"', '\'']);
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

fn key_matches(line: &str, name: &str) -> bool {
    line_key(line).as_deref() == Some(name)
}

fn value_of(line: &str) -> &str {
    line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("")
}

fn is_decided_bool(line: &str) -> bool {
    matches!(value_of(line), "true" | "false")
}

fn is_placeholder(line: &str) -> bool {
    value_of(line).starts_with("set this to true or false")
}

fn merge_allow_builds(text: &str, extra_names: &[String]) -> (String, Vec<String>) {
    let mut lines: Vec<String> = if text.is_empty() {
        Vec::new()
    } else {
        text.replace("\r\n", "\n").lines().map(|s| s.to_string()).collect()
    };
    if lines.is_empty() {
        lines.push("allowBuilds:".into());
    }

    let allow_idx = lines.iter().position(|l| l.trim() == "allowBuilds:");
    let allow_idx = if let Some(i) = allow_idx {
        i
    } else {
        if !lines.last().map(|l| l.is_empty()).unwrap_or(true) {
            lines.push(String::new());
        }
        lines.push("allowBuilds:".into());
        lines.len() - 1
    };

    let mut end = allow_idx + 1;
    while end < lines.len() {
        let t = lines[end].trim_start();
        if t.is_empty() {
            break;
        }
        let indent = lines[end].len() - lines[end].trim_start().len();
        if indent == 0 {
            break;
        }
        end += 1;
    }

    let mut changed = Vec::new();

    for i in allow_idx + 1..end {
        if !is_placeholder(&lines[i]) {
            continue;
        }
        let Some(name) = line_key(&lines[i]) else {
            continue;
        };
        lines[i] = format!("  {}: true", yaml_key(&name));
        if !changed.iter().any(|n| n == &name) {
            changed.push(name);
        }
    }

    for name in extra_names {
        let wanted = format!("  {}: true", yaml_key(name));
        let mut found = None;
        for i in allow_idx + 1..end {
            if key_matches(&lines[i], name) {
                found = Some(i);
                break;
            }
        }
        match found {
            Some(i) if is_decided_bool(&lines[i]) => {}
            Some(i) => {
                if !is_placeholder(&lines[i]) {
                    lines[i] = wanted;
                    if !changed.iter().any(|n| n == name) {
                        changed.push(name.clone());
                    }
                }
            }
            None => {
                lines.insert(end, wanted);
                end += 1;
                if !changed.iter().any(|n| n == name) {
                    changed.push(name.clone());
                }
            }
        }
    }

    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    (out, changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ignored_scripts() {
        let out = "[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: node-pty@1.1.0, @scope/pkg@2.0.0";
        assert_eq!(
            ignored_build_packages(out),
            vec!["node-pty".to_string(), "@scope/pkg".to_string()]
        );
    }

    #[test]
    fn flips_every_placeholder_without_a_name_list() {
        let yaml = "\
packages:
  - .

allowBuilds:
  ssh2: false
  cpu-features: false
  node-pty: set this to true or false
  esbuild: set this to true or false
";
        let (next, changed) = merge_allow_builds(yaml, &[]);
        assert_eq!(changed, vec!["node-pty".to_string(), "esbuild".to_string()]);
        assert!(next.contains("  node-pty: true"));
        assert!(next.contains("  esbuild: true"));
        assert!(next.contains("  ssh2: false"));
        assert!(next.contains("  cpu-features: false"));
        assert!(!next.contains("set this to true or false"));
    }

    #[test]
    fn adds_ignored_packages_that_are_not_in_the_file() {
        let yaml = "allowBuilds:\n  ssh2: false\n";
        let (next, changed) = merge_allow_builds(yaml, &["node-pty".into()]);
        assert_eq!(changed, vec!["node-pty".to_string()]);
        assert!(next.contains("  node-pty: true"));
        assert!(next.contains("  ssh2: false"));
    }

    #[test]
    fn does_not_override_explicit_true_or_false() {
        let yaml = "\
allowBuilds:
  node-pty: true
  ssh2: false
";
        let (next, changed) = merge_allow_builds(yaml, &["node-pty".into(), "ssh2".into()]);
        assert!(changed.is_empty());
        assert_eq!(next, yaml.replace("\r\n", "\n"));
    }

    #[test]
    fn quotes_scoped_package_keys() {
        let (next, changed) = merge_allow_builds("allowBuilds:\n", &["@scope/pkg".into()]);
        assert_eq!(changed, vec!["@scope/pkg".to_string()]);
        assert!(next.contains("  '@scope/pkg': true"));
    }
}

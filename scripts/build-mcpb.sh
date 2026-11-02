#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output=${1:?Usage: sh scripts/build-mcpb.sh /path/to/new-file.mcpb}
case "$output" in /*) ;; *) output="$(pwd)/$output" ;; esac
[ ! -e "$output" ] || { printf 'Output already exists: %s\n' "$output" >&2; exit 1; }
stage_dir=$(mktemp -d "${TMPDIR:-/tmp}/secureinput-mcpb.XXXXXX")
trap 'rm -rf -- "$stage_dir"' EXIT HUP INT TERM

# Stage only public build inputs. Never archive the working tree or user config.
cp "$repo_dir/package.json" "$repo_dir/package-lock.json" "$repo_dir/README.md" "$repo_dir/LICENSE" "$stage_dir/"
cp "$repo_dir/packaging/mcpb/manifest.json" "$stage_dir/manifest.json"
cp -R "$repo_dir/dist" "$stage_dir/dist"
(cd "$stage_dir" && npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund)
# Frontend dependencies are already compiled into dist; only CLI imports are
# needed at runtime. Prune them after the locked install to keep the bundle small.
(cd "$stage_dir" && node -e '
  const fs = require("node:fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const needed = new Set(["@modelcontextprotocol/ext-apps", "@modelcontextprotocol/sdk", "commander", "express", "open", "re2js", "zod"]);
  p.dependencies = Object.fromEntries(Object.entries(p.dependencies).filter(([name]) => needed.has(name)));
  delete p.devDependencies;
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
')
(cd "$stage_dir" && npm prune --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund)
(cd "$stage_dir" && zip -qr "$output" manifest.json package.json README.md LICENSE dist node_modules)
printf 'Created %s\n' "$output"

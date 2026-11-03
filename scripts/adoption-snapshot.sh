#!/usr/bin/env bash
# Read aggregate GitHub statistics. No SecureInput usage data or credentials are collected.
set -euo pipefail
repo="r69shabh/secureinput"
printf 'Snapshot (UTC): %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S')"
printf '\nRepository totals:\n'
gh api "repos/$repo" --jq '{stars: .stargazers_count, forks: .forks_count, open_issues_and_prs: .open_issues_count}'
printf '\nRelease asset downloads (cumulative):\n'
gh api --paginate "repos/$repo/releases?per_page=100" --jq '.[] | {release: .tag_name, assets: [.assets[] | {name, downloads: .download_count}]}'
printf '\nGitHub traffic (rolling 14 days; requires repository access):\n'
for metric in views clones; do
  printf '%s: ' "$metric"
  if ! gh api "repos/$repo/traffic/$metric" --jq '{count, uniques}'; then
    printf '%s unavailable (check GitHub permissions)\n' "$metric" >&2
  fi
done

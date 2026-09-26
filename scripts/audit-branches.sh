#!/usr/bin/env bash
# Branch audit script for action-code-review.
# Classifies every local branch as:
#   - obsolete: every branch-ahead commit is reachable from origin/main
#   - merged-equivalent: every branch-ahead commit has a patch-id match in
#     origin/main's reachable commits (squash/rebase-merge candidate)
#   - has-unique-delta: at least one branch-ahead commit has no patch-id match
#     and no direct ancestry in origin/main.
#
# For "has-unique-delta" branches, also reports source files that:
#   - exist on both branch and main with different content
#   - exist only on the branch (added by the branch)
#
# This script does NOT delete, push, or modify any branch.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ref="${1:-origin/main}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Build patch-id index of $ref
git rev-list "$ref" > "$tmp/ref_shas.txt"
> "$tmp/ref_pids.txt"
while read -r sha; do
  pid=$(git log -1 --pretty=format: --patch "$sha" | git patch-id --stable | awk '{print $1}')
  echo "$pid $sha" >> "$tmp/ref_pids.txt"
done < "$tmp/ref_shas.txt"
sort -o "$tmp/ref_pids.txt" "$tmp/ref_pids.txt"

obsolete=()
equivalent=()
unique=()

for b in $(git branch --format='%(refname:short)' | grep -v -E '^(main|HEAD|worktree-agent-)'); do
  ahead=$(git rev-list --count "$ref".."$b" 2>/dev/null || echo 0)
  if [ "$ahead" = "0" ]; then
    obsolete+=("$b")
    continue
  fi
  unmerged=0
  equiv=0
  while read -r sha; do
    [ -z "$sha" ] && continue
    pid=$(git log -1 --pretty=format: --patch "$sha" | git patch-id --stable | awk '{print $1}')
    if grep -q "^$pid " "$tmp/ref_pids.txt"; then
      equiv=$((equiv+1))
    else
      unmerged=$((unmerged+1))
    fi
  done < <(git rev-list "$ref".."$b" 2>/dev/null)
  if [ "$unmerged" = "0" ]; then
    equivalent+=("$b ($equiv equiv)")
  else
    unique+=("$b ($unmerged unique + $equiv equiv)")
  fi
done

echo "=== OBSOLETE (no commits ahead of $ref) ==="
printf '  %s\n' "${obsolete[@]}"
echo
echo "=== MERGED-EQUIVALENT (every commit's patch-id matches $ref) ==="
printf '  %s\n' "${equivalent[@]}"
echo
echo "=== HAS UNIQUE DELTA (at least one commit with no patch-id match) ==="
printf '  %s\n' "${unique[@]}"

if [ "${#unique[@]}" -gt 0 ]; then
  echo
  echo "=== FILE-LEVEL OVERLAP FOR DELTA BRANCHES ==="
  for b in "${unique[@]}"; do
    name=$(echo "$b" | awk '{print $1}')
    files=$(git log "$ref".."$name" --name-only --pretty=format: | grep -v '^$' | sort -u)
    same=0; diff=0; add=0
    details=""
    for f in $files; do
      if [ -e "$f" ]; then
        bc=$(cat "$f")
        mc=$(git show "$ref:$f" 2>/dev/null || echo "__MISSING__")
        if [ "$bc" = "$mc" ]; then
          same=$((same+1))
        elif [ "$mc" = "__MISSING__" ]; then
          add=$((add+1))
          details="$details $f=ADD"
        else
          diff=$((diff+1))
          details="$details $f=DIFF"
        fi
      else
        if git cat-file -e "$ref:$f" 2>/dev/null; then
          diff=$((diff+1))
          details="$details $f=DEL-on-branch"
        else
          add=$((add+1))
          details="$details $f=ADD-on-branch"
        fi
      fi
    done
    printf '%-50s same=%-3s diff=%-3s add=%-3s\n' "$name" "$same" "$diff" "$add"
    [ -n "$details" ] && echo "    differing:$details"
  done
fi
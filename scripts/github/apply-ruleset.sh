#!/usr/bin/env bash
# Apply .github/rules.json to the current GitHub repository.
# Refuses to replace a stricter remote ruleset unless --allow-weaker is set.
# Does not delete unrelated rulesets.
set -euo pipefail

dry=0
allow_weaker=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --allow-weaker) allow_weaker=1 ;;
    -h|--help)
      echo "Usage: scripts/github/apply-ruleset.sh [--dry-run] [--allow-weaker]"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

root="$(cd "$(dirname "$0")/../.." && pwd)"
file="$root/.github/rules.json"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$file"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required and must be authenticated" >&2
  exit 1
fi

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
name="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).name)' "$file")"
local_enf="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).enforcement || "")' "$file")"

rank() {
  case "$1" in
    active) echo 3 ;;
    evaluate) echo 2 ;;
    disabled) echo 1 ;;
    *) echo 0 ;;
  esac
}

id=""
remote_enf=""
while IFS=$'\t' read -r row_id row_name row_enf; do
  if [[ "$row_name" == "$name" ]]; then
    if [[ -n "$id" ]]; then
      echo "more than one ruleset is named ${name}" >&2
      exit 1
    fi
    id="$row_id"
    remote_enf="$row_enf"
  fi
done < <(gh api --paginate "repos/${repo}/rulesets" --jq '.[] | [.id, .name, .enforcement] | @tsv')

if [[ -n "$id" ]]; then
  local_rank="$(rank "$local_enf")"
  remote_rank="$(rank "$remote_enf")"
  if (( remote_rank > local_rank )) && (( allow_weaker == 0 )); then
    echo "refusing to weaken ruleset ${id} from ${remote_enf} to ${local_enf}; pass --allow-weaker to override" >&2
    exit 1
  fi
  echo "would update ruleset ${id} (${remote_enf} -> ${local_enf}) on ${repo}"
  if (( dry == 1 )); then
    exit 0
  fi
  gh api --method PUT "repos/${repo}/rulesets/${id}" --input "$file" >/tmp/ember-ruleset.json
else
  echo "would create ruleset ${name} (${local_enf}) on ${repo}"
  if (( dry == 1 )); then
    exit 0
  fi
  gh api --method POST "repos/${repo}/rulesets" --input "$file" >/tmp/ember-ruleset.json
  id="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("/tmp/ember-ruleset.json","utf8")).id))')"
fi

echo "ruleset ${id} on https://github.com/${repo}/rules"

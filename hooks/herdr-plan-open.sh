#!/usr/bin/env bash
# herdr-plan-open: Claude Code PreToolUse hook for ExitPlanMode.
#
# When Claude asks to approve a plan inside a Herdr terminal, tells Herdr's sidebar (mod
# `projects`) which plan is waiting and where, so the plan panel opens beside that terminal:
#   ~/.local/state/herdr-devflow/plans/<HC_TERMINAL_ID>.json
#   = {"terminal":"t39","file":"/home/u/.claude/plans/x.md","session_id":"…","cwd":"…","at":1763500000000}
# `at` is ms since the epoch. A plan without a planFilePath is saved next to it as plan-<id>.md.
#
# In ~/.claude/settings.json: hooks.PreToolUse[{ matcher: "ExitPlanMode", hooks: [{ command: <this> }] }].
# Outside Herdr (no HC_TERMINAL_ID) it does nothing. Never blocks, never prints: always exits 0.
set -uo pipefail

main() {
  local id=${HC_TERMINAL_ID:-}
  [[ "$id" =~ ^[A-Za-z0-9_.-]+$ ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  local state=${HERDR_DEVFLOW_STATE:-$HOME/.local/state/herdr-devflow}/plans
  local input file session cwd plan at
  input=$(timeout 5 cat) || return 0
  file=$(jq -r '.tool_input.planFilePath // empty' <<<"$input" 2>/dev/null)
  session=$(jq -r '.session_id // empty' <<<"$input" 2>/dev/null)
  cwd=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)
  mkdir -p "$state" || return 0
  if [[ -z "$file" || ! -f "$file" ]]; then
    plan=$(jq -r '.tool_input.plan // empty' <<<"$input" 2>/dev/null)
    [[ -n "$plan" ]] || return 0
    file="$state/plan-$id.md"
    printf '%s\n' "$plan" >"$file.tmp" && mv -f "$file.tmp" "$file" || return 0
  fi
  at=$(date +%s%3N)
  jq -n --arg terminal "$id" --arg file "$file" --arg session "$session" --arg cwd "$cwd" --argjson at "$at" \
    '{terminal: $terminal, file: $file, session_id: $session, cwd: $cwd, at: $at}' >"$state/$id.json.tmp" \
    && mv -f "$state/$id.json.tmp" "$state/$id.json"
}

main >/dev/null 2>&1
exit 0

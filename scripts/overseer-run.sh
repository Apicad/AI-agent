#!/usr/bin/env bash
# Launch Claude Code with Overseer agent identity loaded.
# Default Claude Code session in ~/pixel-agents/ is regular dev mode;
# this launcher makes the session an Overseer instead.

set -euo pipefail

REPO="$HOME/pixel-agents"
PROMPT_FILE="$REPO/prompts/overseer.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "error: $PROMPT_FILE not found" >&2
  exit 1
fi

mkdir -p "$REPO/logs"
[ -f "$REPO/logs/event-log.jsonl" ] || : > "$REPO/logs/event-log.jsonl"

cd "$REPO"
exec claude --append-system-prompt "$(cat "$PROMPT_FILE")" "$@"

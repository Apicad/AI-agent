# AI-Agent

> A personal fork of **[Pixel Agents](https://github.com/pablodelucca/pixel-agents)**
> by Pablo De Lucca — the game-like interface where Claude Code agents become
> characters in a pixel-art office — customized with a **standalone web-app run mode**
> and a workflow for pairing agents with an **Obsidian knowledge vault**.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

Pixel Agents turns multi-agent AI systems into something you can see and manage. Each
Claude Code terminal becomes a character that walks to a desk and animates based on
what it's doing — typing when writing code, reading when searching files, waiting when
it needs your attention. It's **purely observational**: it watches Claude Code's JSONL
transcripts and never modifies Claude Code itself.

## What's different in this fork

The upstream project ships as a VS Code extension. This fork adds:

- **Standalone web-app run mode** — one command boots the UI, a Node backend
  (WebSocket + HTTP API), and a Claude Code hook receiver, so the canvas runs in a
  browser without VS Code.
- **Obsidian-vault workflow** — a documented pattern for letting spawned agents use
  an Obsidian markdown vault as a shared, persistent knowledge layer. See
  [`docs/obsidian-vault.md`](docs/obsidian-vault.md).
- **Vault fleet watcher + session mirroring** — with `PIXEL_AGENTS_VAULT_ROOT` set,
  the backend watches `fleet/board.md`, `projects/*/PHASE.md`, and `fleet/*/inbox/`,
  streams live fleet state (with board↔PHASE drift detection) into a Fleet panel,
  spawns agents from pending briefs, and **adopts external Claude sessions running in
  the vault as observed characters** — wire any project's Claude Code hooks through
  [`app/scripts/claude-hook.mjs`](app/scripts/claude-hook.mjs) and its sessions appear
  in the office live.

Everything else — the office canvas, characters, layout editor, asset system — is the
upstream project's work (see credit below).

## Quick start

```sh
# install dependencies (root + the two workspaces)
npm install
npm install --prefix app
npm install --prefix webview-ui

# start the UI and the backend together
npm run dev
```

`npm run dev` runs **both** the Vite UI and the Node backend (do not run
`cd webview-ui && npm run dev` — that starts only the frontend, so no agents spawn).

| URL                   | Role                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| http://localhost:5173 | UI — the pixel-art canvas                                            |
| :4000                 | Backend — WebSocket control bus (localhost-only, token/Origin gated) |
| :4001                 | Claude Code hook receiver                                            |

Open http://localhost:5173 and click **+ Agent** to spawn a Claude Code terminal and
its character.

## How it works

A lightweight canvas game loop renders the office; a character state machine
(idle → walk → type/read) reflects each agent's live activity, derived by polling the
agent's JSONL transcript under `~/.claude/projects/`. No changes to Claude Code are
required. Full overview in [`CLAUDE.md`](CLAUDE.md).

## Using it with an Obsidian vault

The visual app can be driven by an external control layer that spawns a lead agent
plus workers and pairs them with an Obsidian vault as a knowledge layer — agents read
a cached index on wake and write durable findings back into the vault. The
reproducible pattern (kept generic, no private content) is in
[`docs/obsidian-vault.md`](docs/obsidian-vault.md).

## Requirements

- **macOS** — terminal agents are spawned via AppleScript + `tmux`, so the CEO/terminal-mode
  flow is macOS-only. Headless agents work cross-platform; the canvas runs anywhere.
- Node **22** (`.nvmrc`)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in
- **tmux** (`brew install tmux`) — terminal agents run `claude` inside a tmux session so the
  backend can drive input reliably (no window-focus stealing, no Accessibility grant needed)
- On first terminal-agent spawn, macOS prompts for **Automation/Accessibility** for Terminal — grant it.

## Credits & license

This repository is a **fork** of **Pixel Agents**, © 2026 **Pablo De Lucca**,
released under the **MIT License**. The original copyright and permission notice are
retained verbatim in [`LICENSE`](LICENSE).

- Upstream project: https://github.com/pablodelucca/pixel-agents
- Characters: [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)

Modifications in this fork are by the repository owner and are likewise released under
the MIT License. If you find the original project useful, consider
[sponsoring Pablo De Lucca](https://github.com/sponsors/pablodelucca).

# CLAUDE.md — project overview

Orientation for Claude Code (and humans) working in this repository.

## What this is

A personal fork of **Pixel Agents** (© 2026 Pablo De Lucca, MIT) — a game-like
interface that turns Claude Code agents into characters in a pixel-art office. Each
agent becomes a character that walks to a desk and animates based on what it's
actually doing (typing when writing code, reading when searching files, waiting when
it needs your attention). It is **purely observational** — it watches Claude Code's
JSONL transcript files and never modifies Claude Code itself.

This fork adds a **standalone web-app run mode** (Vite UI + Node backend + a Claude
Code hook receiver) on top of the upstream VS Code extension, used to drive and
observe multi-agent workflows.

- Upstream: https://github.com/pablodelucca/pixel-agents
- Characters: based on [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)

## Run it

### Standalone dev mode (this fork — recommended)

```sh
cd webview-ui && npm run dev
```

Starts everything in one command:

| URL | Role |
|---|---|
| http://localhost:5173 | UI — Vite dev server (the pixel-art canvas) |
| :4000 | Backend — WebSocket + HTTP API (spawns/relays agents, tracks tokens) |
| :4001 | Hook receiver — Claude Code `Stop` / `SessionEnd` events |

### As a VS Code extension (upstream path)

```sh
npm install && (cd webview-ui && npm install) && npm run build
```

Then press **F5** to launch the Extension Development Host and open the **Pixel
Agents** panel.

**Requirements:** Node 22 (`.nvmrc`), the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured. macOS / Linux / Windows.

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Webview UI | React 19 · Vite · Canvas 2D · BFS pathfinding · character state machine | `webview-ui/` |
| Backend | Node · WebSocket + HTTP API | `server/`, `app/` |
| Hook receiver | Claude Code hook events → agent status | `server/` |
| VS Code extension host | TypeScript · esbuild | `src/` |
| Shared types | TypeScript | `shared/` |
| Pixel-art assets | per-item `manifest.json` (sprites, rotation/state groups, frames) | `webview-ui/public/assets/` |

## How status detection works

Pixel Agents polls each agent's JSONL transcript under `~/.claude/projects/`. Tool
starts/stops drive the character animation (write → typing, read → reading, etc.).
Detecting "waiting for input" / "turn finished" is **heuristic** (idle timers,
turn-duration events) and can misfire — see the README's *Known Limitations*.

## Multi-agent orchestration + Obsidian vault

The visual app can be driven by an external control layer that spawns a lead
("CEO") agent plus worker agents, and pairs them with an **Obsidian markdown vault**
used as a shared, persistent knowledge layer. The integration *pattern* is
documented in [`docs/obsidian-vault.md`](docs/obsidian-vault.md). The orchestration
scripts themselves live in a separate control repository and are **not** included
here.

## Conventions

- **Node 22** (`.nvmrc`); the webview pins `22.22.2` via Volta.
- **No secrets in git.** `.env` is gitignored; `.env.example` documents the vars
  (e.g. `PIXEL_AGENTS_DEBUG`, `PIXELLAB_API_KEY` for the optional asset-gen scripts).
- Lint/format via ESLint + Prettier; a `gitleaks` config is present for secret scanning.

## Credit & license

Fork of **Pixel Agents** by **Pablo De Lucca**, MIT-licensed. The original copyright
and permission notice are retained verbatim in [`LICENSE`](LICENSE); see the README
for full attribution. Modifications in this fork are by the repository owner.

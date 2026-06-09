# Using Pixel Agents with an Obsidian vault

This describes the **pattern** for pairing the agents you spawn and observe in this
app with an [Obsidian](https://obsidian.md) markdown vault that acts as a shared,
persistent **knowledge layer**. It's deliberately generic — swap in your own paths
and keep anything private out of any published repo. The orchestration scripts
referenced here live in a separate control layer and are **not** part of this
repository; this doc explains the shape so it can be reproduced.

## Two layers, one loop

```
┌──────────────────────────────┐      reads context     ┌──────────────────────────────┐
│  EXECUTION LAYER             │◄───────────────────────│  KNOWLEDGE LAYER             │
│  this app                    │                         │  an Obsidian vault           │
│  • canvas UI (:5173)         │      writes findings    │  • plain markdown            │
│  • backend WS/HTTP (:4000)   │───────────────────────►│  • browsable in Obsidian     │
│  • Claude Code hooks (:4001) │                         │  • the agents' shared memory │
└──────────────────────────────┘                         └──────────────────────────────┘
```

- **Execution layer** — *what you do*: the app spawns Claude Code agents and shows
  them as characters; a backend relays messages and tracks status.
- **Knowledge layer** — *what you know*: an Obsidian vault of markdown notes that
  agents read for context and write back to as they learn.

The point is the loop: **the vault makes a fresh agent smart → the agent does work →
durable knowledge is written back to the vault → the next agent starts smarter.**

## A vault shape that works well

```
~/your-vault/
├── index.md          # one-line catalog of every note, grouped by topic
├── log.md            # append-only event log (one line per action)
├── hot-cache.md      # a short "read me first" summary of the whole vault
├── raw/              # immutable source material (never edited by agents)
└── wiki/             # curated, agent-maintained notes
    ├── concepts/
    ├── projects/
    └── sources/      # one summary note per ingested source
```

Two rules keep it healthy:

1. **`raw/` is read-only.** Source material is never edited; corrections live in `wiki/`.
2. **`wiki/` is the agents' to maintain**, but humans can edit too — treat human edits
   as authoritative.

## The loop in practice

1. **On wake**, each agent reads `hot-cache.md` + `index.md` (and any note matching its
   task). This is the shared memory that stops a fresh spawn from starting cold.
2. **It does the work** in its own project directory.
3. **New durable knowledge** is written back as `wiki/sources/<slug>.md` (or a concept
   / project note), with a one-line entry appended to `log.md` and `index.md`.
4. **Four maintenance workflows** keep the vault coherent over time:
   - **Ingest** — turn a raw source into a summarized, cross-linked note.
   - **Query** — answer a question from the vault, with links back to the notes used.
   - **Lint** — find orphans, contradictions, stale claims, and broken links.
   - **Project-ops** — open / update / complete a project note as work progresses.

## Wiring it up

- Put the vault in any folder and open it in Obsidian. Use plain markdown with
  Obsidian wikilinks (`[[wiki/concepts/...]]`) so the graph view connects notes.
- Point each spawned agent at the vault through its **working directory** or a
  **context file**, and tell it to read `hot-cache.md` + `index.md` first.
- Optionally keep your orchestration/control scripts in a folder and **symlink** it
  inside the vault, so one tree serves both jobs.

## Keep it safe

- **The vault stays local.** Don't publish it. This app's repo and your private notes
  are separate things.
- Treat `hot-cache.md` and `index.md` as the cheapest, highest-leverage context —
  keep them current and most questions can be answered from those two files alone.
- Scrub anything sensitive (keys, internal URLs, private names) before it would ever
  leave your machine.

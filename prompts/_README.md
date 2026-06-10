# Agent Roster

Authoritative list of agents in this orchestration system.

## Permanent
- **overseer** — `overseer.md`. First contact for new projects, runs intake, writes kickoff events, monitors stalled work.
- **ceo** — `ceo.md`. Strategic decision-maker. Reviews phase outputs, approves/rejects, authorizes launches.
- **scrum-master** — `scrum-master.md`. Reads kickoffs, opens sprint board, breaks briefs into phases/tasks, dispatches build agents, runs QA cycles.

## Phase-persist (build agents — kept around through their phase, retired afterward)
- **frontend-dev** — `frontend-dev.md`. UI/React/Tailwind/HTML implementation.

(future: backend-dev, integration-dev, devops, security-officer, ux-designer, content-writer, asset-manager, seo-analyst)

## Ephemeral (spawned fresh per use)
- **qa-tester** — `qa-tester.md`. Verifies build agent claims, samples self-checks, emits pass/fail verdict.

## Workers
(no `.md` files — scoped prompts come from supervisor at spawn time)

---

## Reference docs
- `_phase-model.md` — phase lifecycle and event-type catalog (canonical orchestration spec)

## Adding an agent
1. Drop `<name>.md` in this directory with frontmatter (`name`, `version`, `role`, `status`).
2. Update this roster.
3. If a launcher script is needed, add it to `~/pixel-agents/scripts/<name>-run.sh` mirroring `overseer-run.sh`.
4. If the agent reads/writes new event types, document them in `_phase-model.md`.

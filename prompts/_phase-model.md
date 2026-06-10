# Phase Model & Event Catalog

This file documents the phase lifecycle and the canonical event types every agent reads/writes. Source of truth for orchestration mechanics.

---

## Phases

| # | Name | Owner | Output | Approver | Skip rules |
|---|------|-------|--------|----------|-----------|
| 1 | Research / Design | Scrum-Master (or build agent) | Design doc, tech stack, contract | feeds Phase 2 | Tier 1 |
| 2 | Design Sign-off | CEO | `phase.2.approved` | CEO | Tier 1 |
| 3 | Build | Build agents (frontend-dev, backend-dev, integration-dev) | Working code | QA-Tester (auto on green) | none |
| 4 | QA + Security | QA-Tester | Pass/fail verdict, security notes | CEO | Tier 1 |
| 5 | Launch | CEO | Deployed/runnable artifact | CEO | none |

Phase transitions are gated by events. The Scrum-Master is responsible for emitting `phase.opened.<N>` and `phase.<N>.complete`; the CEO emits `phase.<N>.approved` / `.rejected`.

---

## Event Type Catalog

Every event is one JSONL line in `~/pixel-agents/logs/event-log.jsonl`:

```json
{"ts":"<iso>","from":"<agent-name>","type":"<dotted-type>","target":"<agent-name|broadcast>","payload":{...}}
```

`target` is omitted for broadcast events.

### Intake (Overseer)
- `intake.requested` — user invoked `/intake` or natural-language detected
- `intake.approved` — CEO said APPROVED to draft
- `intake.abandoned` — `/cancel-intake` or 10-min stall
- `project.kickoff.requested` (target: scrum-master) — payload: `{name, brief, policy}`. Triggers Phase 1.

### Sprint management (Scrum-Master)
- `phase.opened.<N>` — phase N has begun
- `task.assigned` (target: build agent) — payload: `{taskId, spec, tier, acceptanceCriteria, phaseRef}`
- `qa.requested` (target: qa-tester) — payload: `{taskId, buildRef, tier}`
- `phase.signoff.requested` (target: ceo) — payload: `{phase, artifact, project}`
- `phase.<N>.complete` — phase N closed, next opening shortly

### Build agents (frontend-dev, backend-dev, integration-dev)
- `task.<id>.in-progress` — work started
- `task.<id>.ready-for-review` (target: scrum-master) — payload: `{taskId, files, verification, selfCheckResults}`
- `BLOCKED: missing input — <exact name>` — written as a regular text line in `event-log.jsonl` prefixed `BLOCKED:` (still valid JSONL by writing it as `{"type":"blocked", ...}`)

### QA-Tester
- `qa.verdict.pass` (target: scrum-master) — payload: `{taskId, verifiedCriteria, sampledChecks}`
- `qa.verdict.fail` (target: scrum-master) — payload: `{taskId, failures: [{criterion, reason}]}`

### CEO
- `phase.<N>.approved` — payload: `{project, notes?}`
- `phase.<N>.rejected` — payload: `{project, reason, fix}`
- `project.launched` — payload: `{project, artifact}`
- `escalation.requested` (target: overseer) — payload: `{question}`

---

## Agent → Event Subscription Matrix

| Agent | Subscribes (reads when this event lands) | Publishes |
|-------|------------------------------------------|-----------|
| Overseer | (none — driven by user input) | `intake.*`, `project.kickoff.requested` |
| Scrum-Master | `project.kickoff.requested[target=scrum-master]`, `task.<id>.ready-for-review`, `qa.verdict.*`, `phase.<N>.approved/rejected` | `phase.opened.<N>`, `task.assigned`, `qa.requested`, `phase.signoff.requested`, `phase.<N>.complete` |
| CEO | `phase.signoff.requested[target=ceo]`, `escalation.requested[target=ceo]` | `phase.<N>.approved/rejected`, `project.launched` |
| Build agents | `task.assigned[target=<self>]` | `task.<id>.in-progress/ready-for-review` |
| QA-Tester | `qa.requested[target=qa-tester]` | `qa.verdict.pass/fail` |

---

## Tier Inference

Scrum-Master infers tier from the brief's "Must build" list:

- **Tier 1 micro**: 1 deliverable, ≤20 lines of total code expected, no new dependencies.
- **Tier 2 standard**: 2–5 deliverables, ≤300 lines total, may add ≤2 dependencies.
- **Tier 3 complex**: 6+ deliverables, new architecture, new external services, security/auth touching code.

Override: brief's `Tier:` field if specified.

---

## Project Directory Convention

Each project lives in its own directory, NOT inside `~/pixel-agents/`. Convention:
- Tooling: `~/pixel-agents/` (this repo) — agent prompts, event log, sprint board
- Project work: `~/<project-name>/` or `~/projects/<project-name>/` — actual deliverables (code, configs)

Project path is recorded in the brief's `Deliverable` section and in the kickoff event's payload.

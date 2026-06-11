#!/usr/bin/env node
/**
 * spawn-fleet.mjs — boot the claude-brain fleet in the pixel office.
 *
 * Reads <vault>/fleet/roster.json and spawns: a terminal CEO (home =
 * <vault>/fleet/ceo, so SessionEnd memory appends land in fleet/ceo/CLAUDE.md,
 * never the root schema) + headless agents with their .claude/agents/<name>.md
 * identities injected as system prompts and homeZoneId wired to draw the org
 * tree on the canvas.
 *
 * Usage: node spawn-fleet.mjs --vault <path> [--reset] [--no-kickoff]
 *   --reset       clear all existing characters first (ids back to 1)
 *   --no-kickoff  skip the CEO orientation message
 *
 * Do not click spawn buttons in the UI while this runs (agentCreated
 * correlation matches by "new id", like the reference spawn-team).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  buildIdentityPrompt,
  connect,
  ensureDir,
  loadVaultRoster,
  parseArgs,
  resolveVault,
  sendMsg,
  sleep,
  waitFor,
} from './fleet-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const VAULT = resolveVault(args);
const roster = loadVaultRoster(VAULT);

const ws = await connect();
console.log(`[spawn-fleet] connected · vault: ${VAULT}`);

if (args.reset) {
  sendMsg(ws, { type: 'resetAgentCounter' });
  await waitFor(ws, (m) => m.type === 'agentSystemReset', 5000, 'agentSystemReset');
  console.log('[spawn-fleet] reset: all characters cleared, ids back to 1');
  await sleep(1000);
}

// ── CEO (terminal) ───────────────────────────────────────────────────────────
const ceoHome = join(VAULT, roster.ceo?.folder ?? 'fleet/ceo');
ensureDir(ceoHome);
const ceoMemory = join(ceoHome, 'CLAUDE.md');
if (!existsSync(ceoMemory)) {
  writeFileSync(
    ceoMemory,
    '# CEO Session Memory\n\n_Appended automatically by pixel-agents on SessionEnd. The schema lives at the vault root._\n',
  );
  console.warn('[spawn-fleet] seeded fleet/ceo/CLAUDE.md — commit it in the vault');
}

sendMsg(ws, {
  type: 'openClaude',
  folderPath: ceoHome,
  bypassPermissions: true,
  headless: false,
  isCeo: true,
  effort: roster.ceo?.effort,
});
const ceoCreated = await waitFor(
  ws,
  (m) => m.type === 'agentCreated' && m.isCeo,
  20000,
  'CEO agentCreated',
);
const ids = { ceo: ceoCreated.id };
const known = new Set([ceoCreated.id]);
sendMsg(ws, { type: 'setAgentMeta', id: ceoCreated.id, name: roster.ceo?.name ?? 'CEO' });
console.log(
  `[spawn-fleet] CEO #${ceoCreated.id} — terminal window opening (grant macOS Automation/Accessibility if prompted)`,
);
await sleep(4000);

// ── Agents (headless, parents-first) ─────────────────────────────────────────
for (const a of roster.agents) {
  const parentId = ids[a.parent];
  if (parentId === undefined) {
    console.warn(
      `[spawn-fleet] ${a.name}: parent "${a.parent}" not spawned yet — check roster order; skipping homeZone`,
    );
  }
  sendMsg(ws, {
    type: 'openClaude',
    folderPath: VAULT,
    bypassPermissions: true,
    headless: true,
    effort: a.effort,
  });
  const created = await waitFor(
    ws,
    (m) => m.type === 'agentCreated' && !known.has(m.id),
    10000,
    `${a.name} agentCreated`,
  );
  known.add(created.id);
  ids[a.name] = created.id;

  sendMsg(ws, {
    type: 'setAgentMeta',
    id: created.id,
    name: a.name,
    role: a.role,
    ...(parentId !== undefined ? { homeZoneId: String(parentId) } : {}),
    ...(a.mode ? { mode: a.mode } : {}),
  });
  sendMsg(ws, {
    type: 'setAgentSystemPrompt',
    agentName: a.name,
    systemPrompt: buildIdentityPrompt(VAULT, a.name),
    version: 1,
    lastTrained: new Date().toISOString(),
  });
  await waitFor(
    ws,
    (m) => m.type === 'agentPromptApplied' && m.agentName === a.name,
    10000,
    `${a.name} prompt ack`,
  );
  console.log(
    `[spawn-fleet] ${a.name} #${created.id} (${a.role}) ← parent ${a.parent} #${parentId ?? '?'}`,
  );
  await sleep(300);
}

// ── Roster + verify ──────────────────────────────────────────────────────────
sendMsg(ws, {
  type: 'saveAgentRoster',
  roster: {
    savedAt: new Date().toISOString(),
    vault: VAULT,
    agents: [
      { id: ids.ceo, name: roster.ceo?.name ?? 'CEO', role: 'ceo', parent: null },
      ...roster.agents.map((a) => ({
        id: ids[a.name],
        name: a.name,
        role: a.role,
        parent: a.parent,
      })),
    ],
  },
});
await waitFor(ws, (m) => m.type === 'agentRosterSaved', 5000, 'agentRosterSaved');

sendMsg(ws, { type: 'listAgents' });
const list = await waitFor(ws, (m) => m.type === 'agentsList', 5000, 'agentsList');
const expected = roster.agents.length + 1;
console.log(`[spawn-fleet] live agents: ${list.agents.length}/${expected}`);
if (list.agents.length !== expected) {
  console.warn('[spawn-fleet] count mismatch — check the UI before dispatching');
}

// ── CEO kickoff ──────────────────────────────────────────────────────────────
if (!args['no-kickoff']) {
  const chart = roster.agents
    .map((a) => `  ${a.name} #${ids[a.name]} (${a.role}, reports to ${a.parent} #${ids[a.parent]})`)
    .join('\n');
  const kickoff =
    `You are the claude-brain CEO running as the terminal character in the pixel office. ` +
    `Your home folder is fleet/ceo/ (this folder's CLAUDE.md is YOUR session memory; the vault schema is auto-loaded from the root and binds everyone). ` +
    `Your fleet is live:\n${chart}\n\n` +
    `Operating contract:\n` +
    `- Chat with the user right here.\n` +
    `- Dispatch work: write the inbox brief (fleet/<agent>/inbox/YYYY-MM-DD-<task>.md per the schema), then run: ` +
    `"${VAULT}/scripts/fleet-tools.sh" send --name <agent> --message "Execute the brief at <path>." --wait\n` +
    `- Gates: the user types APPROVED / EDIT: <changes> / CANCEL to you verbatim; you record the 3-line phase retro in the gate log, flip PHASE.md, commit "project: <name> — phase N".\n` +
    `- Rules 7 + 9: agents never run git — you review their diffs (boundaries: fleet/<self>/** + assigned areas + own wiki/agents page) and you commit with the schema's prefixes + control-file sweep.\n` +
    `- File contracts (briefs · PROGRESS frontmatter · handoffs · board · PHASE.md) are unchanged; the office is a view + message bus.\n\n` +
    `Reply with a 3-line readiness summary when you have read fleet/ceo/CLAUDE.md and the schema.`;
  sendMsg(ws, { type: 'sendAgentMessage', id: ids.ceo, message: kickoff });
  console.log('[spawn-fleet] CEO kickoff sent (terminal may take a few seconds to receive it)');
}

console.log('[spawn-fleet] done — open the canvas to see the org tree');
ws.close();
process.exit(0);

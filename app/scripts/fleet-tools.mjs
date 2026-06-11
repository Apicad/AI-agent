#!/usr/bin/env node
/**
 * fleet-tools.mjs — CLI message bus for the claude-brain fleet (backend :4000).
 *
 * Commands:
 *   status                                   list live agents (+role/parent from saved roster)
 *   send  --name <agent>|--id <N> --message "…" [--wait] [--timeout <sec>]
 *   mode  --name <agent>|--id <N> [--mode default|planner] [--effort none|low|medium|high|max]
 *   close --name <agent>|--id <N>
 *   spawn --name <agent> [--vault <path>]    respawn one roster agent (headless, identity + parent)
 *
 * send --wait prints the agent's final reply by diffing ~/.claude/projects
 * transcripts (new file for first turns; newest-modified fallback for resumed
 * sessions). To stop the whole system: kill the backend FIRST, then close the
 * CEO terminal (the CEO auto-relaunches while the backend is alive).
 */
import {
  buildIdentityPrompt,
  connect,
  findNewJsonl,
  lastAssistantText,
  loadSavedRoster,
  loadVaultRoster,
  newestModifiedSince,
  parseArgs,
  resolveVault,
  sendMsg,
  sleep,
  snapshotJsonls,
  waitFor,
} from './fleet-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

function usage(code = 1) {
  console.log(
    'usage: fleet-tools <status | send --name X --message "…" [--wait] [--timeout sec] | close --name X | spawn --name X>',
  );
  process.exit(code);
}
if (!cmd) usage();

const ws = await connect();

async function listAgents() {
  sendMsg(ws, { type: 'listAgents' });
  const m = await waitFor(ws, (x) => x.type === 'agentsList', 5000, 'agentsList');
  return m.agents;
}

async function resolveAgent() {
  if (args.id) return { id: Number(args.id), name: `#${args.id}` };
  if (!args.name) usage();
  const agents = await listAgents();
  const hit = agents.find((a) => (a.name ?? '').toLowerCase() === String(args.name).toLowerCase());
  if (!hit) {
    console.error(
      `Agent "${args.name}" not running. Live: ${agents.map((a) => a.name).join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  return { id: hit.id, name: hit.name };
}

switch (cmd) {
  case 'status': {
    const agents = await listAgents();
    const saved = loadSavedRoster();
    const meta = new Map((saved?.agents ?? []).map((a) => [a.name, a]));
    console.log(`live agents: ${agents.length}`);
    for (const a of agents.sort((x, y) => x.id - y.id)) {
      const m = meta.get(a.name);
      const kind = a.isCeo ? 'CEO·terminal' : a.headless ? 'headless' : 'terminal';
      const prompt = a.systemPrompt ? `prompt v${a.metadata?.version ?? '?'}` : 'no prompt';
      console.log(
        `  #${String(a.id).padEnd(3)} ${String(a.name ?? '(unnamed)').padEnd(18)} ${kind.padEnd(13)} ` +
          `${String(m?.role ?? '').padEnd(8)} ${m?.parent ? `→ ${m.parent}` : ''} · ${prompt}`,
      );
    }
    break;
  }

  case 'send': {
    if (!args.message) usage();
    const target = await resolveAgent();
    const timeoutMs = (Number(args.timeout) || 300) * 1000;
    const snap = args.wait ? snapshotJsonls() : null;
    const t0 = Date.now();

    sendMsg(ws, { type: 'sendAgentMessage', id: target.id, message: String(args.message) });

    const notReady = waitFor(ws, (m) => m.type === 'agentNotReady' && m.id === target.id, 3000, 'x')
      .then(() => 'notReady')
      .catch(() => null);

    if (!args.wait) {
      const fast = await Promise.race([notReady, sleep(3100).then(() => null)]);
      if (fast === 'notReady') {
        console.error(`Agent ${target.name} is not ready (ghost terminal?).`);
        process.exit(1);
      }
      console.log(`sent → ${target.name} #${target.id}`);
      break;
    }

    const active = waitFor(
      ws,
      (m) => m.type === 'agentStatus' && m.id === target.id && m.status === 'active',
      30000,
      'active status',
    );
    const first = await Promise.race([notReady, active.then(() => 'active')]);
    if (first === 'notReady') {
      console.error(`Agent ${target.name} is not ready (ghost terminal?).`);
      process.exit(1);
    }
    console.log(`${target.name} #${target.id} working…`);
    const done = await waitFor(
      ws,
      (m) => m.type === 'agentStatus' && m.id === target.id && m.status === 'waiting',
      timeoutMs,
      'turn completion',
    );
    const dur = done.durationMs ? `${(done.durationMs / 1000).toFixed(1)}s` : '?';
    console.log(`✓ done ${dur} · ↑${done.inputTokens ?? '?'} ↓${done.outputTokens ?? '?'}`);
    await sleep(3000);
    const jsonl = findNewJsonl(snap) ?? newestModifiedSince(t0);
    const text = jsonl ? lastAssistantText(jsonl) : null;
    console.log(text ? `\n${text}` : '(no transcript text recovered)');
    break;
  }

  case 'close': {
    const target = await resolveAgent();
    sendMsg(ws, { type: 'closeAgent', id: target.id });
    await sleep(500);
    console.log(`closed ${target.name} #${target.id}`);
    break;
  }

  case 'mode': {
    // Set reasoning mode/effort on a live agent. mode: default|planner ·
    // effort: none|low|medium|high|max (applied on the agent's next turn).
    const target = await resolveAgent();
    if (!args.mode && !args.effort) {
      console.error('pass --mode <default|planner> and/or --effort <none|low|medium|high|max>');
      process.exit(1);
    }
    const meta = { type: 'setAgentMeta', id: target.id };
    if (args.mode) meta.mode = String(args.mode);
    if (args.effort) meta.effort = String(args.effort);
    sendMsg(ws, meta);
    await sleep(300);
    console.log(
      `${target.name} #${target.id}: mode=${args.mode ?? '(unchanged)'} effort=${args.effort ?? '(unchanged)'}`,
    );
    break;
  }

  case 'spawn': {
    if (!args.name) usage();
    const vault = resolveVault(args);
    const vaultRoster = loadVaultRoster(vault);
    const entry = vaultRoster.agents.find((a) => a.name === args.name);
    if (!entry) {
      console.error(`"${args.name}" not in fleet/roster.json`);
      process.exit(1);
    }
    const live = await listAgents();
    const parent = live.find((a) => (a.name ?? '').toLowerCase() === entry.parent.toLowerCase());
    const before = new Set(live.map((a) => a.id));
    sendMsg(ws, { type: 'openClaude', folderPath: vault, bypassPermissions: true, headless: true });
    const created = await waitFor(
      ws,
      (m) => m.type === 'agentCreated' && !before.has(m.id),
      10000,
      'agentCreated',
    );
    sendMsg(ws, {
      type: 'setAgentMeta',
      id: created.id,
      name: entry.name,
      role: entry.role,
      ...(parent ? { homeZoneId: String(parent.id) } : {}),
    });
    sendMsg(ws, {
      type: 'setAgentSystemPrompt',
      agentName: entry.name,
      systemPrompt: buildIdentityPrompt(vault, entry.name),
      version: 1,
      lastTrained: new Date().toISOString(),
    });
    await waitFor(
      ws,
      (m) => m.type === 'agentPromptApplied' && m.agentName === entry.name,
      10000,
      'prompt ack',
    );
    console.log(
      `spawned ${entry.name} #${created.id}${parent ? ` ← parent ${parent.name} #${parent.id}` : ''}`,
    );
    break;
  }

  default:
    usage();
}

ws.close();
process.exit(0);

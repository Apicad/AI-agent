/**
 * fleet-lib.mjs — shared helpers for spawn-fleet.mjs / fleet-tools.mjs.
 * CLI clients of the pixel-agents backend WS control bus (:4000).
 * Adapted from the reference orchestration tooling (ceo-agent-tools.mjs).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import * as os from 'os';
import { join } from 'path';
import { WebSocket } from 'ws';

export const BUS_URL = process.env.PIXEL_AGENTS_WS || 'ws://localhost:4000';
export const JSONL_ROOT = join(os.homedir(), '.claude', 'projects');

/** The control bus accepts a localhost browser Origin or this Bearer token;
 *  Node clients send no Origin, so read the token the backend wrote to server.json. */
function busAuthHeaders() {
  try {
    const sj = JSON.parse(
      readFileSync(join(os.homedir(), '.pixel-agents', 'server.json'), 'utf-8'),
    );
    if (sj?.token) return { Authorization: `Bearer ${sj.token}` };
  } catch {
    /* server.json missing → backend down; connect() reports the unreachable error */
  }
  return {};
}

// ── args ─────────────────────────────────────────────────────────────────────

export function parseArgs(rawArgs) {
  const result = { _: [] };
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rawArgs[i + 1];
      if (!next || next.startsWith('--')) {
        result[key] = true;
      } else {
        result[key] = next;
        i++;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

// ── WS bus ───────────────────────────────────────────────────────────────────

export function connect(url = BUS_URL) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: busAuthHeaders() });
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `Cannot reach backend at ${url} — is the office running? (office / scripts/pixel-agents.sh)`,
          ),
        ),
      5000,
    );
    ws.on('open', () => {
      clearTimeout(t);
      resolve(ws);
    });
    ws.on('error', (e) => {
      clearTimeout(t);
      reject(new Error(`Backend connection failed (${url}): ${e.message}`));
    });
  });
}

export const sendMsg = (ws, obj) => ws.send(JSON.stringify(obj));

/** Resolve when a broadcast matching pred arrives; reject on timeout. */
export function waitFor(ws, pred, timeoutMs, label = 'reply') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`));
    }, timeoutMs);
    function onMsg(data) {
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (pred(m)) {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(m);
      }
    }
    ws.on('message', onMsg);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── JSONL transcript recovery ────────────────────────────────────────────────

export function snapshotJsonls() {
  const snap = new Set();
  (function walk(dir) {
    try {
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        if (statSync(full).isDirectory()) walk(full);
        else if (f.endsWith('.jsonl')) snap.add(full);
      }
    } catch {
      /* unreadable dirs are fine */
    }
  })(JSONL_ROOT);
  return snap;
}

/** Newest .jsonl that wasn't in the snapshot — the spawned session's transcript. */
export function findNewJsonl(snap) {
  const found = [];
  (function walk(dir) {
    try {
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        if (statSync(full).isDirectory()) walk(full);
        else if (f.endsWith('.jsonl') && !snap.has(full)) found.push(full);
      }
    } catch {
      /* ignore */
    }
  })(JSONL_ROOT);
  if (!found.length) return null;
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** Resumed sessions append to an EXISTING file — fall back to newest-modified since t0. */
export function newestModifiedSince(t0) {
  let best = null;
  let bestM = t0;
  (function walk(dir) {
    try {
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (f.endsWith('.jsonl') && st.mtimeMs > bestM) {
          best = full;
          bestM = st.mtimeMs;
        }
      }
    } catch {
      /* ignore */
    }
  })(JSONL_ROOT);
  return best;
}

export function lastAssistantText(jsonlPath) {
  try {
    const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
    let last = null;
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
          const text = r.message.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('');
          if (text.trim()) last = text.trim();
        }
      } catch {
        /* skip malformed line */
      }
    }
    return last;
  } catch {
    return null;
  }
}

// ── vault + roster ───────────────────────────────────────────────────────────

export function resolveVault(args) {
  const vault = args.vault || process.env.PIXEL_AGENTS_VAULT_ROOT;
  if (!vault || !existsSync(vault)) {
    throw new Error('Vault not found — pass --vault <path> or set PIXEL_AGENTS_VAULT_ROOT.');
  }
  return vault;
}

export function loadVaultRoster(vault) {
  const p = join(vault, 'fleet', 'roster.json');
  if (!existsSync(p)) throw new Error(`Roster not found: ${p}`);
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export function loadSavedRoster() {
  const p = join(os.homedir(), '.pixel-agents', 'roster.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Strip YAML frontmatter from an agent identity file; return the body. */
export function identityBody(md) {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return (m ? md.slice(m[0].length) : md).trim();
}

export function buildIdentityPrompt(vault, name) {
  const idPath = join(vault, '.claude', 'agents', `${name}.md`);
  const body = identityBody(readFileSync(idPath, 'utf-8'));
  return (
    `You are ${name}, a claude-brain fleet agent. The vault at ${vault} is your working context; ` +
    `its CLAUDE.md is the schema that binds you (rules 7 and 9 especially: never run git commit; ` +
    `write only fleet/${name}/** plus areas a brief assigns, plus your own wiki/agents page). ` +
    `Run your WAKE-UP procedure before acting on any dispatch.\n\n${body}`
  );
}

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

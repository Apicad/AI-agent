// agentHistoryStore.ts — persistent per-agent cumulative totals across server restarts.
//
// Problem (Pillar D2): the frontend accumulates per-agent totals from `agentHistory[]`
// in memory. When the backend restarts, frontend reconnects via `existingAgents` event
// but no historical totals are sent → Summary tab resets to zero. The user explicitly
// asked: "we must be able to keep track of that all times until the project is done."
//
// Fix: backend maintains its own cumulative totals. Persisted to disk on every turn
// complete. Loaded on backend startup. Included in `existingAgents` payload so the
// frontend rehydrates Summary tab on connect.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface AgentTotals {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  turnCount: number;
  lastTurnAt: number;     // ms epoch
  // project field intentionally omitted from V1 — tracking project boundaries is
  // a future enhancement (the user said "until the project is done"; for now we
  // persist forever and provide an explicit clear endpoint).
}

const STORE_DIR = join(homedir(), '.pixel-agents');
const STORE_PATH = join(STORE_DIR, 'agent-history.json');

let totals: Record<number, AgentTotals> = {};
let loaded = false;
let writeTimer: NodeJS.Timeout | undefined;

/**
 * Load persisted totals into memory. Idempotent.
 * Call on backend startup BEFORE clients connect.
 */
export function loadAgentHistory(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(STORE_PATH)) {
    totals = {};
    return;
  }
  try {
    const raw = readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    // Coerce keys to numbers (JSON serializes them as strings).
    totals = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (!Number.isFinite(id)) continue;
      totals[id] = v as AgentTotals;
    }
  } catch (err) {
    console.warn(`[agentHistoryStore] Could not load ${STORE_PATH}: ${(err as Error).message}. Starting empty.`);
    totals = {};
  }
}

/**
 * Save totals to disk. Debounced 500ms — multiple turns in quick succession
 * coalesce into one write. Use flushAgentHistory() for synchronous writes.
 */
function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    flushAgentHistory();
  }, 500);
}

/**
 * Force a synchronous write. Call on graceful shutdown.
 */
export function flushAgentHistory(): void {
  try {
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(totals, null, 2));
  } catch (err) {
    console.warn(`[agentHistoryStore] Could not write ${STORE_PATH}: ${(err as Error).message}`);
  }
}

/**
 * Record a completed turn. Accumulates into the agent's running totals
 * and schedules a debounced disk write.
 *
 * Called from BOTH the Stop hook handler in index.ts AND the JSONL-polling
 * waiting timer in transcriptProcessor.ts. Both paths converge here so the
 * store is the single source of truth for cumulative state.
 *
 * Skipping is fine — if durationMs/inputTokens/outputTokens are undefined,
 * we don't accumulate them but still bump turnCount + lastTurnAt.
 */
export function recordTurnComplete(
  agentId: number,
  durationMs: number | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): void {
  if (!loaded) loadAgentHistory();
  const t = totals[agentId] ?? {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
    turnCount: 0,
    lastTurnAt: 0,
  };
  if (typeof durationMs === 'number' && durationMs > 0) t.totalDurationMs += durationMs;
  if (typeof inputTokens === 'number' && inputTokens > 0) t.totalInputTokens += inputTokens;
  if (typeof outputTokens === 'number' && outputTokens > 0) t.totalOutputTokens += outputTokens;
  t.turnCount += 1;
  t.lastTurnAt = Date.now();
  totals[agentId] = t;
  scheduleWrite();
}

/**
 * Snapshot of all agent totals for inclusion in the existingAgents WS payload.
 * Returns a fresh object — caller owns it.
 */
export function getAgentHistorySnapshot(): Record<number, AgentTotals> {
  if (!loaded) loadAgentHistory();
  return { ...totals };
}

/**
 * Clear totals for one agent (e.g., when starting a fresh project for that agent).
 * Persists immediately.
 */
export function clearAgentHistory(agentId: number): void {
  if (!loaded) loadAgentHistory();
  delete totals[agentId];
  flushAgentHistory();
}

/**
 * Clear ALL agent totals. Use when explicitly resetting state (e.g., new project
 * boundary, or admin "wipe history" action). Persists immediately.
 */
export function clearAllAgentHistory(): void {
  totals = {};
  loaded = true;
  flushAgentHistory();
}

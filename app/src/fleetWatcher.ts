/**
 * Fleet Watcher — read-only bridge to a claude-brain style vault.
 *
 * Watches the vault's fleet tree (the file contract defined in the vault's
 * CLAUDE.md) and broadcasts a parsed snapshot over WebSocket:
 *   - fleet/board.md                 → per-project agent/task/tier/status rows
 *   - projects/<slug>/PHASE.md       → phase number, gate state, gate log, plans
 *   - fleet/<agent>/inbox/*.md       → pending briefs per agent
 *
 * Purely observational: never writes to the vault.
 */
import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FleetBoardRow {
  agent: string;
  task: string;
  tier: string;
  status: string;
}

export interface FleetPhasePlanItem {
  text: string;
  done: boolean;
}

export interface FleetPhasePlan {
  title: string;
  items: FleetPhasePlanItem[];
}

export interface FleetProject {
  slug: string;
  /** Phase as reported on the board section heading (may lag PHASE.md). */
  boardPhase: number | null;
  boardGate: string | null;
  rows: FleetBoardRow[];
  blockers: string | null;
  nextGate: string | null;
  /** Truth from projects/<slug>/PHASE.md (CEO-only file). */
  phase: number | null;
  phaseName: string | null;
  gate: string | null;
  gateLog: string[];
  plans: FleetPhasePlan[];
}

export interface FleetState {
  vaultRoot: string;
  boardUpdated: string | null;
  activeProjects: string[];
  idleRoster: string[];
  projects: FleetProject[];
  /** agent name → pending brief filenames in fleet/<agent>/inbox/ */
  inboxes: Record<string, string[]>;
  /** Detected inconsistencies, e.g. board phase ≠ PHASE.md phase. */
  drift: string[];
  generatedAt: number;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────
// The vault uses "·" (middle dot) and "—" (em dash) as separators; accept
// ASCII fallbacks too so hand-edited files still parse.

const DASH = '[—–-]';

function readFileSafe(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function listDirSafe(p: string): string[] {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

/** Parse a markdown table body row: `| a | b | c | d |` */
function parseTableRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  const cells = t
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
  // Skip separator rows like |---|---|
  if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) return null;
  return cells;
}

export function parseBoard(md: string): {
  updated: string | null;
  activeProjects: string[];
  idleRoster: string[];
  projects: Map<string, Omit<FleetProject, 'phase' | 'phaseName' | 'gate' | 'gateLog' | 'plans'>>;
} {
  const updated = md.match(/^Updated:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/m)?.[1] ?? null;
  const activeMatch = md.match(/Active projects:\s*(.+)$/m)?.[1] ?? '';
  const activeProjects = activeMatch
    .split(/[,·]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.toLowerCase() !== 'none');

  // Idle roster: the first non-empty, non-comment line after "## Idle roster"
  let idleRoster: string[] = [];
  const idleSection = md.match(/^## Idle roster\s*\n([\s\S]*?)(?=^## |\n<!--|$(?![\s\S]))/m);
  if (idleSection) {
    const line = idleSection[1]
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('<!--'));
    if (line) {
      idleRoster = line
        .split(/[·,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  // Project sections: ## <slug> (Phase N — gate: <state>)
  const projects = new Map<
    string,
    Omit<FleetProject, 'phase' | 'phaseName' | 'gate' | 'gateLog' | 'plans'>
  >();
  const sectionRe = new RegExp(
    `^## ([\\w-]+) \\(Phase (\\d+) ${DASH}\\s*gate:\\s*([\\w-]+)\\)\\s*$`,
    'gm',
  );
  let m: RegExpExecArray | null;
  const sections: { slug: string; phase: number; gate: string; start: number }[] = [];
  while ((m = sectionRe.exec(md)) !== null) {
    sections.push({
      slug: m[1],
      phase: parseInt(m[2], 10),
      gate: m[3],
      start: m.index + m[0].length,
    });
  }
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const end = i + 1 < sections.length ? sections[i + 1].start : md.length;
    const body = md.slice(s.start, end);
    const rows: FleetBoardRow[] = [];
    for (const line of body.split('\n')) {
      const cells = parseTableRow(line);
      if (!cells || cells.length < 4) continue;
      if (cells[0].toLowerCase() === 'agent') continue; // header
      rows.push({ agent: cells[0], task: cells[1], tier: cells[2], status: cells[3] });
    }
    const blockers = body.match(/^Blockers:\s*(.+)$/m)?.[1]?.trim() ?? null;
    const nextGate = body.match(/^Next gate:\s*(.+)$/m)?.[1]?.trim() ?? null;
    projects.set(s.slug, {
      slug: s.slug,
      boardPhase: s.phase,
      boardGate: s.gate,
      rows,
      blockers,
      nextGate,
    });
  }
  return { updated, activeProjects, idleRoster, projects };
}

export function parsePhaseFile(md: string): {
  phase: number | null;
  phaseName: string | null;
  gate: string | null;
  gateLog: string[];
  plans: FleetPhasePlan[];
} {
  // Header line: `phase: 4 · name: QA + Launch · gate: open`
  const phase = md.match(/^phase:\s*(\d+)/m)
    ? parseInt(md.match(/^phase:\s*(\d+)/m)![1], 10)
    : null;
  const phaseName = md.match(/name:\s*([^·\n]+?)\s*(?:·|$)/m)?.[1]?.trim() ?? null;
  const gate = md.match(/gate:\s*([\w-]+)/m)?.[1] ?? null;

  const gateLog: string[] = [];
  const gateSection = md.match(/^## Gate log[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (gateSection) {
    for (const line of gateSection[1].split('\n')) {
      const t = line.trim();
      if (t.startsWith('- ')) gateLog.push(t.slice(2).trim());
    }
  }

  const plans: FleetPhasePlan[] = [];
  const planRe = /^## (Phase \d+ plan[^\n]*)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  let pm: RegExpExecArray | null;
  while ((pm = planRe.exec(md)) !== null) {
    const items: FleetPhasePlanItem[] = [];
    for (const line of pm[2].split('\n')) {
      const im = line.trim().match(/^- \[([ xX])\]\s*(.+)$/);
      if (im) items.push({ done: im[1].toLowerCase() === 'x', text: im[2].trim() });
    }
    plans.push({ title: pm[1].trim(), items });
  }
  return { phase, phaseName, gate, gateLog, plans };
}

// ── Snapshot builder ─────────────────────────────────────────────────────────

export function buildFleetState(vaultRoot: string): FleetState {
  const drift: string[] = [];
  const boardMd = readFileSafe(path.join(vaultRoot, 'fleet', 'board.md'));
  const board = boardMd
    ? parseBoard(boardMd)
    : { updated: null, activeProjects: [], idleRoster: [], projects: new Map() };
  if (!boardMd) drift.push('fleet/board.md not found');

  // Inboxes: every fleet/<agent>/inbox/*.md is a pending brief
  const inboxes: Record<string, string[]> = {};
  for (const entry of listDirSafe(path.join(vaultRoot, 'fleet'))) {
    const inboxDir = path.join(vaultRoot, 'fleet', entry, 'inbox');
    let stat: fs.Stats;
    try {
      stat = fs.statSync(inboxDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const briefs = listDirSafe(inboxDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    if (briefs.length > 0) inboxes[entry] = briefs;
  }

  // Projects: union of board sections and projects/<slug>/ dirs with a PHASE.md
  const slugs = new Set<string>(board.projects.keys());
  for (const entry of listDirSafe(path.join(vaultRoot, 'projects'))) {
    if (fs.existsSync(path.join(vaultRoot, 'projects', entry, 'PHASE.md'))) slugs.add(entry);
  }

  const projects: FleetProject[] = [];
  for (const slug of [...slugs].sort()) {
    const boardSection = board.projects.get(slug);
    const phaseMd = readFileSafe(path.join(vaultRoot, 'projects', slug, 'PHASE.md'));
    const phaseInfo = phaseMd
      ? parsePhaseFile(phaseMd)
      : { phase: null, phaseName: null, gate: null, gateLog: [], plans: [] };
    if (boardSection && phaseInfo.phase !== null && boardSection.boardPhase !== phaseInfo.phase) {
      drift.push(
        `${slug}: board.md says Phase ${boardSection.boardPhase} but PHASE.md says Phase ${phaseInfo.phase} — board needs a refresh`,
      );
    }
    if (boardSection && !phaseMd)
      drift.push(`${slug}: on board but projects/${slug}/PHASE.md missing`);
    projects.push({
      slug,
      boardPhase: boardSection?.boardPhase ?? null,
      boardGate: boardSection?.boardGate ?? null,
      rows: boardSection?.rows ?? [],
      blockers: boardSection?.blockers ?? null,
      nextGate: boardSection?.nextGate ?? null,
      ...phaseInfo,
    });
  }

  return {
    vaultRoot,
    boardUpdated: board.updated,
    activeProjects: board.activeProjects,
    idleRoster: board.idleRoster,
    projects,
    inboxes,
    drift,
    generatedAt: Date.now(),
  };
}

// ── Watcher ──────────────────────────────────────────────────────────────────

export interface FleetWatcher {
  getState(): FleetState;
  dispose(): void;
}

const DEBOUNCE_MS = 300;

export function startFleetWatcher(
  vaultRoot: string,
  broadcast: (msg: object) => void,
): FleetWatcher {
  let state = buildFleetState(vaultRoot);
  let lastJson = JSON.stringify({ ...state, generatedAt: 0 });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watchers: fs.FSWatcher[] = [];

  const refresh = (): void => {
    timer = null;
    const next = buildFleetState(vaultRoot);
    const nextJson = JSON.stringify({ ...next, generatedAt: 0 });
    if (nextJson !== lastJson) {
      state = next;
      lastJson = nextJson;
      broadcast({ type: 'fleetState', state });
    }
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE_MS);
  };

  for (const sub of ['fleet', 'projects']) {
    const dir = path.join(vaultRoot, sub);
    if (!fs.existsSync(dir)) continue;
    try {
      // recursive fs.watch is supported on macOS/Windows and Linux on Node ≥20
      watchers.push(fs.watch(dir, { recursive: true }, schedule));
    } catch (err) {
      console.error(`[Pixel Agents] Fleet watcher failed for ${dir}:`, err);
    }
  }
  console.log(
    `[Pixel Agents] Fleet watcher active on ${vaultRoot} (${state.projects.length} project(s), ${Object.keys(state.inboxes).length} inbox(es) with briefs)`,
  );

  return {
    getState: () => state,
    dispose: () => {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}

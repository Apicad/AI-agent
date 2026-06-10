import * as child_process from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { BroadcastFn } from './transcriptProcessor.js';
import { readNewLines } from './transcriptProcessor.js';
import type { AgentEffort, AgentMode, PersistedAppAgent, StandaloneAgent } from './types.js';

const JSONL_POLL_INTERVAL_MS = 500;
const JSONL_DISCOVERY_INTERVAL_MS = 500;
const JSONL_DISCOVERY_TIMEOUT_MS = 30_000;

// Resolve the `claude` binary path once at startup.
// Claude installs to ~/.local/bin/claude which isn't always in PATH.
const LOCAL_BIN = path.join(os.homedir(), '.local', 'bin');
const CLAUDE_LOCAL = path.join(LOCAL_BIN, 'claude');
export const CLAUDE_BIN = fs.existsSync(CLAUDE_LOCAL) ? CLAUDE_LOCAL : 'claude';
// PATH augmented with the local-bin dir so child processes can find claude
const AUGMENTED_PATH = fs.existsSync(LOCAL_BIN)
  ? `${LOCAL_BIN}:${process.env.PATH ?? ''}`
  : (process.env.PATH ?? '');

// Additional working directories injected at agent spawn via `--add-dir`. Without
// these, the headless sandbox locks each agent's Read/Write access to its own CWD,
// blocking cross-directory project work. Set PIXEL_AGENTS_WORKSPACE_DIRS to a
// comma-separated list of absolute paths your agents should be allowed to use
// (defaults to the temp dirs). On macOS, /tmp resolves to /private/tmp.
const WORKSPACE_DIRS = (process.env.PIXEL_AGENTS_WORKSPACE_DIRS ?? '/tmp,/private/tmp')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);
const ADD_DIR_ARGS = WORKSPACE_DIRS.flatMap((d) => ['--add-dir', d]);
const ADD_DIR_SHELL = WORKSPACE_DIRS.map((d) => `--add-dir ${JSON.stringify(d)}`).join(' ');

/** Derive the Claude project dir path from a workspace folder path. */
export function getProjectDirPath(folderPath: string): string {
  const dirName = folderPath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);
  console.log(`[Pixel Agents] Project dir: ${folderPath} → ${dirName}`);

  if (!fs.existsSync(projectDir)) {
    const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
    try {
      if (fs.existsSync(projectsRoot)) {
        const candidates = fs.readdirSync(projectsRoot);
        const lowerDirName = dirName.toLowerCase();
        const match = candidates.find((c) => c.toLowerCase() === lowerDirName);
        if (match && match !== dirName) {
          return path.join(projectsRoot, match);
        }
        if (!match) {
          console.warn(`[Pixel Agents] Project dir does not exist: ${projectDir}`);
        }
      }
    } catch {
      // Ignore scan errors
    }
  }
  return projectDir;
}

/** Escape a string for use as an AppleScript double-quoted string literal. */
function appleScriptStr(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * The ONLY reliable way to send input to a terminal Claude session on macOS.
 * printf/echo > ttyPath only affects display — Claude never sees it.
 * AppleScript keystroke goes through Terminal's PTY master = real keyboard input.
 */
export function appleScriptTypeInTerminal(
  ttyPath: string,
  message: string,
  pressReturn = true,
  preDelay = 0.3,
): void {
  const scptFile = path.join(
    os.tmpdir(),
    `pixel-type-${Date.now()}-${Math.random().toString(36).slice(2)}.scpt`,
  );
  const lines: string[] = [];
  if (message) lines.push(`    keystroke ${JSON.stringify(message)}`, '    delay 0.1');
  if (pressReturn) lines.push('    keystroke return');
  if (lines.length === 0) return;

  const appleScript = [
    'set foundTab to false',
    'tell application "Terminal"',
    '  repeat with w in windows',
    '    repeat with t in tabs of w',
    `      if tty of t is "${ttyPath}" then`,
    '        set index of w to 1',
    '        set selected tab of w to t',
    '        set foundTab to true',
    '        exit repeat',
    '      end if',
    '    end repeat',
    '    if foundTab then exit repeat',
    '  end repeat',
    '  if foundTab then activate',
    'end tell',
    'if foundTab then',
    `  delay ${preDelay}`,
    '  tell application "System Events"',
    ...lines,
    '  end tell',
    'end if',
  ].join('\n');

  fs.writeFileSync(scptFile, appleScript);
  child_process.exec(`osascript "${scptFile}"`, (err) => {
    fs.unlink(scptFile, () => {});
    if (err) console.error('[Pixel Agents] AppleScript type error:', err.message);
  });
}

const EFFORT_INSTRUCTIONS: Record<string, string> = {
  low: 'Keep responses concise and minimal.',
  medium: 'Use balanced thoroughness — not too brief, not exhaustive.',
  high: 'Be thorough and detailed in your reasoning.',
  max: 'Use MAXIMUM effort — apply your deepest reasoning and most thorough analysis. Leave nothing unexplored.',
};

export function buildInstruction(mode?: string, effort?: string): string {
  const parts: string[] = [];
  if (mode === 'planner')
    parts.push(
      'Before executing any changes, thoroughly analyze the request and present a detailed plan for user approval first.',
    );
  if (effort && EFFORT_INSTRUCTIONS[effort]) parts.push(EFFORT_INSTRUCTIONS[effort]);
  return parts.join(' ');
}

export class AgentManager {
  private agents: Map<number, StandaloneAgent> = new Map();
  private waitingTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private permissionTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private nextAgentId = 1;
  private broadcast: BroadcastFn;

  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast;
  }

  getAgents(): Map<number, StandaloneAgent> {
    return this.agents;
  }

  resetIdCounter(opts?: { clearAgents?: boolean }): void {
    if (opts?.clearAgents) {
      for (const id of [...this.agents.keys()]) {
        this.removeAgent(id, true);
      }
    }
    this.nextAgentId = 1;
  }

  getWaitingTimers(): Map<number, ReturnType<typeof setTimeout>> {
    return this.waitingTimers;
  }

  getPermissionTimers(): Map<number, ReturnType<typeof setTimeout>> {
    return this.permissionTimers;
  }

  /** Launch a new Claude agent. Returns the new agent ID. */
  hasCeoAgent(): boolean {
    for (const a of this.agents.values()) if (a.isCeo) return true;
    return false;
  }

  getCeoAgent(): StandaloneAgent | undefined {
    for (const a of this.agents.values()) if (a.isCeo) return a;
    return undefined;
  }

  async writeCeoSessionToClaudeMd(agent: StandaloneAgent): Promise<void> {
    if (!agent.jsonlFile || !fs.existsSync(agent.jsonlFile)) return;
    try {
      const lines = fs.readFileSync(agent.jsonlFile, 'utf8').trim().split('\n');
      const blocks: string[] = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (e.type === 'assistant' && e.message?.content) {
            for (const b of e.message.content as { type: string; text?: string }[]) {
              if (b.type === 'text' && b.text?.trim()) blocks.push(b.text.trim());
            }
          }
        } catch {
          /* ignore malformed lines */
        }
      }
      if (blocks.length === 0) return;
      const ts = new Date()
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, ' UTC');
      const entry = `\n\n## CEO Agent Session — ${ts}\n\n${blocks.join('\n\n---\n\n')}\n`;
      const claudeMdPath = path.join(agent.folderPath, 'CLAUDE.md');
      fs.appendFileSync(claudeMdPath, entry, 'utf8');
      console.log(`[Pixel Agents] CEO agent ${agent.id}: session written to CLAUDE.md`);
    } catch (err) {
      console.error(`[Pixel Agents] CEO agent ${agent.id}: failed writing CLAUDE.md:`, err);
    }
  }

  async launchAgent(
    folderPath: string,
    bypassPermissions = false,
    mode?: AgentMode,
    headless = false,
    headlessModel?: string,
    effort?: AgentEffort,
    isCeo = false,
  ): Promise<number> {
    const sessionId = crypto.randomUUID();
    const agentId = this.nextAgentId++;
    const folderName = path.basename(folderPath);
    const projectDir = getProjectDirPath(folderPath);

    const agent: StandaloneAgent = {
      id: agentId,
      sessionId,
      projectDir,
      jsonlFile: '',
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      hookDelivered: false,
      folderPath,
      folderName,
      lastDataAt: 0,
      linesProcessed: 0,
      turnInputTokens: 0,
      turnOutputTokens: 0,
      seenUnknownRecordTypes: new Set(),
      mode: mode && mode !== 'default' ? mode : undefined,
      effort: effort && effort !== 'none' ? effort : undefined,
      isCeo: isCeo || undefined,
    };

    this.agents.set(agentId, agent);

    console.log(
      `[Pixel Agents] Launching agent ${agentId} with session ${sessionId} (headless=${headless})`,
    );

    if (headless) {
      // Headless mode: no subprocess yet — spawned on first sendHeadlessMessage via --print
      agent.headless = true;
      if (headlessModel) agent.headlessModel = headlessModel;
    } else {
      // Terminal mode: open a new macOS Terminal tab via AppleScript
      const claudeFlags = bypassPermissions
        ? '--dangerously-skip-permissions --permission-mode acceptEdits'
        : '--permission-mode acceptEdits';
      // Export PATH so the shell can find the claude binary even if ~/.local/bin isn't in the default PATH
      const cmd =
        `export PATH="${LOCAL_BIN}:$PATH" && cd ${JSON.stringify(folderPath)} && ${CLAUDE_BIN} --session-id ${sessionId} ${claudeFlags} ${ADD_DIR_SHELL}`.trim();

      const appleScript = [
        'tell application "Terminal"',
        `  set t to (do script ${appleScriptStr(cmd)})`,
        `  set custom title of t to "pixel-agent-${agentId}"`,
        '  delay 0.5',
        '  return tty of t',
        'end tell',
      ].join('\n');

      const tmpFile = path.join(os.tmpdir(), `pixel-agent-launch-${agentId}.scpt`);
      fs.writeFileSync(tmpFile, appleScript);

      child_process.exec(`osascript "${tmpFile}"`, (err, stdout) => {
        fs.unlink(tmpFile, () => {});
        if (err) {
          console.error(`[Pixel Agents] Failed to launch Terminal:`, err);
          return;
        }
        const ttyPath = stdout.trim();
        const a = this.agents.get(agentId);
        if (a && ttyPath) {
          a.ttyPath = ttyPath;
          console.log(`[Pixel Agents] Agent ${agentId} TTY: ${ttyPath}`);
          // Drain any messages queued before the TTY was ready
          if (a.pendingMessages?.length) {
            setTimeout(() => {
              const queued = a.pendingMessages ?? [];
              a.pendingMessages = [];
              // First queued message gets extra delay so Claude Code finishes init
              queued.forEach((m, i) =>
                setTimeout(
                  () => appleScriptTypeInTerminal(ttyPath, m, true, i === 0 ? 3.0 : 0.3),
                  i * 500,
                ),
              );
            }, 800);
          }
          if (!bypassPermissions) {
            // Auto-approve workspace trust prompt (presses Enter ~12s after boot).
            // If already trusted the Enter is harmless; if prompt shows it confirms it.
            setTimeout(() => {
              const b = this.agents.get(agentId);
              if (b?.ttyPath) appleScriptTypeInTerminal(b.ttyPath, '', true);
            }, 12000);
          }
        }
      });
    }

    this.broadcast({ type: 'agentCreated', id: agentId, folderName, isCeo: isCeo || undefined });

    // Poll for the JSONL file to appear
    // Headless agents defer JSONL discovery until first message is sent
    if (!agent.headless) {
      this.waitForJsonlFile(agentId, projectDir, sessionId);
    }

    return agentId;
  }

  /** Register a character for an external Claude session adopted via hook events
   *  (e.g. the vault CEO session or a manually launched fleet session). Purely
   *  observational: no terminal, no subprocess, never persisted, never messaged.
   *  Removed on SessionEnd or by the staleness sweep. */
  registerExternalAgent(sessionId: string, folderPath: string, name: string): number {
    const agentId = this.nextAgentId++;
    const folderName = path.basename(folderPath);
    const projectDir = getProjectDirPath(folderPath);

    const agent: StandaloneAgent = {
      id: agentId,
      sessionId,
      projectDir,
      jsonlFile: '',
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      hookDelivered: true,
      folderPath,
      folderName,
      lastDataAt: 0,
      linesProcessed: 0,
      turnInputTokens: 0,
      turnOutputTokens: 0,
      seenUnknownRecordTypes: new Set(),
      observed: true,
      lastHookAt: Date.now(),
      customName: name,
    };
    this.agents.set(agentId, agent);
    this.broadcast({ type: 'agentCreated', id: agentId, folderName });
    this.broadcast({ type: 'agentMetaUpdated', id: agentId, name });

    // Attach the transcript for token counts + subagent visualization. Adopting
    // mid-session: seek to end of file so history isn't replayed as live events.
    const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
    try {
      if (fs.existsSync(expectedFile)) {
        agent.jsonlFile = expectedFile;
        agent.fileOffset = fs.statSync(expectedFile).size;
        this.startPolling(agentId);
      } else {
        this.waitForJsonlFile(agentId, projectDir, sessionId);
      }
    } catch {
      this.waitForJsonlFile(agentId, projectDir, sessionId);
    }
    return agentId;
  }

  /**
   * Send a message to a headless agent via `claude --print`.
   * Claude Code is spawned fresh for each message; session continuity is
   * maintained through the shared --session-id JSONL file.
   */
  sendHeadlessMessage(agentId: number, message: string): void {
    const agent = this.agents.get(agentId);
    if (!agent?.headless) return;

    // First message starts the session; subsequent messages resume it.
    // claude --print --session-id <id> rejects a sessionId that already exists,
    // so we must switch to --resume <id> for follow-up messages.
    const isFirstMessage = !agent.jsonlFile;

    // Prepend mode+effort instruction on the first message only
    let fullMessage = message;
    if (isFirstMessage) {
      const instruction = buildInstruction(agent.mode, agent.effort);
      if (instruction) fullMessage = instruction + '\n\n' + message;
    }

    // Record turn start for duration tracking
    agent.turnStartAt = Date.now();
    agent.turnInputTokens = 0;
    agent.turnOutputTokens = 0;
    agent.isWaiting = false;

    // Broadcast 'active' immediately — UI shows progress bar / thinking glow / "● active" pill.
    // Without this, the UI sits at idle until JSONL polling catches the first user record (~1-2s),
    // which under heavy parallel load (12 simultaneous --print spawns) can be longer than expected.
    this.broadcast({ type: 'agentStatus', id: agentId, status: 'active' });

    // Start JSONL discovery before spawning so polling is ready when the file appears
    if (isFirstMessage) {
      this.waitForJsonlFile(agentId, agent.projectDir, agent.sessionId);
    }

    const claudeArgs = isFirstMessage
      ? [
          '--session-id',
          agent.sessionId,
          '--dangerously-skip-permissions',
          '--permission-mode',
          'acceptEdits',
          ...ADD_DIR_ARGS,
          '--print',
        ]
      : [
          '--resume',
          agent.sessionId,
          '--dangerously-skip-permissions',
          '--permission-mode',
          'acceptEdits',
          ...ADD_DIR_ARGS,
          '--print',
        ];
    if (agent.headlessModel) claudeArgs.push('--model', agent.headlessModel);
    if (agent.systemPrompt) claudeArgs.push('--system-prompt', agent.systemPrompt);
    claudeArgs.push(fullMessage);

    console.log(
      `[Pixel Agents] Agent ${agentId} (headless): spawning ${CLAUDE_BIN} --print${agent.headlessModel ? ` --model ${agent.headlessModel}` : ''}`,
    );
    const child = child_process.spawn(CLAUDE_BIN, claudeArgs, {
      cwd: agent.folderPath,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, PATH: AUGMENTED_PATH },
    });

    agent.childProcess = child;

    child.on('close', (code) => {
      console.log(`[Pixel Agents] Agent ${agentId} --print exited (code ${code})`);
      // Safety net: if --print exits without the JSONL polling having caught the
      // turn-end (e.g. an early failure), surface that to the UI so it doesn't sit at active forever.
      const a = this.agents.get(agentId);
      if (a && !a.isWaiting) {
        const turnMs = a.turnStartAt ? Date.now() - a.turnStartAt : 0;
        // Only emit if it's been at least 500ms — otherwise let the JSONL pipeline drive the timing
        if (turnMs > 500) {
          a.isWaiting = true;
          this.broadcast({
            type: 'agentStatus',
            id: agentId,
            status: 'waiting',
            durationMs: turnMs,
            inputTokens: a.turnInputTokens || 0,
            outputTokens: a.turnOutputTokens || 0,
          });
        }
      }
    });
    child.on('error', (err) => {
      console.error(`[Pixel Agents] Agent ${agentId} spawn error:`, err);
    });
  }

  /** Wait for the JSONL file to appear, then start polling it. */
  private waitForJsonlFile(agentId: number, projectDir: string, sessionId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
    const startTime = Date.now();

    const discover = setInterval(() => {
      if (!this.agents.has(agentId)) {
        clearInterval(discover);
        return;
      }
      if (Date.now() - startTime > JSONL_DISCOVERY_TIMEOUT_MS) {
        console.warn(
          `[Pixel Agents] Agent ${agentId}: JSONL file not found after ${JSONL_DISCOVERY_TIMEOUT_MS}ms`,
        );
        clearInterval(discover);
        return;
      }
      if (fs.existsSync(expectedFile)) {
        clearInterval(discover);
        const a = this.agents.get(agentId);
        if (a) {
          a.jsonlFile = expectedFile;
          console.log(`[Pixel Agents] Agent ${agentId}: JSONL file found: ${expectedFile}`);
          this.startPolling(agentId);
          this.scheduleModInstruction(agentId);
        }
        return;
      }
      // Also scan projectDir for any new .jsonl file matching sessionId
      try {
        if (fs.existsSync(projectDir)) {
          const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
          const match = files.find((f) => f.startsWith(sessionId));
          if (match) {
            clearInterval(discover);
            const a = this.agents.get(agentId);
            if (a) {
              a.jsonlFile = path.join(projectDir, match);
              console.log(`[Pixel Agents] Agent ${agentId}: JSONL file found: ${a.jsonlFile}`);
              this.startPolling(agentId);
              this.scheduleModInstruction(agentId);
            }
          }
        }
      } catch {
        // ignore
      }
    }, JSONL_DISCOVERY_INTERVAL_MS);
  }

  /** Inject a mode instruction 3s after the JSONL file is found via TTY (terminal mode only).
   *  Headless mode prepends the instruction in sendHeadlessMessage instead. */
  private scheduleModInstruction(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.headless) return;
    const instruction = buildInstruction(agent.mode, agent.effort);
    if (!instruction) return;
    setTimeout(() => {
      const a = this.agents.get(agentId);
      if (!a?.ttyPath) return;
      appleScriptTypeInTerminal(a.ttyPath, instruction);
    }, 3000);
  }

  /** Start the 500ms polling loop for a specific agent. */
  private startPolling(agentId: number): void {
    const timer = setInterval(() => {
      if (!this.agents.has(agentId)) {
        clearInterval(timer);
        return;
      }
      readNewLines(agentId, this.agents, this.waitingTimers, this.permissionTimers, this.broadcast);
    }, JSONL_POLL_INTERVAL_MS);

    const agent = this.agents.get(agentId);
    if (agent) agent.pollTimer = timer;
  }

  /** Remove an agent and clean up all timers, subprocesses, and Terminal tabs.
   *  Pass fromHook=true when triggered by a SessionEnd hook (Terminal is already gone). */
  removeAgent(id: number, fromHook = false): void {
    const agent = this.agents.get(id);
    if (!agent) return;

    if (agent.childProcess) {
      try {
        agent.childProcess.kill();
      } catch {}
    }

    // For terminal-mode agents closed from the UI (not from a hook), kill the claude
    // process and close the Terminal tab so the tab doesn't linger.
    if (!fromHook && agent.ttyPath) {
      const { sessionId, ttyPath } = agent;
      child_process.exec(`pkill -f "${sessionId}"`, () => {
        // Brief delay so the process has exited before we ask Terminal to close the tab
        setTimeout(() => {
          const script = [
            'tell application "Terminal"',
            '  repeat with w in windows',
            '    repeat with t in tabs of w',
            `      if (tty of t) is equal to ${JSON.stringify(ttyPath)} then`,
            '        close t saving no',
            '        exit repeat',
            '      end if',
            '    end repeat',
            '  end repeat',
            'end tell',
          ].join('\n');
          const tmpFile = path.join(os.tmpdir(), `pixel-close-${id}.scpt`);
          fs.writeFileSync(tmpFile, script);
          child_process.exec(`osascript "${tmpFile}"`, () => {
            fs.unlink(tmpFile, () => {});
          });
        }, 400);
      });
    }

    if (agent.pollTimer) clearInterval(agent.pollTimer);
    if (agent.permissionTimer) clearTimeout(agent.permissionTimer);
    if (agent.waitingTimer) clearTimeout(agent.waitingTimer);

    const waitTimer = this.waitingTimers.get(id);
    if (waitTimer) {
      clearTimeout(waitTimer);
      this.waitingTimers.delete(id);
    }
    const permTimer = this.permissionTimers.get(id);
    if (permTimer) {
      clearTimeout(permTimer);
      this.permissionTimers.delete(id);
    }

    this.agents.delete(id);
    this.broadcast({ type: 'agentClosed', id });
    console.log(`[Pixel Agents] Agent ${id} removed`);
  }

  /** Restore persisted agents (re-start JSONL polling from saved offset). */
  restoreAgents(persisted: PersistedAppAgent[]): void {
    for (const p of persisted) {
      if (this.agents.has(p.id)) continue;
      if (!p.jsonlFile || !fs.existsSync(p.jsonlFile)) continue;

      const agent: StandaloneAgent = {
        id: p.id,
        sessionId: p.sessionId,
        projectDir: p.projectDir,
        jsonlFile: p.jsonlFile,
        fileOffset: 0,
        lineBuffer: '',
        activeToolIds: new Set(),
        activeToolStatuses: new Map(),
        activeToolNames: new Map(),
        activeSubagentToolIds: new Map(),
        activeSubagentToolNames: new Map(),
        backgroundAgentToolIds: new Set(),
        isWaiting: false,
        permissionSent: false,
        hadToolsInTurn: false,
        hookDelivered: false,
        folderPath: p.folderPath,
        folderName: p.folderName,
        lastDataAt: 0,
        linesProcessed: 0,
        turnInputTokens: 0,
        turnOutputTokens: 0,
        seenUnknownRecordTypes: new Set(),
        palette: p.palette,
        hueShift: p.hueShift,
        seatId: p.seatId,
        customName: p.customName,
        task: p.task,
        mode: p.mode,
        effort: p.effort,
        isCeo: p.isCeo,
        homeZoneId: p.homeZoneId,
        role: p.role,
        canSpawn: p.canSpawn,
        maxSpawn: p.maxSpawn,
      };

      // Seek to end of file — don't reprocess old events on restore
      try {
        const stats = fs.statSync(p.jsonlFile);
        agent.fileOffset = stats.size;
      } catch {
        // ignore
      }

      // Fix 1: auto-convert restored non-CEO terminal agents to headless so they
      // work immediately after a server restart without needing a live Terminal tab.
      if (!p.isCeo) {
        agent.headless = true;
        agent.headlessModel = p.effort === 'max' ? 'claude-opus-4-7' : 'claude-sonnet-4-6';
      }

      // Fix 5: restore system prompt if persisted
      if (p.systemPrompt) agent.systemPrompt = p.systemPrompt;
      if (p.promptVersion !== undefined) agent.promptVersion = p.promptVersion;
      if (p.lastTrained) agent.lastTrained = p.lastTrained;

      this.agents.set(p.id, agent);
      if (p.id >= this.nextAgentId) this.nextAgentId = p.id + 1;
      this.startPolling(p.id);
      console.log(
        `[Pixel Agents] Restored agent ${p.id} (${p.folderName})${!p.isCeo ? ' — converted to headless' : ''}`,
      );
    }
  }

  /** Serialize current agents for persistence. */
  serializeAgents(): PersistedAppAgent[] {
    const result: PersistedAppAgent[] = [];
    for (const agent of this.agents.values()) {
      // Observed external sessions are never persisted — a restart must not
      // resurrect them as spawnable headless agents.
      if (agent.observed) continue;
      if (agent.jsonlFile) {
        result.push({
          id: agent.id,
          sessionId: agent.sessionId,
          folderPath: agent.folderPath,
          folderName: agent.folderName,
          jsonlFile: agent.jsonlFile,
          projectDir: agent.projectDir,
          palette: agent.palette,
          hueShift: agent.hueShift,
          seatId: agent.seatId,
          customName: agent.customName,
          task: agent.task,
          mode: agent.mode,
          effort: agent.effort,
          isCeo: agent.isCeo,
          homeZoneId: agent.homeZoneId,
          role: agent.role,
          canSpawn: agent.canSpawn,
          maxSpawn: agent.maxSpawn,
          systemPrompt: agent.systemPrompt,
          promptVersion: agent.promptVersion,
          lastTrained: agent.lastTrained,
        });
      }
    }
    return result;
  }

  dispose(): void {
    for (const id of [...this.agents.keys()]) {
      this.removeAgent(id);
    }
  }
}

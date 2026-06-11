/**
 * Pixel Agents — Standalone App Backend
 *
 * HTTP server (port 4000): serves static SPA + WebSocket
 * Hook HTTP server (port 4001): receives Claude Code hook events
 */
import * as child_process from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

import {
  flushAgentHistory,
  getAgentHistorySnapshot,
  loadAgentHistory,
  recordTurnComplete,
} from './agentHistoryStore.js';
import { AgentManager, appleScriptTypeInTerminal, buildInstruction } from './agentManager.js';
import { loadAssets } from './assetLoader.js';
import { readAppConfig, writeAppConfig } from './configManager.js';
import type { FleetWatcher } from './fleetWatcher.js';
import { startFleetWatcher } from './fleetWatcher.js';
import { loadOrInitLayout, writeLayout } from './layoutManager.js';
import { formatToolStatus } from './transcriptProcessor.js';
import type { AgentEffort, AgentMode } from './types.js';
import type { AppConfig } from './types.js';

// ── Path resolution ─────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// app/src/index.ts → project root is two levels up
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ASSETS_DIR = path.join(PROJECT_ROOT, 'webview-ui', 'public', 'assets');
const WEBVIEW_DIST = path.join(__dirname, '..', 'dist', 'webview');
const APP_PORT = parseInt(process.env.PORT ?? '4000', 10);
const HOOK_PORT = parseInt(process.env.HOOK_PORT ?? '4001', 10);
// Shared secret for both the :4001 hook sink and the :4000 control-bus token path.
// Written to ~/.pixel-agents/server.json (0600) so local Node tools can authenticate.
const AUTH_TOKEN = crypto.randomUUID();
/** Root of a claude-brain style vault (fleet/ + projects/) to observe. Optional. */
const VAULT_ROOT = process.env.PIXEL_AGENTS_VAULT_ROOT ?? '';

const EXTENSION_VERSION = '1.0.0';

const PREMADE_ROOMS_PATH = path.join(ASSETS_DIR, 'premade-rooms.json');
const PIXEL_INVENTORY_ROOT = path.join(os.homedir(), 'Downloads', 'pixel invertory');
const IMPORTED_SPRITES_PATH = path.join(os.homedir(), '.pixel-agents', 'imported-sprites.json');

// ── Imported sprite tracking ─────────────────────────────────────────────────
function readImportedSprites(): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(IMPORTED_SPRITES_PATH, 'utf-8')) as string[];
    return new Set(data);
  } catch {
    return new Set();
  }
}

function writeImportedSprites(set: Set<string>): void {
  const dir = path.dirname(IMPORTED_SPRITES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(IMPORTED_SPRITES_PATH, JSON.stringify([...set], null, 2));
}

// ── PNG tile slicer ──────────────────────────────────────────────────────────
interface SlicedTile {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
}

function slicePng(pngPath: string, tileW: number, tileH: number, prefix: string): SlicedTile[] {
  const buf = fs.readFileSync(pngPath);
  const src = PNG.sync.read(buf);
  const cols = Math.floor(src.width / tileW);
  const rows = Math.floor(src.height / tileH);
  const tiles: SlicedTile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = new PNG({ width: tileW, height: tileH });
      tile.data = Buffer.alloc(tileW * tileH * 4);
      for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x++) {
          const si = ((r * tileH + y) * src.width + (c * tileW + x)) * 4;
          const di = (y * tileW + x) * 4;
          src.data.copy(tile.data, di, si, si + 4);
        }
      }
      // Skip fully-transparent tiles
      let hasPixel = false;
      for (let i = 3; i < tile.data.length; i += 4) {
        if (tile.data[i] > 2) {
          hasPixel = true;
          break;
        }
      }
      if (!hasPixel) continue;
      const pngBuf = PNG.sync.write(tile);
      tiles.push({
        id: `${prefix}_r${r}_c${c}`,
        dataUrl: `data:image/png;base64,${pngBuf.toString('base64')}`,
        width: tileW,
        height: tileH,
      });
    }
  }
  return tiles;
}

// ── Inventory scanner ────────────────────────────────────────────────────────
interface InventorySprite {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  alreadyImported: boolean;
}

function scanInventory(importedIds: Set<string>): InventorySprite[] {
  const sprites: InventorySprite[] = [];

  // 1. Individual sprites from office_assets/separately_assets/
  const sepDir = path.join(PIXEL_INVENTORY_ROOT, 'office_assets', 'separately_assets');
  if (fs.existsSync(sepDir)) {
    const files = fs
      .readdirSync(sepDir)
      .filter((f) => /^Sprite-\d+\.png$/i.test(f))
      .sort();
    for (const f of files) {
      const fullPath = path.join(sepDir, f);
      const buf = fs.readFileSync(fullPath);
      const png = PNG.sync.read(buf);
      const id = f.replace(/\.png$/i, '');
      sprites.push({
        id,
        dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
        width: png.width,
        height: png.height,
        alreadyImported: importedIds.has(id),
      });
    }
  }

  // 2. Sliced tiles from office_assets/tiles.png (80×96, 5×6 grid of 16×16)
  const tilesPath = path.join(PIXEL_INVENTORY_ROOT, 'office_assets', 'tiles.png');
  if (fs.existsSync(tilesPath)) {
    const sliced = slicePng(tilesPath, 16, 16, 'tiles');
    for (const t of sliced) {
      sprites.push({ ...t, alreadyImported: importedIds.has(t.id) });
    }
  }

  return sprites;
}

// ── Grayscale conversion ─────────────────────────────────────────────────────
function toGrayscalePng(base64Data: string): Buffer {
  const buf = Buffer.from(base64Data, 'base64');
  const png = PNG.sync.read(buf);
  for (let i = 0; i < png.data.length; i += 4) {
    const luma = Math.round(
      0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2],
    );
    png.data[i] = luma;
    png.data[i + 1] = luma;
    png.data[i + 2] = luma;
  }
  return PNG.sync.write(png);
}

// ── Slug helper ──────────────────────────────────────────────────────────────
function slugify(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── Body reader ──────────────────────────────────────────────────────────────
function readBody(req: http.IncomingMessage, maxBytes = 524288): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── State ───────────────────────────────────────────────────────────────────
let config: AppConfig = readAppConfig();
const clients = new Set<WebSocket>();

function broadcast(msg: object): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(data);
    }
  }
}

const agentManager = new AgentManager(broadcast);

let fleetWatcher: FleetWatcher | null = null;
if (VAULT_ROOT) {
  if (fs.existsSync(VAULT_ROOT)) {
    fleetWatcher = startFleetWatcher(VAULT_ROOT, broadcast);
  } else {
    console.error(`[Pixel Agents] PIXEL_AGENTS_VAULT_ROOT does not exist: ${VAULT_ROOT}`);
  }
}

// Observed external sessions that stop sending hook events (crash, force-quit)
// never get a SessionEnd — sweep them out after 30 minutes of silence.
const OBSERVED_STALE_MS = 30 * 60_000;
setInterval(() => {
  for (const [id, a] of agentManager.getAgents()) {
    if (a.observed && a.lastHookAt && Date.now() - a.lastHookAt > OBSERVED_STALE_MS) {
      console.log(
        `[Pixel Agents] Removing stale observed agent ${id} (${a.customName ?? a.folderName})`,
      );
      agentManager.removeAgent(id, true);
    }
  }
}, 5 * 60_000);

// ── Static file server helper ───────────────────────────────────────────────
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const urlPath = req.url?.split('?')[0] ?? '/';
  let filePath = path.join(WEBVIEW_DIST, urlPath === '/' ? 'index.html' : urlPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(WEBVIEW_DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(WEBVIEW_DIST, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ── Hook HTTP server (port 4001) ────────────────────────────────────────────
function startHookServer(): void {
  const token = AUTH_TOKEN;

  const hookServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', pid: process.pid }));
      return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/api/hooks/')) {
      // Auth check
      const authHeader = req.headers['authorization'] ?? '';
      const expectedToken = `Bearer ${token}`;
      const authBuf = Buffer.from(authHeader);
      const expectedBuf = Buffer.from(expectedToken);
      if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
        res.writeHead(401);
        res.end('unauthorized');
        return;
      }

      let body = '';
      let bodySize = 0;
      req.on('data', (chunk: Buffer) => {
        bodySize += chunk.length;
        if (bodySize > 65536) {
          res.writeHead(413);
          res.end();
          req.destroy();
          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const event = JSON.parse(body) as Record<string, unknown>;
          if (event.session_id && event.hook_event_name) {
            handleHookEvent(event);
          }
          res.writeHead(200);
          res.end('ok');
        } catch {
          res.writeHead(400);
          res.end('invalid json');
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  hookServer.listen(HOOK_PORT, '127.0.0.1', () => {
    console.log(`[Pixel Agents] Hook server listening on 127.0.0.1:${HOOK_PORT}`);
    // Write server.json so claude-hook.js can find us
    writeServerJson(HOOK_PORT, token);
  });
}

/** A WebSocket control-bus client is authorized if it either comes from a
 *  localhost browser Origin (which remote pages cannot forge — this blocks
 *  cross-site WebSocket hijacking) or presents the shared Bearer token (the
 *  path Node CLI tools use, since they send no Origin). */
function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function isAuthorizedWsClient(req: http.IncomingMessage): boolean {
  if (isLocalOrigin(req.headers.origin)) return true;
  const auth = req.headers['authorization'] ?? '';
  const expected = `Bearer ${AUTH_TOKEN}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function writeServerJson(port: number, token: string): void {
  const dir = path.join(os.homedir(), '.pixel-agents');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const data = JSON.stringify({ port, pid: process.pid, token, startedAt: Date.now() }, null, 2);
    const tmpPath = path.join(dir, 'server.json.tmp');
    fs.writeFileSync(tmpPath, data, { mode: 0o600 });
    fs.renameSync(tmpPath, path.join(dir, 'server.json'));
  } catch (err) {
    console.error('[Pixel Agents] Failed to write server.json:', err);
  }
}

function handleHookEvent(event: Record<string, unknown>): void {
  const sessionId = event.session_id as string;
  const eventName = event.hook_event_name as string;
  console.log(`[Pixel Agents] Hook: ${eventName} session=${sessionId?.slice(0, 8)}...`);

  // Find agent by session ID
  let agentId: number | undefined;
  for (const [id, agent] of agentManager.getAgents()) {
    if (agent.sessionId === sessionId) {
      agentId = id;
      break;
    }
  }

  // Unknown session: adopt it as an observed character when it runs inside the
  // watched vault (e.g. the CEO main session or a manually launched fleet agent).
  if (agentId === undefined) {
    const cwd = typeof event.cwd === 'string' ? event.cwd : '';
    const inVault =
      VAULT_ROOT && cwd && (cwd === VAULT_ROOT || cwd.startsWith(VAULT_ROOT + path.sep));
    if (!inVault || eventName === 'SessionEnd') return;
    const name =
      cwd === VAULT_ROOT
        ? `CEO·${sessionId.slice(0, 4)}`
        : `${path.basename(cwd)}·${sessionId.slice(0, 4)}`;
    agentId = agentManager.registerExternalAgent(sessionId, cwd, name);
    const adopted = agentManager.getAgents().get(agentId);
    if (adopted && cwd === VAULT_ROOT) adopted.role = 'ceo';
    console.log(
      `[Pixel Agents] Adopted external vault session ${sessionId.slice(0, 8)}… as agent ${agentId} (${name})`,
    );
  }

  const agent = agentManager.getAgents().get(agentId);
  if (!agent) return;

  agent.hookDelivered = true;
  if (agent.observed) agent.lastHookAt = Date.now();

  switch (eventName) {
    case 'Stop':
    case 'Notification':
      if (eventName === 'Notification' && event.notification_type !== 'idle_prompt') {
        if (event.notification_type === 'permission_prompt') {
          agent.permissionSent = true;
          broadcast({ type: 'agentToolPermission', id: agentId });
        }
        break;
      }
      agent.activeToolIds.clear();
      agent.activeToolStatuses.clear();
      agent.activeToolNames.clear();
      agent.activeSubagentToolIds.clear();
      agent.activeSubagentToolNames.clear();
      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      broadcast({ type: 'agentToolsClear', id: agentId });
      {
        const durationMs = agent.turnStartAt ? Date.now() - agent.turnStartAt : undefined;
        broadcast({
          type: 'agentStatus',
          id: agentId,
          status: 'waiting',
          durationMs,
          inputTokens: agent.turnInputTokens || undefined,
          outputTokens: agent.turnOutputTokens || undefined,
        });
        recordTurnComplete(agentId, durationMs, agent.turnInputTokens, agent.turnOutputTokens);
        agent.turnInputTokens = 0;
        agent.turnOutputTokens = 0;
        agent.turnStartAt = undefined;
      }
      break;
    case 'PreToolUse': {
      const toolName = (event.tool_name as string) ?? '';
      const toolInput = (event.tool_input as Record<string, unknown>) ?? {};
      const status = formatToolStatus(toolName, toolInput);
      const hookToolId = `hook-${Date.now()}`;
      agent.currentHookToolId = hookToolId;
      agent.isWaiting = false;
      agent.permissionSent = false;
      agent.hadToolsInTurn = true;
      if (toolName !== 'Task' && toolName !== 'Agent') {
        broadcast({ type: 'agentToolStart', id: agentId, toolId: hookToolId, status, toolName });
      }
      broadcast({ type: 'agentStatus', id: agentId, status: 'active' });
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (agent.currentHookToolId) {
        broadcast({ type: 'agentToolDone', id: agentId, toolId: agent.currentHookToolId });
        agent.currentHookToolId = undefined;
      }
      break;
    case 'PermissionRequest':
      agent.permissionSent = true;
      broadcast({ type: 'agentToolPermission', id: agentId });
      break;
    case 'SessionEnd': {
      const reason = event.reason as string | undefined;
      if (reason === 'clear' || reason === 'resume') {
        agent.pendingClear = true;
        broadcast({ type: 'agentStatus', id: agentId, status: 'waiting' });
      } else if (agent.headless) {
        // Headless agents persist after completion so the user can review their work.
        // Just mark them idle — the user closes them manually from the UI.
        agent.isWaiting = true;
        agent.activeToolIds.clear();
        agent.activeToolStatuses.clear();
        agent.activeToolNames.clear();
        broadcast({ type: 'agentToolsClear', id: agentId });
        const durationMs = agent.turnStartAt ? Date.now() - agent.turnStartAt : undefined;
        broadcast({
          type: 'agentStatus',
          id: agentId,
          status: 'waiting',
          durationMs,
          inputTokens: agent.turnInputTokens || undefined,
          outputTokens: agent.turnOutputTokens || undefined,
        });
        recordTurnComplete(agentId, durationMs, agent.turnInputTokens, agent.turnOutputTokens);
        agent.turnInputTokens = 0;
        agent.turnOutputTokens = 0;
        agent.turnStartAt = undefined;
      } else if (agent.isCeo) {
        // CEO agents can never be terminated from the terminal — write session to CLAUDE.md then relaunch.
        (async () => {
          const {
            folderPath,
            palette,
            hueShift,
            customName,
            seatId,
            task,
            mode,
            effort,
            homeZoneId,
          } = agent;
          await agentManager.writeCeoSessionToClaudeMd(agent);
          agentManager.removeAgent(agentId, true);
          const newId = await agentManager.launchAgent(
            folderPath,
            true,
            mode,
            false,
            undefined,
            effort,
            true,
          );
          const newAgent = agentManager.getAgents().get(newId);
          if (newAgent) {
            if (palette !== undefined) newAgent.palette = palette;
            if (hueShift !== undefined) newAgent.hueShift = hueShift;
            if (customName) newAgent.customName = customName;
            if (seatId !== undefined) newAgent.seatId = seatId;
            if (task) newAgent.task = task;
            if (homeZoneId) newAgent.homeZoneId = homeZoneId;
          }
          saveConfig();
          console.log(`[Pixel Agents] CEO agent relaunched as ${newId}`);
        })();
      } else {
        // Terminal agents: their tab is closing, remove from UI.
        agentManager.removeAgent(agentId, true);
      }
      break;
    }
  }
}

// ── WebSocket message handling ──────────────────────────────────────────────
async function handleClientMessage(
  ws: WebSocket,
  rawMsg: string,
  assets: Awaited<ReturnType<typeof loadAssets>>,
  layout: { layout: Record<string, unknown>; wasReset: boolean },
): Promise<void> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(rawMsg) as Record<string, unknown>;
  } catch {
    return;
  }

  const send = (data: object) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  };

  switch (msg.type) {
    case 'webviewReady': {
      // Send settings
      send({
        type: 'settingsLoaded',
        soundEnabled: config.soundEnabled,
        hooksEnabled: config.hooksEnabled,
        watchAllSessions: config.watchAllSessions,
        alwaysShowLabels: config.alwaysShowLabels,
        lastSeenVersion: config.lastSeenVersion,
        extensionVersion: EXTENSION_VERSION,
        hooksInfoShown: config.hooksInfoShown,
        externalAssetDirectories: [],
      });

      // Send workspace folders
      const folders = config.folders.map((f) => ({ name: path.basename(f), path: f }));
      send({ type: 'workspaceFolders', folders });

      // Send assets in load order
      if (assets.characters.length > 0) {
        send({ type: 'characterSpritesLoaded', characters: assets.characters });
      }
      if (assets.floors.length > 0) {
        send({ type: 'floorTilesLoaded', sprites: assets.floors });
      }
      if (assets.walls.length > 0) {
        send({ type: 'wallTilesLoaded', sets: assets.walls });
      }
      if (assets.furnitureCatalog.length > 0) {
        send({
          type: 'furnitureAssetsLoaded',
          catalog: assets.furnitureCatalog,
          sprites: assets.furnitureSprites,
        });
      }

      // Send layout
      send({ type: 'layoutLoaded', layout: layout.layout, wasReset: layout.wasReset });

      // Send fleet state (vault integration), if a vault is being watched
      if (fleetWatcher) {
        send({ type: 'fleetState', state: fleetWatcher.getState() });
      }

      // Send existing agents
      const agentIds: number[] = [];
      const agentMeta: Record<number, object> = {};
      const folderNames: Record<number, string> = {};
      const folderPaths: Record<number, string> = {};
      const agentNames: Record<number, string> = {};
      const agentTasks: Record<number, string> = {};
      const agentModes: Record<number, AgentMode> = {};
      const agentEfforts: Record<number, string> = {};
      const agentHomeZones: Record<number, string> = {};
      const agentCeoFlags: Record<number, boolean> = {};
      const agentRoles: Record<number, string> = {};
      const agentCanSpawn: Record<number, boolean> = {};
      const agentMaxSpawn: Record<number, number> = {};
      const agentStatuses: Record<number, 'active' | 'waiting'> = {};
      for (const [id, agent] of agentManager.getAgents()) {
        agentIds.push(id);
        agentMeta[id] = {
          palette: agent.palette,
          hueShift: agent.hueShift,
          seatId: agent.seatId,
          isWaiting: agent.isWaiting,
          skipSpawnEffect: true,
        };
        folderNames[id] = agent.folderName;
        folderPaths[id] = agent.folderPath;
        if (agent.customName) agentNames[id] = agent.customName;
        if (agent.task) agentTasks[id] = agent.task;
        if (agent.mode) agentModes[id] = agent.mode;
        if (agent.effort) agentEfforts[id] = agent.effort;
        if (agent.homeZoneId) agentHomeZones[id] = agent.homeZoneId;
        if (agent.isCeo) agentCeoFlags[id] = true;
        if (agent.role) agentRoles[id] = agent.role;
        if (agent.canSpawn) {
          agentCanSpawn[id] = true;
          agentMaxSpawn[id] = agent.maxSpawn ?? 3;
        }
        // Restore current activity state on page reload — derived from in-memory agent state
        const isCurrentlyActive =
          !agent.isWaiting && (agent.turnStartAt !== undefined || agent.activeToolIds.size > 0);
        agentStatuses[id] = isCurrentlyActive ? 'active' : 'waiting';
      }
      send({
        type: 'existingAgents',
        agents: agentIds,
        agentMeta,
        folderNames,
        folderPaths,
        agentNames,
        agentTasks,
        agentModes,
        agentEfforts,
        agentHomeZones,
        agentCeoFlags,
        agentRoles,
        agentCanSpawn,
        agentMaxSpawn,
        agentStatuses,
        agentHistoryTotals: getAgentHistorySnapshot(),
      });
      break;
    }

    case 'openClaude': {
      const folderPath = (msg.folderPath as string) || config.folders[0] || os.homedir();
      const bypassPermissions = (msg.bypassPermissions as boolean) || false;
      const openMode = (msg.mode as AgentMode) || undefined;
      const headlessMode = (msg.headless as boolean) || false;
      const headlessModel = (msg.model as string) || undefined;
      const openEffort = (msg.effort as AgentEffort) || undefined;
      const isCeo = (msg.isCeo as boolean) || false;
      if (isCeo && agentManager.hasCeoAgent()) {
        const existingCeo = agentManager.getCeoAgent();
        if (existingCeo && !existingCeo.ttyPath) {
          // Ghost CEO (restored from roster but no live terminal) — remove and allow relaunch
          agentManager.removeAgent(existingCeo.id, true);
        } else {
          send({
            type: 'error',
            message: 'A CEO agent already exists. Only one CEO agent is allowed at a time.',
          });
          break;
        }
      }
      try {
        const newId = await agentManager.launchAgent(
          folderPath,
          bypassPermissions,
          openMode,
          headlessMode,
          headlessModel,
          openEffort,
          isCeo,
        );
        if (isCeo) {
          const a = agentManager.getAgents().get(newId);
          if (a) a.role = 'ceo';
        }
        saveConfig();
      } catch (err) {
        console.error('[Pixel Agents] Failed to launch agent:', err);
      }
      break;
    }

    case 'spawnFromBrief': {
      // Spawn a fleet agent from a pending inbox brief in the watched vault.
      // Dispatch contract per the vault's CLAUDE.md: "Execute the brief at <path>."
      if (!VAULT_ROOT || !fleetWatcher) {
        send({ type: 'error', message: 'No vault configured — set PIXEL_AGENTS_VAULT_ROOT.' });
        break;
      }
      const briefAgent = (msg.agent as string) ?? '';
      const briefFile = (msg.brief as string) ?? '';
      // Both names come from the fleet tree; reject anything path-like
      if (
        !/^[\w-]+$/.test(briefAgent) ||
        !/^[\w.-]+\.md$/.test(briefFile) ||
        briefFile.includes('..')
      ) {
        send({ type: 'error', message: 'Invalid agent or brief name.' });
        break;
      }
      const briefPath = path.join(VAULT_ROOT, 'fleet', briefAgent, 'inbox', briefFile);
      if (!fs.existsSync(briefPath)) {
        send({ type: 'error', message: `Brief not found: fleet/${briefAgent}/inbox/${briefFile}` });
        break;
      }
      try {
        // Headless, cwd = vault root, so the agent wakes inside the vault per its wake rule
        const newId = await agentManager.launchAgent(
          VAULT_ROOT,
          true,
          undefined,
          true,
          undefined,
          undefined,
          false,
        );
        const spawned = agentManager.getAgents().get(newId);
        if (spawned) {
          spawned.customName = briefAgent;
          spawned.role = 'worker';
          spawned.task = `Execute fleet/${briefAgent}/inbox/${briefFile}`;
          broadcast({ type: 'agentMetaUpdated', id: newId, name: briefAgent });
          broadcast({ type: 'agentMetaUpdated', id: newId, role: 'worker' });
          broadcast({ type: 'agentMetaUpdated', id: newId, task: spawned.task });
        }
        saveConfig();
        agentManager.sendHeadlessMessage(
          newId,
          `Execute the brief at ${briefPath} as the ${briefAgent} fleet agent: adopt .claude/agents/${briefAgent}.md as your identity. Rules 7 and 9 apply — never run git commit; write only fleet/${briefAgent}/** plus the areas the brief assigns (and your own wiki/agents page per rule 9).`,
        );
      } catch (err) {
        console.error('[Pixel Agents] Failed to spawn from brief:', err);
        send({ type: 'error', message: 'Failed to spawn agent from brief.' });
      }
      break;
    }

    case 'approvePermission': {
      const approveAgent = agentManager.getAgents().get(msg.id as number);
      if (approveAgent?.headless) {
        // --dangerously-skip-permissions is always set for headless; nothing to approve
      } else if (approveAgent?.ttyPath) {
        appleScriptTypeInTerminal(approveAgent.ttyPath, '', true);
      }
      break;
    }

    case 'browseFolder': {
      child_process.exec(
        `osascript -e 'POSIX path of (choose folder with prompt "Select working folder")'`,
        (err, stdout) => {
          if (!err && stdout.trim()) {
            send({ type: 'folderSelected', agentId: msg.agentId, path: stdout.trim() });
          }
        },
      );
      break;
    }

    case 'browseFile': {
      const agentId = msg.agentId as number;
      const imageOnly = msg.imageOnly as boolean | undefined;
      const typeFilter = imageOnly ? `of type {"public.image"}` : '';
      const prompt = imageOnly ? 'Select an image to attach' : 'Select a file to attach';
      child_process.exec(
        `osascript -e 'POSIX path of (choose file with prompt "${prompt}" ${typeFilter})'`,
        (err, stdout) => {
          if (!err && stdout.trim()) {
            send({
              type: 'fileSelectedForAttach',
              agentId,
              path: stdout.trim().replace(/\n$/, ''),
            });
          }
        },
      );
      break;
    }

    case 'closeAgent': {
      const id = msg.id as number;
      agentManager.removeAgent(id);
      saveConfig();
      break;
    }

    case 'ceoCatchUp': {
      const ceoAgent = agentManager.getCeoAgent();
      if (!ceoAgent) break;
      const catchUpMsg =
        'Read your CLAUDE.md file in your working folder and catch up on all information from previous sessions. Summarize what you know and what has been done, then await further instructions.';
      if (ceoAgent.headless) {
        agentManager.sendHeadlessMessage(ceoAgent.id, catchUpMsg);
      } else if (ceoAgent.ttyPath) {
        appleScriptTypeInTerminal(ceoAgent.ttyPath, catchUpMsg);
      } else {
        // Ghost CEO — no live terminal. Relaunch it, then send catch up once TTY is ready.
        const {
          folderPath,
          palette,
          hueShift,
          customName,
          seatId,
          task,
          mode,
          effort,
          homeZoneId,
        } = ceoAgent;
        agentManager.removeAgent(ceoAgent.id, true);
        const newId = await agentManager.launchAgent(
          folderPath || config.folders[0] || os.homedir(),
          true,
          mode,
          false,
          undefined,
          effort,
          true,
        );
        const newAgent = agentManager.getAgents().get(newId);
        if (newAgent) {
          if (palette !== undefined) newAgent.palette = palette;
          if (hueShift !== undefined) newAgent.hueShift = hueShift;
          if (customName) newAgent.customName = customName;
          if (seatId !== undefined) newAgent.seatId = seatId;
          if (task) newAgent.task = task;
          if (homeZoneId) newAgent.homeZoneId = homeZoneId;
        }
        saveConfig();
        // Wait for terminal to initialize, then send the catch up message
        setTimeout(() => {
          const refreshed = agentManager.getCeoAgent();
          if (refreshed?.ttyPath) appleScriptTypeInTerminal(refreshed.ttyPath, catchUpMsg);
        }, 8000);
      }
      break;
    }

    case 'spawnTeam': {
      const project = (msg as { project?: string }).project || 'default';
      const claudeAgentsPath = path.join(os.homedir(), 'Claude-Agents');
      const spawnTeamScript = path.join(claudeAgentsPath, 'spawn-team.mjs');

      if (!fs.existsSync(spawnTeamScript)) {
        ws.send(JSON.stringify({ type: 'spawnTeamError', error: `not found: ${spawnTeamScript}` }));
        break;
      }

      const args: string[] = [spawnTeamScript];
      if (project !== 'default') args.push(`--project=${project}`);

      const subprocess = child_process.spawn(process.execPath, args, {
        cwd: claudeAgentsPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      ws.send(JSON.stringify({ type: 'spawnTeamStarted', project }));

      let lastLine = '';
      const captureLine = (chunk: Buffer) => {
        const lines = chunk
          .toString()
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length > 0) lastLine = lines[lines.length - 1];
      };
      subprocess.stdout?.on('data', captureLine);
      subprocess.stderr?.on('data', captureLine);

      subprocess.on('exit', (code) => {
        if (code === 0) {
          ws.send(JSON.stringify({ type: 'spawnTeamComplete', project, lastLine }));
        } else {
          ws.send(JSON.stringify({ type: 'spawnTeamError', code, lastLine }));
        }
      });

      break;
    }

    case 'closeAllAgents': {
      const ids = [...agentManager.getAgents().entries()]
        .filter(([, a]) => !a.isCeo)
        .map(([id]) => id);
      for (const id of ids) agentManager.removeAgent(id);
      saveConfig();
      break;
    }

    case 'sendAgentMessage': {
      const id = msg.id as number;
      const message = ((msg.message as string) ?? '').trim();
      const agent = agentManager.getAgents().get(id);
      if (!agent || !message) break;
      // Echo to all clients so the chat history is visible regardless of who sent it
      broadcast({ type: 'agentUserMessage', id, message });
      // Fast-fail if this is a ghost terminal agent (no live tab, not headless)
      if (!agent.headless && !agent.ttyPath && !agent.isCeo) {
        send({
          type: 'agentNotReady',
          id,
          reason:
            'Ghost terminal agent — no live terminal tab. Restart server (auto-converts to headless).',
        });
        break;
      }
      if (agent.headless) {
        agentManager.sendHeadlessMessage(id, message);
      } else if (agent.ttyPath) {
        // First message needs extra delay so Claude Code finishes its init prompt
        const isFirstMsg = !agent.linesProcessed && !agent.turnStartAt;
        appleScriptTypeInTerminal(agent.ttyPath, message, true, isFirstMsg ? 3.0 : 0.3);
      } else if (!agent.isCeo) {
        // Terminal agent whose TTY isn't ready yet — queue until it is
        if (!agent.pendingMessages) agent.pendingMessages = [];
        agent.pendingMessages.push(message);
        console.log(
          `[Pixel Agents] Agent ${id}: TTY not ready, queued message (${agent.pendingMessages.length} pending)`,
        );
      } else if (agent.isCeo) {
        // CEO has no terminal yet (e.g. after server restart) — relaunch first
        (async () => {
          const {
            folderPath,
            palette,
            hueShift,
            customName,
            seatId,
            task,
            mode,
            effort,
            homeZoneId,
          } = agent;
          agentManager.removeAgent(id, true);
          const newId = await agentManager.launchAgent(
            folderPath,
            true,
            mode,
            false,
            undefined,
            effort,
            true,
          );
          const newAgent = agentManager.getAgents().get(newId);
          if (newAgent) {
            if (palette !== undefined) newAgent.palette = palette;
            if (hueShift !== undefined) newAgent.hueShift = hueShift;
            if (customName) newAgent.customName = customName;
            if (seatId !== undefined) newAgent.seatId = seatId;
            if (task) newAgent.task = task;
            if (homeZoneId) newAgent.homeZoneId = homeZoneId;
          }
          saveConfig();
        })();
      }
      break;
    }

    case 'startMeeting': {
      const topic = ((msg.topic as string) ?? 'team discussion').trim();
      const allAgents = [...agentManager.getAgents().values()].filter((a) => a.ttyPath);
      const roster = allAgents.map((a) => a.customName || `Agent ${a.id}`).join(', ');
      for (const agent of allAgents) {
        const others = allAgents
          .filter((a) => a.id !== agent.id)
          .map((a) => a.customName || `Agent ${a.id}`)
          .join(', ');
        const prompt =
          `[TEAM MEETING] Topic: "${topic}". ` +
          (others ? `Other participants: ${others}. ` : '') +
          `Full team: ${roster}. ` +
          `Please share your current work status and thoughts on this topic. ` +
          `Keep your response to 2-3 concise paragraphs, then wait for others.`;
        appleScriptTypeInTerminal(agent.ttyPath!, prompt);
      }
      broadcast({ type: 'meetingStarted', topic });
      break;
    }

    case 'endMeeting': {
      broadcast({ type: 'meetingEnded' });
      break;
    }

    case 'meetingBroadcast': {
      const message = ((msg.message as string) ?? '').trim();
      if (!message) break;
      for (const agent of agentManager.getAgents().values()) {
        if (!agent.ttyPath) continue;
        appleScriptTypeInTerminal(agent.ttyPath, message);
      }
      break;
    }

    case 'focusAgent':
      // No-op in standalone — just acknowledge
      break;

    case 'phaseComplete': {
      broadcast({
        type: 'phaseComplete',
        project: msg.project ?? '',
        phase: msg.phase ?? 1,
        summaries: msg.summaries ?? [],
      });
      break;
    }

    case 'saveLayout': {
      const newLayout = msg.layout as Record<string, unknown>;
      layout.layout = newLayout;
      writeLayout(newLayout);
      break;
    }

    case 'saveAgentSeats': {
      const seats = msg.seats as Record<number, string | null>;
      config.agentSeats = seats;
      // Also update agent seatIds
      for (const [idStr, seatId] of Object.entries(seats)) {
        const agentId = parseInt(idStr, 10);
        const agent = agentManager.getAgents().get(agentId);
        if (agent) agent.seatId = seatId;
      }
      saveConfig();
      break;
    }

    case 'setHooksEnabled':
      config.hooksEnabled = msg.enabled as boolean;
      saveConfig();
      break;

    case 'setSoundEnabled':
      config.soundEnabled = msg.enabled as boolean;
      saveConfig();
      break;

    case 'setWatchAllSessions':
      config.watchAllSessions = msg.enabled as boolean;
      saveConfig();
      break;

    case 'setAlwaysShowLabels':
      config.alwaysShowLabels = msg.enabled as boolean;
      saveConfig();
      break;

    case 'setLastSeenVersion':
      config.lastSeenVersion = msg.version as string;
      saveConfig();
      break;

    case 'addFolder': {
      const folderPath = msg.path as string;
      if (!config.folders.includes(folderPath)) {
        config.folders.push(folderPath);
        saveConfig();
      }
      const folders = config.folders.map((f) => ({ name: path.basename(f), path: f }));
      broadcast({ type: 'foldersUpdated', folders });
      break;
    }

    case 'removeFolder': {
      const folderPath = msg.path as string;
      config.folders = config.folders.filter((f) => f !== folderPath);
      saveConfig();
      const folders = config.folders.map((f) => ({ name: path.basename(f), path: f }));
      broadcast({ type: 'foldersUpdated', folders });
      break;
    }

    case 'getAdminRooms': {
      try {
        const rooms = JSON.parse(fs.readFileSync(PREMADE_ROOMS_PATH, 'utf-8'));
        send({ type: 'adminRoomsLoaded', rooms });
      } catch {
        send({ type: 'adminRoomsLoaded', rooms: [] });
      }
      break;
    }

    case 'saveAdminRooms': {
      try {
        const rooms = msg.rooms as unknown[];
        if (!Array.isArray(rooms)) break;
        fs.writeFileSync(PREMADE_ROOMS_PATH, JSON.stringify(rooms, null, 2));
        broadcast({ type: 'adminRoomsSaved', ok: true });
      } catch {
        send({ type: 'adminRoomsSaved', ok: false });
      }
      break;
    }

    case 'setHooksInfoShown':
      config.hooksInfoShown = true;
      saveConfig();
      break;

    case 'saveAgentRoster': {
      try {
        const roster = msg.roster as unknown;
        const dir = path.join(os.homedir(), '.pixel-agents');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, 'roster.json'), JSON.stringify(roster, null, 2));
        send({ type: 'agentRosterSaved', ok: true });
      } catch (err) {
        console.error('[Pixel Agents] Failed to save roster:', err);
        send({ type: 'agentRosterSaved', ok: false });
      }
      break;
    }

    case 'loadAgentRoster': {
      try {
        const rosterPath = path.join(os.homedir(), '.pixel-agents', 'roster.json');
        const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf-8')) as unknown;
        send({ type: 'agentRosterLoaded', roster });
      } catch {
        send({ type: 'agentRosterLoaded', roster: { agents: [] } });
      }
      break;
    }

    case 'resetAgentCounter': {
      agentManager.resetIdCounter({ clearAgents: true });
      config.persistedAgents = [];
      writeAppConfig(config);
      broadcast({ type: 'agentSystemReset' });
      break;
    }

    case 'setAgentMeta': {
      const id = msg.id as number;
      const agent = agentManager.getAgents().get(id);
      if (!agent) break;
      if (typeof msg.name === 'string') {
        agent.customName = msg.name || undefined;
        broadcast({ type: 'agentMetaUpdated', id, name: agent.customName ?? '' });
      }
      if (typeof msg.task === 'string') agent.task = msg.task || undefined;
      if (typeof msg.folderPath === 'string' && msg.folderPath) {
        agent.folderPath = msg.folderPath;
        agent.folderName = path.basename(msg.folderPath);
        broadcast({ type: 'agentMetaUpdated', id, folderName: agent.folderName });
      }
      if (typeof msg.mode === 'string') {
        const newMode = msg.mode as AgentMode;
        agent.mode = newMode === 'default' ? undefined : newMode;
        if (newMode !== 'default') {
          const instruction = buildInstruction(newMode, agent.effort);
          if (instruction && agent.ttyPath) {
            appleScriptTypeInTerminal(agent.ttyPath, instruction);
          }
        }
        broadcast({ type: 'agentMetaUpdated', id, mode: newMode });
      }
      if (typeof msg.effort === 'string') {
        const newEffort = msg.effort as AgentEffort;
        agent.effort = newEffort === 'none' ? undefined : newEffort;
        // Headless agents pick this up on their next message (buildInstruction);
        // a live terminal agent gets the guidance injected immediately.
        if (newEffort !== 'none' && agent.ttyPath) {
          const instruction = buildInstruction(agent.mode, newEffort);
          if (instruction) appleScriptTypeInTerminal(agent.ttyPath, instruction);
        }
        broadcast({ type: 'agentMetaUpdated', id, effort: newEffort });
      }
      if (typeof msg.homeZoneId === 'string') {
        agent.homeZoneId = msg.homeZoneId || undefined;
        broadcast({ type: 'agentMetaUpdated', id, homeZoneId: agent.homeZoneId ?? '' });
      }
      if (typeof msg.role === 'string' && ['ceo', 'manager', 'worker'].includes(msg.role)) {
        agent.role = msg.role as 'ceo' | 'manager' | 'worker';
        broadcast({ type: 'agentMetaUpdated', id, role: agent.role });
      }
      if (Array.isArray(msg.tasks)) {
        agent.tasks = msg.tasks as Array<{ label: string; done: boolean }>;
        broadcast({ type: 'agentMetaUpdated', id, tasks: agent.tasks });
      }
      if (typeof msg.canSpawn === 'boolean') {
        agent.canSpawn = msg.canSpawn;
        const ms = typeof msg.maxSpawn === 'number' ? msg.maxSpawn : (agent.maxSpawn ?? 3);
        agent.maxSpawn = ms;
        broadcast({ type: 'agentMetaUpdated', id, canSpawn: agent.canSpawn, maxSpawn: ms });
      } else if (typeof msg.maxSpawn === 'number') {
        agent.maxSpawn = msg.maxSpawn;
        if (agent.canSpawn)
          broadcast({
            type: 'agentMetaUpdated',
            id,
            canSpawn: agent.canSpawn,
            maxSpawn: agent.maxSpawn,
          });
      }
      saveConfig();
      break;
    }

    // Fix 2a — liveness check before waiting
    case 'agentReadyCheck': {
      const checkId = msg.id as number;
      const a = agentManager.getAgents().get(checkId);
      if (!a) {
        send({ type: 'agentReady', id: checkId, ready: false, reason: 'Agent not found' });
      } else if (!a.headless && !a.ttyPath) {
        send({
          type: 'agentReady',
          id: checkId,
          ready: false,
          reason: 'Ghost terminal — no live tab. Restart server to auto-convert to headless.',
        });
      } else {
        send({ type: 'agentReady', id: checkId, ready: true });
      }
      break;
    }

    // Fix 5 — list all agents for ceo-init
    case 'listAgents': {
      const agents = Array.from(agentManager.getAgents().values()).map((a) => ({
        id: a.id,
        name: a.customName,
        headless: a.headless,
        isCeo: a.isCeo,
        systemPrompt: a.systemPrompt,
        metadata: {
          version: a.promptVersion,
          lastTrained: a.lastTrained,
        },
      }));
      send({ type: 'agentsList', agents });
      break;
    }

    // Fix 5 — set system prompt on a live agent (called by ceo-init)
    case 'setAgentSystemPrompt': {
      const { agentName, systemPrompt, version, lastTrained } = msg as {
        agentName: string;
        systemPrompt: string;
        version: number;
        lastTrained: string;
        metadata?: Record<string, unknown>;
      };
      const target = Array.from(agentManager.getAgents().values()).find(
        (a) => a.customName?.toLowerCase() === agentName?.toLowerCase(),
      );
      if (target) {
        target.systemPrompt = systemPrompt;
        target.promptVersion = version;
        target.lastTrained = lastTrained;
        saveConfig();
        send({ type: 'agentPromptApplied', agentName, version });
      } else {
        // Agent not running — still ack so ceo-init doesn't time out
        send({
          type: 'agentPromptApplied',
          agentName,
          version,
          note: 'Agent not running — stored on next spawn',
        });
      }
      break;
    }

    // Fix 7 — self-modification proposal (gated by env var)
    case 'proposeAgent': {
      if (!process.env.PIXEL_AGENTS_ALLOW_SELF_SPAWN) {
        send({
          type: 'agentProposeRejected',
          reason: 'Self-spawn disabled. Set PIXEL_AGENTS_ALLOW_SELF_SPAWN=true to enable.',
        });
        break;
      }
      const {
        by,
        name: proposedName,
        task: proposedTask,
        role: proposedRole,
        trial,
        expiresAfter,
      } = msg as {
        by: number;
        name: string;
        task: string;
        role: string;
        trial: boolean;
        expiresAfter: string;
      };
      const proposalId = Date.now();
      broadcast({
        type: 'agentProposed',
        proposalId,
        by: proposedName,
        task: proposedTask,
        role: proposedRole,
        trial,
        expiresAfter,
      });
      console.log(`[Pixel Agents] Agent proposal #${proposalId} from ${by}: ${proposedName}`);
      break;
    }

    case 'approveAgentProposal': {
      if (!process.env.PIXEL_AGENTS_ALLOW_SELF_SPAWN) {
        send({ type: 'agentProposeRejected', reason: 'Self-spawn disabled.' });
        break;
      }
      const { proposedName, proposedTask, proposedRole, proposalId, parentId } = msg as {
        proposedName: string;
        proposedTask: string;
        proposedRole: string;
        proposalId: number;
        parentId?: number;
      };
      const folderPath = config.folders[0] || os.homedir();
      const newId = await agentManager.launchAgent(
        folderPath,
        true,
        undefined,
        true,
        undefined,
        'high',
        false,
      );
      const newAgent = agentManager.getAgents().get(newId);
      if (newAgent) {
        newAgent.customName = proposedName;
        newAgent.task = proposedTask;
        newAgent.role = proposedRole as 'manager' | 'worker';
        if (parentId) newAgent.homeZoneId = String(parentId);
      }
      saveConfig();
      send({ type: 'agentProposalApproved', proposalId, id: newId });
      break;
    }
  }
}

function saveConfig(): void {
  config.persistedAgents = agentManager.serializeAgents();
  writeAppConfig(config);
}

// ── Main startup ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('[Pixel Agents] Starting standalone app backend...');
  console.log(`[Pixel Agents] Assets dir: ${ASSETS_DIR}`);
  console.log(`[Pixel Agents] Project root: ${PROJECT_ROOT}`);

  // Load assets
  const assets = await loadAssets(ASSETS_DIR, PROJECT_ROOT);

  // Load layout
  const layout = loadOrInitLayout(assets.defaultLayout);

  // Restore persisted agents
  agentManager.restoreAgents(config.persistedAgents);

  // Pillar D2 — Load cumulative per-agent token + duration totals from disk so
  // the Summary tab survives backend restarts. Persists to ~/.pixel-agents/agent-history.json.
  loadAgentHistory();

  // Create HTTP server
  const httpServer = http.createServer((req, res) => {
    // CORS headers for dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Admin: rooms ─────────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/api/admin/rooms') {
      try {
        const data = fs.readFileSync(PREMADE_ROOMS_PATH, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      } catch {
        res.writeHead(500);
        res.end('{"error":"read failed"}');
      }
      return;
    }

    if (req.method === 'PUT' && req.url === '/api/admin/rooms') {
      readBody(req)
        .then((body) => {
          const rooms = JSON.parse(body);
          if (!Array.isArray(rooms)) throw new Error('not array');
          fs.writeFileSync(PREMADE_ROOMS_PATH, JSON.stringify(rooms, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        })
        .catch(() => {
          res.writeHead(400);
          res.end('{"error":"invalid"}');
        });
      return;
    }

    // ── Admin: inventory ──────────────────────────────────────────────────────
    if (req.method === 'GET' && req.url === '/api/admin/inventory') {
      try {
        const imported = readImportedSprites();
        const sprites = scanInventory(imported);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sources: sprites }));
      } catch (err) {
        console.error('[Pixel Agents] Inventory scan error:', err);
        res.writeHead(500);
        res.end('{"error":"scan failed"}');
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/admin/save-default-layout') {
      readBody(req, 4 * 1024 * 1024)
        .then((body) => {
          const { layout } = JSON.parse(body) as { layout: unknown };
          const dest = path.join(ASSETS_DIR, 'default-layout.json');
          fs.writeFileSync(dest, JSON.stringify(layout, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch((err) => {
          console.error('[Pixel Agents] Save default layout error:', err);
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/admin/reload-assets') {
      loadAssets(ASSETS_DIR, PROJECT_ROOT)
        .then((freshAssets) => {
          if (freshAssets.floors.length > 0) {
            broadcast({ type: 'floorTilesLoaded', sprites: freshAssets.floors });
          }
          if (freshAssets.furnitureCatalog.length > 0) {
            broadcast({
              type: 'furnitureAssetsLoaded',
              catalog: freshAssets.furnitureCatalog,
              sprites: freshAssets.furnitureSprites,
            });
          }
          console.log(
            `[Pixel Agents] Assets reloaded: ${freshAssets.furnitureCatalog.length} furniture, ${freshAssets.floors.length} floors`,
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              furniture: freshAssets.furnitureCatalog.length,
              floors: freshAssets.floors.length,
            }),
          );
        })
        .catch((err) => {
          console.error('[Pixel Agents] Reload assets error:', err);
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        });
      return;
    }

    if (req.method === 'DELETE' && req.url?.startsWith('/api/admin/furniture/')) {
      const id = decodeURIComponent(req.url.slice('/api/admin/furniture/'.length));
      if (!id || id.includes('/') || id.includes('..')) {
        res.writeHead(400);
        res.end('{"error":"invalid id"}');
        return;
      }
      try {
        const furDir = path.join(ASSETS_DIR, 'furniture', id);
        if (!fs.existsSync(furDir)) {
          res.writeHead(404);
          res.end('{"error":"not found"}');
          return;
        }
        const disabledDir = path.join(ASSETS_DIR, 'furniture', '_disabled');
        fs.mkdirSync(disabledDir, { recursive: true });
        fs.renameSync(furDir, path.join(disabledDir, id));
        // Reload and broadcast updated catalog
        loadAssets(ASSETS_DIR, PROJECT_ROOT)
          .then((freshAssets) => {
            broadcast({
              type: 'furnitureAssetsLoaded',
              catalog: freshAssets.furnitureCatalog,
              sprites: freshAssets.furnitureSprites,
            });
          })
          .catch(() => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('[Pixel Agents] Delete furniture error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/admin/import-sprite') {
      readBody(req, 2 * 1024 * 1024)
        .then((body) => {
          interface ImportReq {
            sourceId: string;
            dataUrl: string;
            name: string;
            category: string;
            footprintW: number;
            footprintH: number;
            canPlaceOnWalls: boolean;
            canPlaceOnSurfaces: boolean;
            isFloor: boolean;
          }
          const req2 = JSON.parse(body) as ImportReq;
          const base64 = req2.dataUrl.replace(/^data:image\/png;base64,/, '');
          const pngBuf = Buffer.from(base64, 'base64');
          const png = PNG.sync.read(pngBuf);

          if (req2.isFloor) {
            const floorsDir = path.join(ASSETS_DIR, 'floors');
            fs.mkdirSync(floorsDir, { recursive: true });
            const existing = fs.readdirSync(floorsDir).filter((f) => /^floor_\d+\.png$/i.test(f));
            const n = existing.length;
            const gray = toGrayscalePng(base64);
            fs.writeFileSync(path.join(floorsDir, `floor_${n}.png`), gray);
            const imported = readImportedSprites();
            imported.add(req2.sourceId);
            writeImportedSprites(imported);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, id: `floor_${n}` }));
          } else {
            const id = slugify(req2.name);
            if (!id) throw new Error('empty name');
            const furDir = path.join(ASSETS_DIR, 'furniture', id);
            const manifestPath = path.join(furDir, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: `${id} already exists` }));
              return;
            }
            fs.mkdirSync(furDir, { recursive: true });
            const assetId = `${id}_FRONT`;
            fs.writeFileSync(path.join(furDir, `${assetId}.png`), pngBuf);
            const manifest = {
              type: 'asset',
              id,
              name: req2.name,
              category: req2.category,
              file: `${assetId}.png`,
              width: png.width,
              height: png.height,
              footprintW: req2.footprintW,
              footprintH: req2.footprintH,
              orientation: 'front',
              canPlaceOnWalls: req2.canPlaceOnWalls,
              canPlaceOnSurfaces: req2.canPlaceOnSurfaces,
            };
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
            const imported = readImportedSprites();
            imported.add(req2.sourceId);
            writeImportedSprites(imported);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, id }));
          }
        })
        .catch((err) => {
          console.error('[Pixel Agents] Import error:', err);
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        });
      return;
    }

    serveStatic(req, res);
  });

  // Attach WebSocket server — gate connections (the bus can spawn
  // --dangerously-skip-permissions agents, so it must not accept any caller).
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info: { origin: string; secure: boolean; req: http.IncomingMessage }) => {
      const ok = isAuthorizedWsClient(info.req);
      if (!ok) {
        console.warn(
          `[Pixel Agents] Rejected WS connection (origin=${info.req.headers.origin ?? 'none'})`,
        );
      }
      return ok;
    },
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[Pixel Agents] Client connected (${clients.size} total)`);

    ws.on('message', (data) => {
      handleClientMessage(ws, data.toString(), assets, layout).catch((err) => {
        console.error('[Pixel Agents] Error handling message:', err);
      });
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[Pixel Agents] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('[Pixel Agents] WebSocket error:', err);
    });
  });

  // Start main HTTP server — bind localhost only (was all interfaces = LAN-reachable).
  httpServer.listen(APP_PORT, '127.0.0.1', () => {
    console.log(`[Pixel Agents] App server listening on http://localhost:${APP_PORT}`);
  });

  // Start hook server
  startHookServer();

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Pixel Agents] Shutting down...');
    for (const [id, agent] of agentManager.getAgents()) {
      if (agent.ttyPath) agentManager.removeAgent(id, false);
    }
    saveConfig();
    fleetWatcher?.dispose();
    agentManager.dispose();
    // Clean up server.json
    try {
      const serverJsonPath = path.join(os.homedir(), '.pixel-agents', 'server.json');
      if (fs.existsSync(serverJsonPath)) {
        const data = JSON.parse(fs.readFileSync(serverJsonPath, 'utf-8')) as { pid: number };
        if (data.pid === process.pid) fs.unlinkSync(serverJsonPath);
      }
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Pixel Agents] Fatal error:', err);
  process.exit(1);
});

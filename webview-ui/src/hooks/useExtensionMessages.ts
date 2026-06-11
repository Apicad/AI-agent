import { useEffect, useRef, useState } from 'react';

import { playDoneSound, playPermissionSound, setSoundEnabled } from '../notificationSound.js';
import { setFleetHandoffs } from '../office/engine/handoffStore.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import { extractToolName } from '../office/toolUtils.js';
import type { FleetHandoff, OfficeLayout, ToolActivity } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import { vscode } from '../vscodeApi.js';

export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
}

interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface RoomTemplate {
  name: string;
  cols: number;
  rows: number;
  tiles: number[];
  furniture: unknown[];
  tileColors: (unknown | null)[];
  version: number;
}

export interface AgentHistoryEntry {
  entryId: string;
  toolName: string;
  statusText: string;
  timestamp: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  type: 'tool_done' | 'waiting' | 'permission';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

// ── Fleet (claude-brain vault) state — mirror of app/src/fleetWatcher.ts ──────

export interface FleetBoardRow {
  agent: string;
  task: string;
  tier: string;
  status: string;
}

export interface FleetPhasePlan {
  title: string;
  items: { text: string; done: boolean }[];
}

export interface FleetProject {
  slug: string;
  boardPhase: number | null;
  boardGate: string | null;
  rows: FleetBoardRow[];
  blockers: string | null;
  nextGate: string | null;
  phase: number | null;
  phaseName: string | null;
  gate: string | null;
  gateLog: string[];
  plans: FleetPhasePlan[];
  started: number | null;
}

export interface FleetState {
  vaultRoot: string;
  boardUpdated: string | null;
  activeProjects: string[];
  idleRoster: string[];
  projects: FleetProject[];
  inboxes: Record<string, string[]>;
  handoffs: FleetHandoff[];
  drift: string[];
  generatedAt: number;
}

const MAX_HISTORY_PER_AGENT = 30;

interface ExtensionMessageState {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  layoutWasReset: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
  externalAssetDirectories: string[];
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  setWatchAllSessions: (v: boolean) => void;
  alwaysShowLabels: boolean;
  hooksEnabled: boolean;
  setHooksEnabled: (v: boolean) => void;
  hooksInfoShown: boolean;
  agentHistory: Record<number, AgentHistoryEntry[]>;
  adminRooms: RoomTemplate[];
  agentNames: Record<number, string>;
  agentTasks: Record<number, string>;
  agentFolderNames: Record<number, string>;
  agentFolderPaths: Record<number, string>;
  agentMessages: Record<number, ChatMessage[]>;
  agentModes: Record<number, string>;
  agentHomeZones: Record<number, string>;
  agentRoles: Record<number, string>;
  hasCeoAgent: boolean;
  ceoAgentIds: Set<number>;
  pendingFileAttach: Record<number, string>;
  clearPendingFileAttach: (agentId: number) => void;
  newAgentFolderPath: string;
  agentLastMessageAt: Record<number, number>;
  agentActiveIds: Set<number>;
  agentChecklist: Record<number, Array<{ label: string; done: boolean }>>;
  pendingPhaseReview: {
    project: string;
    phase: number;
    summaries: { agent: string; content: string }[];
  } | null;
  clearPendingPhaseReview: () => void;
  fleetState: FleetState | null;
  lastError: string | null;
  isMeetingActive: boolean;
  meetingTopic: string;
  agentCanSpawn: Record<number, { canSpawn: boolean; maxSpawn: number }>;
}

function saveAgentSeats(os: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) continue;
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats });
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [subagentTools, setSubagentTools] = useState<
    Record<number, Record<string, ToolActivity[]>>
  >({});
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutWasReset, setLayoutWasReset] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);
  const [externalAssetDirectories, setExternalAssetDirectories] = useState<string[]>([]);
  const [lastSeenVersion, setLastSeenVersion] = useState('');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [watchAllSessions, setWatchAllSessions] = useState(false);
  const [alwaysShowLabels, setAlwaysShowLabels] = useState(false);
  const [hooksEnabled, setHooksEnabled] = useState(true);
  const [hooksInfoShown, setHooksInfoShown] = useState(true);
  const [agentHistory, setAgentHistory] = useState<Record<number, AgentHistoryEntry[]>>({});
  const [adminRooms, setAdminRooms] = useState<RoomTemplate[]>([]);
  const [agentNames, setAgentNames] = useState<Record<number, string>>({});
  const [agentTasks, setAgentTasks] = useState<Record<number, string>>({});
  const [agentFolderNames, setAgentFolderNames] = useState<Record<number, string>>({});
  const [agentFolderPaths, setAgentFolderPaths] = useState<Record<number, string>>({});
  const [newAgentFolderPath, setNewAgentFolderPath] = useState('');
  const [agentMessages, setAgentMessages] = useState<Record<number, ChatMessage[]>>({});
  const [agentLastMessageAt, setAgentLastMessageAt] = useState<Record<number, number>>({});
  const [agentActiveIds, setAgentActiveIds] = useState<Set<number>>(new Set());
  const [agentModes, setAgentModes] = useState<Record<number, string>>({});
  const [agentHomeZones, setAgentHomeZones] = useState<Record<number, string>>({});
  const [agentRoles, setAgentRoles] = useState<Record<number, string>>({});
  const [agentCanSpawn, setAgentCanSpawn] = useState<
    Record<number, { canSpawn: boolean; maxSpawn: number }>
  >({});
  const [ceoAgentIds, setCeoAgentIds] = useState<Set<number>>(new Set());
  const [pendingFileAttach, setPendingFileAttach] = useState<Record<number, string>>({});
  const [agentChecklist, setAgentChecklist] = useState<
    Record<number, Array<{ label: string; done: boolean }>>
  >({});
  const [pendingPhaseReview, setPendingPhaseReview] = useState<{
    project: string;
    phase: number;
    summaries: { agent: string; content: string }[];
  } | null>(null);
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [meetingTopic, setMeetingTopic] = useState('');
  const [fleetState, setFleetState] = useState<FleetState | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const toolStartTimesRef = useRef<
    Record<string, { time: number; toolName: string; statusText: string }>
  >({});

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);

  useEffect(() => {
    // Buffer agents from existingAgents until layout is loaded
    let pendingAgents: Array<{
      id: number;
      palette?: number;
      hueShift?: number;
      seatId?: string;
      folderName?: string;
      customName?: string;
      task?: string;
      mode?: string;
      homeZoneId?: string;
    }> = [];

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      const os = getOfficeState();

      if (msg.type === 'layoutLoaded') {
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes');
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (layout) {
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(layout);
        } else {
          // Default layout — snapshot whatever OfficeState built
          onLayoutLoaded?.(os.getLayout());
        }
        // Add buffered agents now that layout (and seats) are correct
        for (const p of pendingAgents) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
          const ch = os.characters.get(p.id);
          if (ch) {
            if (p.customName) ch.customName = p.customName;
            if (p.task) ch.task = p.task;
            if (p.mode) ch.mode = p.mode as 'default' | 'planner' | 'automation' | 'liberty';
            if (p.homeZoneId) ch.homeZoneId = p.homeZoneId;
          }
        }
        pendingAgents = [];
        layoutReadyRef.current = true;
        setLayoutReady(true);
        if (msg.wasReset) {
          setLayoutWasReset(true);
        }
        if (os.characters.size > 0) {
          saveAgentSeats(os);
        }
      } else if (msg.type === 'agentCreated') {
        const id = msg.id as number;
        const folderName = msg.folderName as string | undefined;
        const folderPath = msg.folderPath as string | undefined;
        if (msg.isCeo) {
          setCeoAgentIds((prev) => new Set([...prev, id]));
          setAgentRoles((prev) => ({ ...prev, [id]: 'ceo' }));
        }
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSelectedAgent(id);
        if (folderName) setAgentFolderNames((prev) => ({ ...prev, [id]: folderName }));
        if (folderPath) setAgentFolderPaths((prev) => ({ ...prev, [id]: folderPath }));
        os.addAgent(id, undefined, undefined, undefined, undefined, folderName);
        saveAgentSeats(os);
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number;
        setAgents((prev) => prev.filter((a) => a !== id));
        setSelectedAgent((prev) => (prev === id ? null : prev));
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Remove all sub-agent characters belonging to this agent
        os.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        setAgentHistory((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentNames((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setAgentTasks((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setAgentFolderNames((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setAgentFolderPaths((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setAgentMessages((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setAgentLastMessageAt((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setAgentActiveIds((prev) => {
          const s = new Set(prev);
          s.delete(id);
          return s;
        });
        setAgentModes((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setAgentHomeZones((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setAgentRoles((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setCeoAgentIds((prev) => {
          const s = new Set(prev);
          s.delete(id);
          return s;
        });
        setAgentChecklist((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        os.removeAgent(id);
      } else if (msg.type === 'agentTextOutput') {
        const id = msg.id as number;
        const text = msg.text as string;
        if (text) {
          setAgentMessages((prev) => ({
            ...prev,
            [id]: [...(prev[id] ?? []).slice(-49), { role: 'assistant', text, ts: Date.now() }],
          }));
          setAgentLastMessageAt((prev) => ({ ...prev, [id]: Date.now() }));
        }
      } else if (msg.type === 'agentUserMessage') {
        const id = msg.id as number;
        const text = msg.message as string;
        if (text) {
          setAgentMessages((prev) => ({
            ...prev,
            [id]: [...(prev[id] ?? []).slice(-49), { role: 'user', text, ts: Date.now() }],
          }));
          setAgentLastMessageAt((prev) => ({ ...prev, [id]: Date.now() }));
        }
      } else if (msg.type === 'fileSelectedForAttach') {
        const id = msg.agentId as number;
        const p = msg.path as string;
        if (p) setPendingFileAttach((prev) => ({ ...prev, [id]: p }));
      } else if (msg.type === 'folderSelected') {
        const id = msg.agentId as number;
        const selectedPath = msg.path as string;
        const name = selectedPath.split('/').pop() ?? selectedPath;
        if (id === -1) {
          setNewAgentFolderPath(selectedPath);
        } else {
          setAgentFolderPaths((prev) => ({ ...prev, [id]: selectedPath }));
          setAgentFolderNames((prev) => ({ ...prev, [id]: name }));
          vscode.postMessage({ type: 'setAgentMeta', id, folderPath: selectedPath });
        }
      } else if (msg.type === 'agentMetaUpdated') {
        const id = msg.id as number;
        if (typeof msg.name === 'string') {
          if (msg.name) {
            setAgentNames((prev) => ({ ...prev, [id]: msg.name as string }));
          } else {
            setAgentNames((prev) => {
              const n = { ...prev };
              delete n[id];
              return n;
            });
          }
          const ch = os.characters.get(id);
          if (ch) ch.customName = (msg.name as string) || undefined;
        }
        if (typeof msg.folderName === 'string') {
          setAgentFolderNames((prev) => ({ ...prev, [id]: msg.folderName as string }));
          const ch = os.characters.get(id);
          if (ch) ch.folderName = msg.folderName as string;
        }
        if (typeof msg.mode === 'string') {
          setAgentModes((prev) => ({ ...prev, [id]: msg.mode as string }));
          const ch = os.characters.get(id);
          if (ch) ch.mode = msg.mode as 'default' | 'planner' | 'automation' | 'liberty';
        }
        if (typeof msg.homeZoneId === 'string') {
          const zoneId = msg.homeZoneId || undefined;
          setAgentHomeZones((prev) => {
            const next = { ...prev };
            if (zoneId) next[id] = zoneId;
            else delete next[id];
            return next;
          });
          const ch = os.characters.get(id);
          if (ch) ch.homeZoneId = zoneId;
        }
        if (typeof msg.role === 'string' && msg.role) {
          setAgentRoles((prev) => ({ ...prev, [id]: msg.role as string }));
        }
        if (typeof msg.task === 'string' && msg.task) {
          setAgentTasks((prev) => ({ ...prev, [id]: msg.task as string }));
        }
        if (Array.isArray(msg.tasks)) {
          setAgentChecklist((prev) => ({
            ...prev,
            [id]: msg.tasks as Array<{ label: string; done: boolean }>,
          }));
        }
        if (typeof msg.canSpawn === 'boolean') {
          setAgentCanSpawn((prev) => ({
            ...prev,
            [id]: { canSpawn: msg.canSpawn as boolean, maxSpawn: (msg.maxSpawn as number) ?? 3 },
          }));
        }
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[];
        const meta = (msg.agentMeta || {}) as Record<
          number,
          { palette?: number; hueShift?: number; seatId?: string }
        >;
        const folderNames = (msg.folderNames || {}) as Record<number, string>;
        const incomingFolderPaths = (msg.folderPaths || {}) as Record<number, string>;
        const incomingNames = (msg.agentNames || {}) as Record<number, string>;
        const incomingTasks = (msg.agentTasks || {}) as Record<number, string>;
        const incomingModes = (msg.agentModes || {}) as Record<number, string>;
        const incomingEfforts = (msg.agentEfforts || {}) as Record<number, string>;
        const incomingHomeZones = (msg.agentHomeZones || {}) as Record<number, string>;
        const incomingCeoFlags = (msg.agentCeoFlags || {}) as Record<number, boolean>;
        const incomingRoles = (msg.agentRoles || {}) as Record<number, string>;
        const incomingCanSpawn = (msg.agentCanSpawn || {}) as Record<number, boolean>;
        const incomingMaxSpawn = (msg.agentMaxSpawn || {}) as Record<number, number>;
        const incomingStatuses = (msg.agentStatuses || {}) as Record<number, string>;
        // Pillar D2 — Rehydrate cumulative per-agent totals from the backend store.
        // The backend persists totalInputTokens/totalOutputTokens/totalDurationMs/turnCount/lastTurnAt
        // to ~/.pixel-agents/agent-history.json and includes a snapshot in this payload so the Summary
        // tab survives backend restarts. Synthesized as a single AgentHistoryEntry per agent so the
        // existing Summary aggregation (which sums entries) sees correct cumulative totals.
        const incomingTotals = (msg.agentHistoryTotals || {}) as Record<
          number,
          {
            totalInputTokens: number;
            totalOutputTokens: number;
            totalDurationMs: number;
            turnCount: number;
            lastTurnAt: number;
          }
        >;
        if (Object.keys(incomingTotals).length > 0) {
          setAgentHistory((prev) => {
            const next = { ...prev };
            for (const [idStr, t] of Object.entries(incomingTotals)) {
              const id = Number(idStr);
              // Skip if this agent already has live history this session — live takes precedence.
              if (next[id] && next[id].length > 0) continue;
              next[id] = [
                {
                  entryId: `restored-${id}-${t.lastTurnAt}`,
                  toolName: 'cumulative',
                  statusText: `${t.turnCount} turn(s) prior to backend restart`,
                  timestamp: t.lastTurnAt,
                  durationMs: t.totalDurationMs || undefined,
                  inputTokens: t.totalInputTokens || undefined,
                  outputTokens: t.totalOutputTokens || undefined,
                  type: 'waiting',
                },
              ];
            }
            return next;
          });
        }
        setCeoAgentIds(
          new Set(
            Object.entries(incomingCeoFlags)
              .filter(([, v]) => v)
              .map(([k]) => Number(k)),
          ),
        );
        setAgentRoles((prev) => ({ ...prev, ...incomingRoles }));
        // Restore agent activity status on reload so working agents don't appear idle
        if (Object.keys(incomingStatuses).length > 0) {
          setAgentStatuses((prev) => ({ ...prev, ...incomingStatuses }));
        }
        // Restore canSpawn/maxSpawn for all agents that had spawning rights
        setAgentCanSpawn((prev) => {
          const next = { ...prev };
          for (const [idStr, cs] of Object.entries(incomingCanSpawn)) {
            if (cs)
              next[Number(idStr)] = {
                canSpawn: true,
                maxSpawn: incomingMaxSpawn[Number(idStr)] ?? 3,
              };
          }
          return next;
        });
        // If layout has already loaded (typical on reload — backend sends layoutLoaded BEFORE existingAgents),
        // add agents to OS immediately so the canvas pixel characters appear.
        // Otherwise buffer them so they can be added once layoutLoaded fires.
        if (layoutReadyRef.current) {
          for (const id of incoming) {
            const m = meta[id];
            os.addAgent(id, m?.palette, m?.hueShift, m?.seatId, true, folderNames[id]);
            const ch = os.characters.get(id);
            if (ch) {
              if (incomingNames[id]) ch.customName = incomingNames[id];
              if (incomingTasks[id]) ch.task = incomingTasks[id];
              if (incomingModes[id])
                ch.mode = incomingModes[id] as 'default' | 'planner' | 'automation' | 'liberty';
              if (incomingHomeZones[id]) ch.homeZoneId = incomingHomeZones[id];
            }
          }
          if (os.characters.size > 0) saveAgentSeats(os);
        } else {
          for (const id of incoming) {
            const m = meta[id];
            pendingAgents.push({
              id,
              palette: m?.palette,
              hueShift: m?.hueShift,
              seatId: m?.seatId,
              folderName: folderNames[id],
              customName: incomingNames[id],
              task: incomingTasks[id],
              mode: incomingModes[id],
              homeZoneId: incomingHomeZones[id],
            });
          }
        }
        setAgentFolderNames((prev) => ({ ...prev, ...folderNames }));
        setAgentFolderPaths((prev) => ({ ...prev, ...incomingFolderPaths }));
        setAgentNames((prev) => ({ ...prev, ...incomingNames }));
        setAgentTasks((prev) => ({ ...prev, ...incomingTasks }));
        // Merge effort into modes so the ⚡ button initializes correctly:
        // effort 'high' → 'automation', 'max' → 'liberty', anything else → leave as-is
        const effortAsModes: Record<number, string> = {};
        for (const [idStr, eff] of Object.entries(incomingEfforts)) {
          if (eff === 'max') effortAsModes[Number(idStr)] = 'liberty';
          else if (eff === 'high') effortAsModes[Number(idStr)] = 'automation';
        }
        setAgentModes((prev) => ({ ...effortAsModes, ...prev, ...incomingModes }));
        setAgentHomeZones((prev) => ({ ...prev, ...incomingHomeZones }));
        setAgents((prev) => {
          const ids = new Set(prev);
          const merged = [...prev];
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id);
            }
          }
          return merged.sort((a, b) => a - b);
        });
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        const permissionActive = msg.permissionActive as boolean | undefined;
        setAgentTools((prev) => {
          const list = prev[id] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return {
            ...prev,
            [id]: [
              ...list,
              { toolId, status, done: false, permissionWait: permissionActive || false },
            ],
          };
        });
        const toolName = (msg.toolName as string | undefined) ?? extractToolName(status) ?? '';
        toolStartTimesRef.current[toolId] = { time: Date.now(), toolName, statusText: status };
        os.setAgentTool(id, toolName);
        os.setAgentActive(id, true);
        // Don't clear the permission bubble if the hook already confirmed permission is needed
        if (!permissionActive) {
          os.clearPermissionBubble(id);
        }
        // Create sub-agent character for Task/Agent tool subtasks
        if (toolName === 'Task' || toolName === 'Agent') {
          const label = status.startsWith('Subtask:') ? status.slice('Subtask:'.length).trim() : '';
          const subId = os.addSubagent(id, toolId);
          setSubagentCharacters((prev) => {
            if (prev.some((s) => s.id === subId)) return prev;
            return [...prev, { id: subId, parentAgentId: id, parentToolId: toolId, label }];
          });
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          };
        });
        const startData = toolStartTimesRef.current[toolId];
        if (startData) {
          const durationMs = Date.now() - startData.time;
          delete toolStartTimesRef.current[toolId];
          const entry: AgentHistoryEntry = {
            entryId: toolId + '-done',
            toolName: startData.toolName,
            statusText: startData.statusText,
            timestamp: Date.now(),
            durationMs,
            type: 'tool_done',
          };
          setAgentHistory((prev) => {
            const existing = prev[id] ?? [];
            return { ...prev, [id]: [entry, ...existing].slice(0, MAX_HISTORY_PER_AGENT) };
          });
        }
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Remove all sub-agent characters belonging to this agent
        os.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os.setAgentTool(id, null);
        os.clearPermissionBubble(id);
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number;
        setSelectedAgent(id);
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number;
        const status = msg.status as string;
        // Always store the status — the card's progress bar / pill / canvas-node 'thinking' glow
        // all key off agentStatuses[id] === 'active'. Deleting on 'active' silently broke them.
        setAgentStatuses((prev) => ({ ...prev, [id]: status }));
        setAgentActiveIds((prev) => {
          const s = new Set(prev);
          if (status === 'active') s.add(id);
          else s.delete(id);
          return s;
        });
        os.setAgentActive(id, status === 'active');
        if (status === 'active') {
          os.walkToZone(id, 'work');
        } else if (status === 'waiting') {
          os.sendToSeat(id);
        }
        if (status === 'waiting') {
          os.showWaitingBubble(id);
          playDoneSound();
          const waitEntry: AgentHistoryEntry = {
            entryId: 'waiting-' + Date.now(),
            toolName: '',
            statusText: 'Done',
            timestamp: Date.now(),
            durationMs: typeof msg.durationMs === 'number' ? msg.durationMs : undefined,
            inputTokens: typeof msg.inputTokens === 'number' ? msg.inputTokens : undefined,
            outputTokens: typeof msg.outputTokens === 'number' ? msg.outputTokens : undefined,
            type: 'waiting',
          };
          setAgentHistory((prev) => {
            const existing = prev[id] ?? [];
            return { ...prev, [id]: [waitEntry, ...existing].slice(0, MAX_HISTORY_PER_AGENT) };
          });
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          };
        });
        os.showPermissionBubble(id);
        playPermissionSound();
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        // Show permission bubble on the sub-agent character
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          os.showPermissionBubble(subId);
        }
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          const hasPermission = list.some((t) => t.permissionWait);
          if (!hasPermission) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          };
        });
        os.clearPermissionBubble(id);
        // Also clear permission bubbles on all sub-agent characters of this parent
        for (const [subId, meta] of os.subagentMeta) {
          if (meta.parentAgentId === id) {
            os.clearPermissionBubble(subId);
          }
        }
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {};
          const list = agentSubs[parentToolId] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
          };
        });
        // Update sub-agent character's tool and active state
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          const subToolName = extractToolName(status);
          os.setAgentTool(subId, subToolName);
          os.setAgentActive(subId, true);
        }
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs) return prev;
          const list = agentSubs[parentToolId];
          if (!list) return prev;
          return {
            ...prev,
            [id]: {
              ...agentSubs,
              [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
            },
          };
        });
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs || !(parentToolId in agentSubs)) return prev;
          const next = { ...agentSubs };
          delete next[parentToolId];
          if (Object.keys(next).length === 0) {
            const outer = { ...prev };
            delete outer[id];
            return outer;
          }
          return { ...prev, [id]: next };
        });
        // Remove sub-agent character
        os.removeSubagent(id, parentToolId);
        setSubagentCharacters((prev) =>
          prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)),
        );
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
        setCharacterTemplates(characters);
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const sets = msg.sets as string[][][][];
        console.log(`[Webview] Received ${sets.length} wall tile set(s)`);
        setWallSprites(sets);
      } else if (msg.type === 'workspaceFolders') {
        const folders = msg.folders as WorkspaceFolder[];
        setWorkspaceFolders(folders);
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean;
        setSoundEnabled(soundOn);
        if (typeof msg.watchAllSessions === 'boolean') {
          setWatchAllSessions(msg.watchAllSessions as boolean);
        }
        if (typeof msg.alwaysShowLabels === 'boolean') {
          setAlwaysShowLabels(msg.alwaysShowLabels as boolean);
        }
        if (typeof msg.hooksEnabled === 'boolean') {
          setHooksEnabled(msg.hooksEnabled as boolean);
        }
        if (typeof msg.hooksInfoShown === 'boolean') {
          setHooksInfoShown(msg.hooksInfoShown as boolean);
        }
        if (Array.isArray(msg.externalAssetDirectories)) {
          setExternalAssetDirectories(msg.externalAssetDirectories as string[]);
        }
        if (typeof msg.lastSeenVersion === 'string') {
          setLastSeenVersion(msg.lastSeenVersion as string);
        }
        if (typeof msg.extensionVersion === 'string') {
          setExtensionVersion(msg.extensionVersion as string);
        }
      } else if (msg.type === 'externalAssetDirectoriesUpdated') {
        if (Array.isArray(msg.dirs)) {
          setExternalAssetDirectories(msg.dirs as string[]);
        }
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites });
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
        }
      } else if (msg.type === 'adminRoomsLoaded') {
        setAdminRooms(msg.rooms as RoomTemplate[]);
      } else if (msg.type === 'meetingStarted') {
        setIsMeetingActive(true);
        setMeetingTopic((msg.topic as string) ?? '');
      } else if (msg.type === 'meetingEnded') {
        setIsMeetingActive(false);
        setMeetingTopic('');
      } else if (msg.type === 'phaseComplete') {
        setPendingPhaseReview({
          project: (msg.project as string) ?? '',
          phase: typeof msg.phase === 'number' ? msg.phase : 1,
          summaries: Array.isArray(msg.summaries)
            ? (msg.summaries as { agent: string; content: string }[])
            : [],
        });
      } else if (msg.type === 'phaseUpdate') {
        // Pillar D1 — backend broadcasts this on phase init/done. Write localStorage
        // directly so the banner polling in App.tsx (every 2s) picks up the change without
        // depending on Scrum-Master remembering to write the keys itself.
        if (
          typeof msg.currentPhase === 'number' ||
          (typeof msg.currentPhase === 'string' && msg.currentPhase)
        ) {
          localStorage.setItem('pixel-agents-current-phase', String(msg.currentPhase));
        }
        if (Array.isArray(msg.phaseNames)) {
          localStorage.setItem('pixel-agents-phase-names', JSON.stringify(msg.phaseNames));
        }
        if (typeof msg.runMode === 'string' && msg.runMode) {
          localStorage.setItem('pixel-agents-run-mode', msg.runMode);
        }
        if (msg.gatePending === true && msg.project && typeof msg.phase === 'number') {
          localStorage.setItem(
            'pixel-agents-phase-gate',
            JSON.stringify({
              project: msg.project,
              phase: msg.phase,
              timestamp: Date.now(),
            }),
          );
        } else if (msg.gatePending === false) {
          localStorage.removeItem('pixel-agents-phase-gate');
        }
      } else if (msg.type === 'fleetState') {
        const fleet = (msg.state as FleetState) ?? null;
        setFleetState(fleet);
        setFleetHandoffs(fleet?.handoffs ?? []);
        setLastError(null);
      } else if (msg.type === 'error') {
        console.error('[Pixel Agents]', msg.message);
        setLastError(String(msg.message ?? 'Unknown backend error'));
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'webviewReady' });
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getOfficeState]);

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
    agentHistory,
    adminRooms,
    agentNames,
    agentTasks,
    agentFolderNames,
    agentFolderPaths,
    agentMessages,
    agentModes,
    agentHomeZones,
    agentRoles,
    agentCanSpawn,
    hasCeoAgent: ceoAgentIds.size > 0,
    ceoAgentIds,
    pendingFileAttach,
    clearPendingFileAttach: (agentId: number) =>
      setPendingFileAttach((prev) => {
        const n = { ...prev };
        delete n[agentId];
        return n;
      }),
    agentChecklist,
    pendingPhaseReview,
    clearPendingPhaseReview: () => setPendingPhaseReview(null),
    isMeetingActive,
    meetingTopic,
    newAgentFolderPath,
    agentLastMessageAt,
    agentActiveIds,
    fleetState,
    lastError,
  };
}

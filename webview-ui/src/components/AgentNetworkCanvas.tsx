import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentHistoryEntry, ChatMessage as ExtChatMessage,SubagentCharacter, WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import type { ToolActivity } from '../office/types.js';
import { vscode } from '../vscodeApi.js';
import { PhaseFlowPanel } from './PhaseFlowPanel.js';

// ── Types ─────────────────────────────────────────────────────

type Tool = 'hand' | 'move' | 'connect' | 'cut';
type Role = 'ceo' | 'manager' | 'worker';
type Status = 'idle' | 'planning' | 'working' | 'waiting' | 'thinking' | 'communicating';
type Effort = 'none' | 'low' | 'medium' | 'high' | 'max';
type EdgeKind = 'idle' | 'instructing' | 'active' | 'waiting';

interface NodeExtras {
  effort: Effort;
  canSpawn: boolean;
  maxSpawn: number;
  role: Role;
  enabled: boolean;
  planOverride: boolean;
}

interface AgentNode {
  id: string;
  x: number;
  y: number;
  name: string;
  description: string;
  role: Role;
  status: Status;
  planMode: boolean;
  effort: Effort;
  canSpawn: boolean;
  maxSpawn: number;
  activity?: string;
  thought?: string;
  enabled: boolean;
}

interface AgentEdge {
  id: string;
  sourceId: string;
  targetId: string;
  active?: boolean;
}

interface ChatMessage {
  id: string;
  from: 'user' | 'agent';
  text: string;
  ts: number;
}

// ── Constants ─────────────────────────────────────────────────

const NODE_W = 240;
const NODE_H = 260;
const PORT_R = 9;
const SNAP_DIST = 60;

const ROLE_COLOR: Record<Role, string> = {
  ceo: 'var(--color-status-permission)',
  manager: 'var(--color-status-active)',
  worker: 'var(--color-border)',
};

const TIER_COLOR_ADVISOR = '#a855f7';   // purple — Chief-of-Staff / Scrum-Master
const TIER_COLOR_DOMAIN  = '#6b7280';   // gray — domain data agents
const TIER_COLOR_WORKER  = '#22c55e';   // green — workers

function nodeBorderColor(node: AgentNode): string {
  if (node.role === 'ceo') return ROLE_COLOR.ceo;
  if (node.role === 'manager') return ROLE_COLOR.manager;
  const n = node.name;
  if (n.includes('Chief-of-Staff') || n.includes('Scrum-Master')) return TIER_COLOR_ADVISOR;
  if (n.includes('Locations') || n.includes('Menu') || n.includes('BusyTimes') || n.includes('VisualAssets')) return TIER_COLOR_DOMAIN;
  return TIER_COLOR_WORKER;
}

const STATUS_COLOR: Record<Status, string> = {
  idle: 'var(--color-text-muted)',
  planning: '#a78bfa',
  working: 'var(--color-status-active)',
  waiting: 'var(--color-status-permission)',
  thinking: '#a78bfa',
  communicating: '#06b6d4',
};

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Idle',
  planning: 'Planning',
  working: 'Working',
  waiting: 'Waiting for input',
  thinking: '⟳ Thinking...',
  communicating: '◎ Communicating',
};

const EFFORT_OPTS: Array<{ value: Effort; label: string; color: string }> = [
  { value: 'none',   label: 'Effort',  color: 'var(--color-border)' },
  { value: 'low',    label: 'Low',     color: '#a0a020' },
  { value: 'medium', label: 'Medium',  color: 'var(--color-status-success)' },
  { value: 'high',   label: 'High',    color: 'var(--color-status-active)' },
  { value: 'max',    label: 'Max',     color: 'var(--color-status-permission)' },
];
const EFFORT_CYCLE: Record<Effort, Effort> = {
  none: 'low', low: 'medium', medium: 'high', high: 'max', max: 'none',
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const EDGE_KIND_STYLE: Record<EdgeKind, { color: string; dash?: string; cls?: string; marker: string }> = {
  idle:        { color: 'var(--color-border)', dash: undefined, cls: undefined,               marker: 'url(#arrow)' },
  instructing: { color: '#f97316',             dash: '8 4',     cls: 'agent-edge-active',      marker: 'url(#arrow-instructing)' },
  active:      { color: '#3794ff',             dash: '6 3',     cls: 'agent-edge-active-slow', marker: 'url(#arrow-active-slow)' },
  waiting:     { color: '#a78bfa',             dash: '4 6',     cls: 'agent-edge-waiting',     marker: 'url(#arrow-waiting)' },
};

const DEFAULT_NODE_EXTRAS: NodeExtras = { effort: 'none', canSpawn: false, maxSpawn: 3, role: 'worker', enabled: true, planOverride: false };

function loadLS<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
  catch { return fallback; }
}

function autoPosition(index: number, role?: Role): { x: number; y: number } {
  const cols = 4;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const yBase = role === 'ceo' ? 80 : role === 'manager' ? 280 : 500;
  return {
    x: 80 + col * (NODE_W + 80),
    y: yBase + row * (NODE_H + 80),
  };
}

const TOOLS: Array<{ id: Tool; icon: string; label: string; key: string }> = [
  { id: 'hand', icon: '⊕', label: 'Pan', key: 'H' },
  { id: 'move', icon: '✥', label: 'Move', key: 'M' },
  { id: 'connect', icon: '→', label: 'Connect', key: 'C' },
  { id: 'cut', icon: '✂', label: 'Cut', key: 'X' },
];

// ── Geometry helpers ──────────────────────────────────────────

function topPort(n: AgentNode)    { return { x: n.x + NODE_W / 2, y: n.y }; }
function bottomPort(n: AgentNode) { return { x: n.x + NODE_W / 2, y: n.y + NODE_H }; }
function leftPort(n: AgentNode)   { return { x: n.x,               y: n.y + NODE_H / 2 }; }
function rightPort(n: AgentNode)  { return { x: n.x + NODE_W,      y: n.y + NODE_H / 2 }; }

function bestPorts(src: AgentNode, tgt: AgentNode) {
  const dx = (tgt.x + NODE_W / 2) - (src.x + NODE_W / 2);
  const dy = (tgt.y + NODE_H / 2) - (src.y + NODE_H / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { sp: rightPort(src), tp: leftPort(tgt) }
      : { sp: leftPort(src), tp: rightPort(tgt) };
  }
  return dy > 0
    ? { sp: bottomPort(src), tp: topPort(tgt) }
    : { sp: topPort(src), tp: bottomPort(tgt) };
}

function nearestPort(n: AgentNode, pos: { x: number; y: number }) {
  const candidates = [topPort(n), bottomPort(n), leftPort(n), rightPort(n)];
  return candidates.reduce((best, p) =>
    Math.hypot(p.x - pos.x, p.y - pos.y) < Math.hypot(best.x - pos.x, best.y - pos.y) ? p : best,
  );
}

function bezier(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  const dy = ty - sy;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const cp = Math.max(60, Math.abs(horizontal ? dx : dy) * 0.45);
  if (horizontal) {
    const s = Math.sign(dx);
    return `M ${sx} ${sy} C ${sx + s * cp} ${sy} ${tx - s * cp} ${ty} ${tx} ${ty}`;
  }
  const s = Math.sign(dy);
  return `M ${sx} ${sy} C ${sx} ${sy + s * cp} ${tx} ${ty - s * cp} ${tx} ${ty}`;
}

// ── Add Agent Modal ───────────────────────────────────────────

const AGENT_NAMES = [
  'Nova', 'Atlas', 'Sage', 'Echo', 'Pixel', 'Byte', 'Cipher', 'Nexus', 'Flux', 'Vega',
  'Titan', 'Lyra', 'Ada', 'Blaze', 'Storm', 'Aria', 'Rex', 'Kai', 'Zara', 'Orion',
  'Luna', 'Cosmo', 'Dash', 'Spark', 'Hawk', 'Reef', 'Ember', 'Quill', 'Wren', 'Scout',
];

const EFFORT_OPTIONS = [
  { value: 'low',    label: '🟡 Low',    color: '#a0a020' },
  { value: 'medium', label: '🟢 Medium', color: 'var(--color-status-success)' },
  { value: 'high',   label: '🔵 High',   color: 'var(--color-status-active)' },
  { value: 'max',    label: '🟠 Max',    color: 'var(--color-status-permission)' },
] as const;
const EFFORT_VALUES = EFFORT_OPTIONS.map(o => o.value);

export interface NodeConfig {
  name: string;
  task: string;
  role: Role;
  plan: boolean;
  effort: string;
  isCeo: boolean;
  bypassPermissions: boolean;
  headless: boolean;
  folderPath: string;
}

interface AddAgentModalProps {
  onConfirm: (cfg: NodeConfig) => void;
  onCancel: () => void;
  ceoExists?: boolean;
  workspaceFolders?: WorkspaceFolder[];
  externalFolderPath?: string;
}

function AddAgentModal({ onConfirm, onCancel, ceoExists, workspaceFolders = [], externalFolderPath }: AddAgentModalProps) {
  const [name, setName] = useState('');
  const [task, setTask] = useState('');
  const [role, setRole] = useState<Role>('worker');
  const [plan, setPlan] = useState(false);
  const [effort, setEffort] = useState('none');
  const [isCeo, setIsCeo] = useState(false);
  const [bypassPermissions, setBypassPermissions] = useState(true);
  const [headless, setHeadless] = useState(true);
  const [folderPath, setFolderPath] = useState(workspaceFolders[0]?.path ?? '');

  useEffect(() => {
    if (externalFolderPath) setFolderPath(externalFolderPath);
  }, [externalFolderPath]);

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--color-bg-dark)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)', fontSize: 18,
    fontFamily: 'FS Pixel Sans, monospace',
    padding: '6px 10px', outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 16, color: 'var(--color-text-muted)', marginBottom: 4, display: 'block',
  };

  const activeEffort = EFFORT_OPTIONS.find(o => o.value === effort);
  const cycleEffort = () => {
    if (effort === 'none') { setEffort('low'); return; }
    const idx = EFFORT_VALUES.indexOf(effort as typeof EFFORT_VALUES[number]);
    setEffort(idx === EFFORT_VALUES.length - 1 ? 'none' : EFFORT_VALUES[idx + 1]);
  };

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'var(--modal-overlay-bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 30,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="pixel-panel"
        style={{ width: 480, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--color-text)', marginBottom: 4 }}>
          New Agent
        </div>

        {/* Name */}
        <div>
          <label style={labelStyle}>Name</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              autoFocus value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Agent name (optional)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => setName(AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)])}
              title="Random name"
              style={{
                background: 'none', border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)', cursor: 'pointer',
                fontSize: 16, padding: '4px 8px', flexShrink: 0,
              }}
            >🎲</button>
          </div>
        </div>

        {/* Task */}
        <div>
          <label style={labelStyle}>Task / Instructions</label>
          <textarea
            value={task} onChange={e => setTask(e.target.value)}
            placeholder="What should this agent do?"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Role */}
        <div>
          <label style={labelStyle}>Role</label>
          <select
            value={role} onChange={e => setRole(e.target.value as Role)}
            style={{ ...inputStyle, color: ROLE_COLOR[role], cursor: 'pointer' }}
          >
            <option value="ceo">● CEO</option>
            <option value="manager">● Manager</option>
            <option value="worker">● Worker</option>
          </select>
        </div>

        {/* Mode */}
        <div>
          <label style={labelStyle}>Mode</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPlan(p => !p)} style={{
              flex: 1,
              background: plan ? 'var(--color-status-active)22' : 'transparent',
              border: `1px solid ${plan ? 'var(--color-status-active)' : 'var(--color-border)'}`,
              color: plan ? 'var(--color-status-active)' : 'var(--color-text-muted)',
              cursor: 'pointer', fontSize: 16, padding: '8px 0',
              fontFamily: 'FS Pixel Sans, monospace',
            }}>
              {plan ? '🔵 Plan' : 'Plan'}
            </button>
            <button onClick={cycleEffort} style={{
              flex: 1,
              background: effort !== 'none' ? `${activeEffort!.color}22` : 'transparent',
              border: `1px solid ${effort !== 'none' ? activeEffort!.color : 'var(--color-border)'}`,
              color: effort !== 'none' ? activeEffort!.color : 'var(--color-text-muted)',
              cursor: 'pointer', fontSize: 16, padding: '8px 0',
              fontFamily: 'FS Pixel Sans, monospace',
            }}>
              {effort !== 'none' ? activeEffort!.label : 'Effort'}
            </button>
          </div>
        </div>

        {/* Working Folder */}
        <div>
          <label style={labelStyle}>Working Folder</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={folderPath}
              onChange={e => setFolderPath(e.target.value)}
              placeholder={workspaceFolders[0]?.path ?? '/path/to/project'}
              style={{ ...inputStyle, flex: 1 }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={e => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) setFolderPath((file as File & { path?: string }).path ?? file.name);
              }}
            />
            <button
              onClick={() => vscode.postMessage({ type: 'browseFolder', agentId: -1 })}
              title="Browse for folder"
              style={{
                background: 'none', border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)', cursor: 'pointer',
                fontSize: 14, padding: '6px 12px', flexShrink: 0,
                fontFamily: 'FS Pixel Sans, monospace', whiteSpace: 'nowrap',
              }}
            >
              📁 Browse
            </button>
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', gap: 6 }}>
          {([
            { checked: bypassPermissions, set: setBypassPermissions, label: 'Skip permissions', disabled: false },
            { checked: headless, set: setHeadless, label: 'Headless (no terminal)', disabled: isCeo },
          ] as const).map(({ checked, set, label, disabled }) => (
            <label key={label} style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px',
              border: `1px solid ${checked && !disabled ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: checked && !disabled ? 'var(--color-accent)11' : 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1, fontSize: 13,
              color: checked && !disabled ? 'var(--color-accent)' : 'var(--color-text-muted)',
              fontFamily: 'FS Pixel Sans, monospace', userSelect: 'none',
            }}>
              <input
                type="checkbox" checked={disabled ? false : checked} disabled={disabled}
                onChange={() => !disabled && set((v: boolean) => !v)}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
              />
              {label}
            </label>
          ))}
        </div>

        {/* CEO */}
        <div
          onClick={() => { if (!ceoExists) setIsCeo(c => !c); }}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 12px',
            border: `1px solid ${isCeo ? 'var(--color-accent)' : 'var(--color-border)'}`,
            background: isCeo ? 'var(--color-accent)11' : 'transparent',
            cursor: ceoExists && !isCeo ? 'not-allowed' : 'pointer',
            opacity: ceoExists && !isCeo ? 0.5 : 1,
          }}
        >
          <input
            type="checkbox" checked={isCeo} disabled={ceoExists && !isCeo}
            onChange={() => { if (!ceoExists) setIsCeo(c => !c); }}
            onClick={e => e.stopPropagation()}
            style={{ marginTop: 3, flexShrink: 0, cursor: 'pointer' }}
          />
          <div>
            <div style={{ fontSize: 15, fontWeight: 'bold', color: isCeo ? 'var(--color-accent)' : 'var(--color-text)', fontFamily: 'FS Pixel Sans, monospace' }}>
              CEO Agent
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
              {ceoExists
                ? 'A CEO agent already exists — only one is allowed at a time.'
                : 'Always-on supervisor. Immune to restarts. Writes session log to CLAUDE.md if terminal closes, then auto-relaunches.'}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onCancel} style={{
            flex: 1, background: 'transparent',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', cursor: 'pointer',
            fontSize: 18, padding: '8px 0', fontFamily: 'FS Pixel Sans, monospace',
          }}>
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ name: name.trim() || 'New Agent', task, role, plan, effort, isCeo, bypassPermissions, headless: isCeo ? false : headless, folderPath })}
            style={{
              flex: 2, background: 'var(--color-accent)', border: 'none',
              color: 'var(--color-bg)', cursor: 'pointer',
              fontSize: 18, fontWeight: 'bold', padding: '8px 0',
              fontFamily: 'FS Pixel Sans, monospace',
            }}
          >
            Launch Agent
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Props interface ───────────────────────────────────────────

export interface AgentNetworkCanvasProps {
  onClose: () => void;
  agents: number[];
  agentNames: Record<number, string>;
  agentTasks: Record<number, string>;
  agentStatuses: Record<number, string>;
  agentTools: Record<number, ToolActivity[]>;
  agentModes: Record<number, string>;
  agentFolderNames: Record<number, string>;
  agentFolderPaths: Record<number, string>;
  agentMessages: Record<number, ExtChatMessage[]>;
  subagentCharacters: SubagentCharacter[];
  agentHomeZones: Record<number, string>;
  agentRoles?: Record<number, string>;
  hasCeoAgent: boolean;
  ceoAgentIds: Set<number>;
  workspaceFolders: WorkspaceFolder[];
  externalFolderPath?: string;
  onCreateAgent: (config: NodeConfig) => void;
  onCloseAgent: (id: number) => void;
  onSendMessage: (id: number, text: string) => void;
  onSetMeta: (id: number, updates: { name?: string; task?: string; mode?: string; homeZoneId?: string; role?: string; tasks?: Array<{ label: string; done: boolean }> }) => void;
  agentChecklist?: Record<number, Array<{ label: string; done: boolean }>>;
  agentLastMessageAt?: Record<number, number>;
  agentActiveIds?: Set<number>;
  agentHistory?: Record<number, AgentHistoryEntry[]>;
  agentCanSpawn?: Record<number, { canSpawn: boolean; maxSpawn: number }>;
  contained?: boolean;
}

// ── Main component ────────────────────────────────────────────

export function AgentNetworkCanvas({
  onClose,
  agents,
  agentNames,
  agentTasks,
  agentStatuses,
  agentTools,
  agentModes,
  agentFolderNames,
  agentFolderPaths,
  agentMessages,
  subagentCharacters,
  agentHomeZones,
  agentRoles = {},
  ceoAgentIds,
  workspaceFolders,
  externalFolderPath,
  onCreateAgent,
  onCloseAgent,
  onSendMessage,
  onSetMeta,
  agentLastMessageAt,
  agentActiveIds,
  agentHistory,
  agentChecklist,
  agentCanSpawn,
  contained = false,
}: AgentNetworkCanvasProps) {
  // ── localStorage-persisted canvas state ──
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() =>
    loadLS('pixel-agents-canvas-positions', {} as Record<string, { x: number; y: number }>));
  const [edges, setEdges] = useState<AgentEdge[]>(() =>
    loadLS('pixel-agents-canvas-edges', [] as AgentEdge[]));
  const [nodeExtras, setNodeExtras] = useState<Record<string, NodeExtras>>(() =>
    loadLS('pixel-agents-canvas-node-extras', {} as Record<string, NodeExtras>));

  const [tool, setTool] = useState<Tool>('move');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 80, y: 60 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connectPreview, setConnectPreview] = useState<{ x: number; y: number } | null>(null);
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [rosterSaved, setRosterSaved] = useState(false);
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [rosterData, setRosterData] = useState<{ name: string; task: string; role: string; plan: boolean; effort: string; isCeo: boolean; bypassPermissions: boolean; headless: boolean; folderPath: string; canSpawn: boolean }[] | null>(null);

  // ── Live simulation state ──
  const [messageParticles, setMessageParticles] = useState<Array<{ id: string; path: string; color: string; startMs: number }>>([]);
  const [edgeLastMessage, setEdgeLastMessage] = useState<Record<string, { text: string; shownAt: number }>>({});
  const [liveTick, setLiveTick] = useState(0);
  const [commTick, setCommTick] = useState(0);
  const prevMsgLengthsRef = useRef<Record<number, number>>({});
  const edgePathsRef = useRef<Array<{ id: string; sourceId: string; targetId: string; path: string; kind: EdgeKind; mid: { x: number; y: number } }>>([]);
  const turnStartMsRef = useRef<Record<string, number>>({});
  const prevActiveIdsRef = useRef<Set<number>>(new Set());
  // Listen for agentRosterLoaded from extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type?: string; roster?: { agents: typeof rosterData } };
      if (msg?.type === 'agentRosterLoaded') {
        setRosterData(msg.roster?.agents ?? null);
        setShowSpawnModal(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const saveRoster = useCallback(() => {
    const rosterAgents = agents.map(id => {
      const key = String(id);
      const extras = nodeExtras[key] ?? DEFAULT_NODE_EXTRAS;
      return {
        name: agentNames[id] ?? '',
        task: agentTasks[id] ?? '',
        role: extras.role,
        plan: extras.planOverride || agentModes[id] === 'planner',
        effort: extras.effort,
        isCeo: extras.role === 'ceo' || (agentNames[id]?.toLowerCase().includes('ceo') ?? false),
        bypassPermissions: false,
        headless: false,
        folderPath: agentFolderPaths[id] ?? '',
        canSpawn: extras.canSpawn,
      };
    });
    vscode.postMessage({
      type: 'saveAgentRoster',
      roster: { version: 1, savedAt: Date.now(), agents: rosterAgents },
    });
    setRosterSaved(true);
    setTimeout(() => setRosterSaved(false), 2000);
  }, [agents, agentNames, agentTasks, agentModes, agentFolderPaths, nodeExtras]);

  // ── Derive status/role from real agent state ──
  const deriveStatus = useCallback((id: number): Status => {
    void commTick; // force re-eval when communicating window expires
    if (agentStatuses[id] === 'waiting') return 'waiting';
    const lastMsgAt = agentLastMessageAt?.[id] ?? 0;
    if (lastMsgAt > 0 && Date.now() - lastMsgAt < 3000) return 'communicating';
    if ((agentTools[id]?.length ?? 0) > 0) return 'working';
    if (agentActiveIds?.has(id)) return 'thinking';
    if (nodeExtras[String(id)]?.planOverride) return 'planning';
    if (agentModes[id] === 'planner') return 'planning';
    return 'idle';
  }, [agentStatuses, agentTools, agentModes, nodeExtras, agentLastMessageAt, agentActiveIds, commTick]);

  const deriveRole = useCallback((id: number): Role => {
    if (agentRoles[id] === 'ceo' || ceoAgentIds.has(id)) return 'ceo';
    if (agentRoles[id] === 'manager') return 'manager';
    const extra = nodeExtras[String(id)];
    if (extra?.role && extra.role !== 'worker') return extra.role;
    if (subagentCharacters.some(sc => sc.parentAgentId === id)) return 'manager';
    if (agentNames[id]?.toLowerCase().includes('ceo')) return 'ceo';
    return 'worker';
  }, [agentRoles, nodeExtras, ceoAgentIds, subagentCharacters, agentNames]);

  // ── Build nodes from real agent data ──
  const nodes: AgentNode[] = agents.map((id, index) => {
    const key = String(id);
    const pos = positions[key] ?? autoPosition(index, deriveRole(id));
    const extras = nodeExtras[key] ?? DEFAULT_NODE_EXTRAS;
    const role = deriveRole(id);
    return {
      id: key,
      x: pos.x, y: pos.y,
      name: agentNames[id] ?? `Agent ${id}`,
      description: agentTasks[id] ?? agentFolderNames[id] ?? '',
      role,
      status: deriveStatus(id),
      planMode: extras.planOverride || agentModes[id] === 'planner',
      effort: extras.effort,
      canSpawn: role === 'ceo' ? true : (agentCanSpawn?.[id]?.canSpawn ?? extras.canSpawn),
      maxSpawn: role === 'ceo' ? 99 : (agentCanSpawn?.[id]?.maxSpawn ?? extras.maxSpawn ?? 3),
      activity: agentTools[id]?.[0]?.status ?? undefined,
      enabled: extras.enabled,
    };
  });

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes; // keep in sync synchronously

  const containedRef = useRef(contained);
  containedRef.current = contained;

  const fitAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodesRef.current.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const pad = 80;
    const minX = Math.min(...nodesRef.current.map(n => n.x));
    const maxX = Math.max(...nodesRef.current.map(n => n.x + NODE_W));
    const minY = Math.min(...nodesRef.current.map(n => n.y));
    const maxY = Math.max(...nodesRef.current.map(n => n.y + NODE_H));
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const newZoom = Math.min(rect.width / bw, rect.height / bh, containedRef.current ? 1.3 : 1.0);
    setZoom(newZoom);
    setPan({
      x: (rect.width  - (minX + maxX) * newZoom) / 2,
      y: (rect.height - (minY + maxY) * newZoom) / 2,
    });
  }, []);

  // Center on first agents load (only once); in contained mode, fit+zoom instead of just center
  const hasInitCentered = useRef(false);
  useEffect(() => {
    if (agents.length === 0 || hasInitCentered.current) return;
    hasInitCentered.current = true;
    const frame = requestAnimationFrame(() => {
      if (contained) {
        // Slight delay so the flex container has its final dimensions
        setTimeout(() => fitAll(), 150);
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const pts = agents.map((id, i) => positions[String(id)] ?? autoPosition(i));
      const minX = Math.min(...pts.map(p => p.x));
      const maxX = Math.max(...pts.map(p => p.x + NODE_W));
      const minY = Math.min(...pts.map(p => p.y));
      const maxY = Math.max(...pts.map(p => p.y + NODE_H));
      setPan({ x: rect.width / 2 - (minX + maxX) / 2, y: rect.height / 2 - (minY + maxY) / 2 });
    });
    return () => cancelAnimationFrame(frame);
  }, [agents, positions, contained, fitAll]);

  // Non-passive native wheel listener prevents browser back/forward on horizontal swipe
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toolRef = useRef(tool);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const dragRef = useRef<{ nodeId: string; startNX: number; startNY: number; startMX: number; startMY: number } | null>(null);
  const isPanningRef = useRef<{ startMX: number; startMY: number; startPX: number; startPY: number } | null>(null);
  const connectingRef = useRef<string | null>(null);
  const edgeRerouteRef = useRef<{ edgeId: string; end: 'source' | 'target' } | null>(null);

  const screenToCanvas = useCallback((cx: number, cy: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (cx - rect.left - panRef.current.x) / zoomRef.current,
      y: (cy - rect.top - panRef.current.y) / zoomRef.current,
    };
  }, []);

  const autoArrange = useCallback(() => {
    const allNodes = nodesRef.current;
    // Use a fixed logical center; fitAll() adjusts zoom/pan to show everything
    const CENTER_X = 800;
    const WORKER_GAP = NODE_W + 60;  // 300px between worker centers
    const ADVISOR_GAP = NODE_W + 140; // 380px — spread advisors wider than workers for visual clarity

    // Classify nodes into tiers
    const ceoNodes = allNodes.filter(n => n.role === 'ceo');

    // Advisor tier: named managers (Chief-of-Staff, Scrum-Master) OR role === 'manager'
    const advisorNodes = allNodes.filter(n =>
      n.role !== 'ceo' &&
      (n.role === 'manager' ||
        n.name.toLowerCase().includes('chief-of-staff') ||
        n.name.toLowerCase().includes('scrum-master') ||
        n.name.toLowerCase().includes('scrum master'))
    );

    // Domain nodes are specialized workers shown in their own bottom row
    const domainNodes = allNodes.filter(n =>
      n.name.includes('Locations') || n.name.includes('Menu') ||
      n.name.includes('BusyTimes') || n.name.includes('VisualAssets')
    );
    const domainIds   = new Set(domainNodes.map(n => n.id));
    const advisorIds  = new Set(advisorNodes.map(n => n.id));

    // Sub-managers: managers spawned by advisors (detected via edges)
    const edgeList = edgePathsRef.current;
    const mgrNodes = allNodes.filter(n =>
      n.role === 'manager' && !advisorIds.has(n.id) && !domainIds.has(n.id)
    );

    const workerNodes = allNodes.filter(n =>
      n.role === 'worker' && !domainIds.has(n.id)
    );

    const newPositions: Record<string, { x: number; y: number }> = {};

    // Tier Y positions: NODE_H (260) + 100px gap between tiers
    const TIER_GAP = 100;
    const T0 = 60;
    const T1 = T0 + NODE_H + TIER_GAP;
    const T2 = T1 + (advisorNodes.length > 0 ? NODE_H + TIER_GAP : 0);
    const T3 = (advisorNodes.length > 0 ? T2 : T1) + (mgrNodes.length > 0 ? NODE_H + TIER_GAP : 0);
    const T4 = T3 + NODE_H + TIER_GAP;

    // Tier 0 — CEO (centered)
    ceoNodes.forEach((n, i) => {
      const totalW = ceoNodes.length * WORKER_GAP - 60;
      newPositions[n.id] = { x: CENTER_X - totalW / 2 + i * WORKER_GAP, y: T0 };
    });

    // Tier 1 — Advisors (wider gap, centered)
    advisorNodes.forEach((n, i) => {
      const totalW = advisorNodes.length * ADVISOR_GAP - (ADVISOR_GAP - NODE_W);
      newPositions[n.id] = { x: CENTER_X - totalW / 2 + i * ADVISOR_GAP, y: T1 };
    });

    // Tier 2 — Sub-managers (if any)
    mgrNodes.forEach((n, i) => {
      const totalW = mgrNodes.length * WORKER_GAP - 60;
      newPositions[n.id] = { x: CENTER_X - totalW / 2 + i * WORKER_GAP, y: T2 };
    });

    // Tier 3 — Workers, grouped under their parent via edges, spread centered
    const managerWorkers: Record<string, string[]> = {};
    workerNodes.forEach(wn => {
      const parentEdge = edgeList.find(e =>
        e.targetId === wn.id &&
        (mgrNodes.some(m => m.id === e.sourceId) ||
          ceoNodes.some(c => c.id === e.sourceId) ||
          advisorNodes.some(a => a.id === e.sourceId))
      );
      const parentId = parentEdge?.sourceId ?? '__ungrouped__';
      if (!managerWorkers[parentId]) managerWorkers[parentId] = [];
      managerWorkers[parentId].push(wn.id);
    });

    const allParentIds = [
      ...ceoNodes.map(n => n.id),
      ...advisorNodes.map(n => n.id),
      ...mgrNodes.map(n => n.id),
      '__ungrouped__',
    ];

    let workerCursor = 0;
    const totalWorkers = workerNodes.length;
    const totalWorkerW = totalWorkers * WORKER_GAP - 60;
    const workerStartX = CENTER_X - totalWorkerW / 2;

    allParentIds.forEach(parentId => {
      (managerWorkers[parentId] ?? []).forEach(wId => {
        const wn = workerNodes.find(n => n.id === wId);
        if (!wn) return;
        newPositions[wId] = { x: workerStartX + workerCursor * WORKER_GAP, y: T3 };
        workerCursor++;
      });
    });

    // Domain row — centered below workers
    if (domainNodes.length > 0) {
      const totalDomainW = domainNodes.length * WORKER_GAP - 60;
      domainNodes.forEach((n, i) => {
        newPositions[n.id] = { x: CENTER_X - totalDomainW / 2 + i * WORKER_GAP, y: T4 };
      });
    }

    setPositions(prev => {
      const next = { ...prev, ...newPositions };
      localStorage.setItem('pixel-agents-canvas-positions', JSON.stringify(next));
      return next;
    });

    setTimeout(() => fitAll(), 100);
  }, [fitAll]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isPanningRef.current) {
        const { startMX, startMY, startPX, startPY } = isPanningRef.current;
        setPan({ x: startPX + e.clientX - startMX, y: startPY + e.clientY - startMY });
      }
      if (dragRef.current) {
        const { nodeId, startNX, startNY, startMX, startMY } = dragRef.current;
        const z = zoomRef.current;
        const nx = startNX + (e.clientX - startMX) / z;
        const ny = startNY + (e.clientY - startMY) / z;
        setPositions(p => {
          const next = { ...p, [nodeId]: { x: nx, y: ny } };
          localStorage.setItem('pixel-agents-canvas-positions', JSON.stringify(next));
          return next;
        });
      }
      if (connectingRef.current !== null) {
        const pos = screenToCanvas(e.clientX, e.clientY);
        setConnectPreview(pos);
        let nearest: string | null = null;
        const pad = 20;
        for (const node of nodesRef.current) {
          if (node.id === connectingRef.current) continue;
          if (pos.x >= node.x - pad && pos.x <= node.x + NODE_W + pad &&
              pos.y >= node.y - pad && pos.y <= node.y + NODE_H + pad) {
            nearest = node.id;
            break;
          }
        }
        setSnapTargetId(nearest);
      }
    };
    const onUp = () => {
      isPanningRef.current = null;
      dragRef.current = null;
      if (connectingRef.current !== null) {
        edgeRerouteRef.current = null;
        connectingRef.current = null;
        setConnectPreview(null);
        setSnapTargetId(null);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [screenToCanvas]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { if (showAddModal) setShowAddModal(false); else onClose(); }
      if (e.key === 'h' || e.key === 'H') setTool('hand');
      if (e.key === 'm' || e.key === 'M') setTool('move');
      if (e.key === 'c' || e.key === 'C') setTool('connect');
      if (e.key === 'x' || e.key === 'X') setTool('cut');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showAddModal]);

  // Auto-create/remove edges for subagent and homeZone (CEO→worker) relationships
  useEffect(() => {
    setEdges(prev => {
      const autoIds = new Set([
        ...subagentCharacters.map(sc => `auto-${sc.parentAgentId}-${sc.id}`),
        ...agents.filter(id => agentHomeZones[id]).map(id => `zone-${agentHomeZones[id]}-${id}`),
      ]);
      const cleaned = prev.filter(e =>
        (!e.id.startsWith('auto-') && !e.id.startsWith('zone-')) || autoIds.has(e.id)
      );
      const existing = new Set(cleaned.map(e => e.id));
      const fromSubagents = subagentCharacters
        .filter(sc => !existing.has(`auto-${sc.parentAgentId}-${sc.id}`))
        .map(sc => ({ id: `auto-${sc.parentAgentId}-${sc.id}`, sourceId: String(sc.parentAgentId), targetId: String(sc.id) }));
      const fromZones = agents
        .filter(id => agentHomeZones[id] && !existing.has(`zone-${agentHomeZones[id]}-${id}`))
        .map(id => ({ id: `zone-${agentHomeZones[id]}-${id}`, sourceId: agentHomeZones[id], targetId: String(id) }));
      const next = [...cleaned, ...fromSubagents, ...fromZones];
      localStorage.setItem('pixel-agents-canvas-edges', JSON.stringify(next));
      return next;
    });
  }, [subagentCharacters, agentHomeZones, agents]);

  // Purge edges and positions when agents are removed
  useEffect(() => {
    const agentKeys = new Set(agents.map(String));
    setEdges(prev => {
      const next = prev.filter(e => agentKeys.has(e.sourceId) && agentKeys.has(e.targetId));
      if (next.length !== prev.length) localStorage.setItem('pixel-agents-canvas-edges', JSON.stringify(next));
      return next;
    });
    setPositions(prev => {
      const keys = Object.keys(prev);
      const stale = keys.filter(k => !agentKeys.has(k));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach(k => delete next[k]);
      localStorage.setItem('pixel-agents-canvas-positions', JSON.stringify(next));
      return next;
    });
    setNodeExtras(prev => {
      const keys = Object.keys(prev);
      const stale = keys.filter(k => !agentKeys.has(k));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach(k => delete next[k]);
      localStorage.setItem('pixel-agents-canvas-node-extras', JSON.stringify(next));
      return next;
    });
  }, [agents]);

  // ── Live tick interval (1s, drives elapsed timers + edge label fade) ──
  useEffect(() => {
    const id = setInterval(() => setLiveTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── commTick: re-evaluate communicating status when 3s window expires ──
  useEffect(() => {
    const times = Object.values(agentLastMessageAt ?? {});
    const upcoming = times.map(t => t + 3000).filter(t => t > Date.now());
    if (!upcoming.length) return;
    const delay = Math.min(...upcoming) - Date.now() + 50;
    const id = setTimeout(() => setCommTick(t => t + 1), delay);
    return () => clearTimeout(id);
  }, [agentLastMessageAt, commTick]);

  // ── Track turn start times for live elapsed timer ──
  useEffect(() => {
    const current = agentActiveIds ?? new Set<number>();
    for (const id of current) {
      if (!prevActiveIdsRef.current.has(id)) {
        turnStartMsRef.current[String(id)] = Date.now();
      }
    }
    for (const idStr of Object.keys(turnStartMsRef.current)) {
      const id = Number(idStr);
      if (!current.has(id)) {
        delete turnStartMsRef.current[idStr];
      }
    }
    prevActiveIdsRef.current = new Set(current);
  }, [agentActiveIds]);

  // ── Particles + edge message previews on new messages ──
  useEffect(() => {
    const now = Date.now();
    const newParticles: typeof messageParticles = [];
    const edgeUpdates: Record<string, { text: string; shownAt: number }> = {};

    for (const id of agents) {
      const idStr = String(id);
      const msgs = agentMessages[id];
      const currentLen = msgs?.length ?? 0;
      const prevLen = prevMsgLengthsRef.current[id] ?? 0;
      if (currentLen > prevLen && msgs) {
        const lastMsg = msgs[currentLen - 1];
        const previewText = lastMsg.text.slice(0, 60) + (lastMsg.text.length > 60 ? '…' : '');
        const touching = edgePathsRef.current.filter(
          e => e.sourceId === idStr || e.targetId === idStr
        );
        for (const edge of touching) {
          const color = EDGE_KIND_STYLE[edge.kind]?.color ?? '#3794ff';
          newParticles.push({ id: `p-${idStr}-${edge.id}-${now}`, path: edge.path, color, startMs: now });
          edgeUpdates[edge.id] = { text: previewText, shownAt: now };
        }
      }
      prevMsgLengthsRef.current[id] = currentLen;
    }

    if (newParticles.length > 0) {
      setMessageParticles(prev => [
        ...prev.filter(p => now - p.startMs < 1200),
        ...newParticles,
      ]);
      const timer = setTimeout(() => {
        setMessageParticles(prev => prev.filter(p => Date.now() - p.startMs < 1200));
      }, 1250);
      return () => clearTimeout(timer);
    }
    if (Object.keys(edgeUpdates).length > 0) {
      setEdgeLastMessage(prev => ({ ...prev, ...edgeUpdates }));
    }
  }, [agentMessages, agents]);

  // ── Edge label fade cleanup ──
  useEffect(() => {
    const hasActive = Object.values(edgeLastMessage).some(e => Date.now() - e.shownAt < 5000);
    if (!hasActive) return;
    const id = setInterval(() => {
      if (Object.values(edgeLastMessage).every(e => Date.now() - e.shownAt >= 5000)) {
        setEdgeLastMessage({});
      } else {
        setLiveTick(t => t + 1);
      }
    }, 200);
    return () => clearInterval(id);
  }, [edgeLastMessage]);

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && toolRef.current === 'hand')) {
      e.preventDefault();
      isPanningRef.current = { startMX: e.clientX, startMY: e.clientY, startPX: pan.x, startPY: pan.y };
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Use refs for current values — avoids stale closure mismatch
      const z = zoomRef.current;
      const p = panRef.current;
      const nz = Math.max(0.25, Math.min(4, z * factor));
      setZoom(nz);
      setPan({
        x: mx - (mx - p.x) * (nz / z),
        y: my - (my - p.y) * (nz / z),
      });
    } else {
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (toolRef.current === 'connect') {
      connectingRef.current = nodeId;
      setConnectPreview(screenToCanvas(e.clientX, e.clientY));
      return;
    }
    if (toolRef.current !== 'move') return;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    dragRef.current = { nodeId, startNX: node.x, startNY: node.y, startMX: e.clientX, startMY: e.clientY };
  };

  const finishConnection = (nodeId: string) => {
    if (connectingRef.current === null) return;
    const reroute = edgeRerouteRef.current;
    if (reroute) {
      // Re-route an existing edge endpoint to a new node
      if (nodeId !== connectingRef.current) {
        setEdges(es => {
          const next = es.map(ed => {
            if (ed.id !== reroute.edgeId) return ed;
            return reroute.end === 'source'
              ? { ...ed, sourceId: nodeId }
              : { ...ed, targetId: nodeId };
          });
          localStorage.setItem('pixel-agents-canvas-edges', JSON.stringify(next));
          return next;
        });
      }
      edgeRerouteRef.current = null;
    } else {
      // Create new edge
      const srcId = connectingRef.current;
      if (srcId !== nodeId && !edges.some(ed =>
        (ed.sourceId === srcId && ed.targetId === nodeId) ||
        (ed.sourceId === nodeId && ed.targetId === srcId),
      )) {
        setEdges(es => {
          const next = [...es, { id: `e-${Date.now()}`, sourceId: srcId, targetId: nodeId }];
          localStorage.setItem('pixel-agents-canvas-edges', JSON.stringify(next));
          return next;
        });
        // Set homeZoneId on the target agent so the reporting relationship persists on the backend
        const targetNumId = parseInt(nodeId, 10);
        if (!isNaN(targetNumId)) onSetMeta(targetNumId, { homeZoneId: srcId });
      }
    }
    connectingRef.current = null;
    setConnectPreview(null);
    setSnapTargetId(null);
  };

  const handleNodeMouseUp = (e: React.MouseEvent, nodeId: string) => {
    if (connectingRef.current === null) return;
    e.stopPropagation();
    finishConnection(nodeId);
  };

  const handlePortMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    connectingRef.current = nodeId;
    setConnectPreview(screenToCanvas(e.clientX, e.clientY));
  };

  const handlePortMouseUp = (e: React.MouseEvent, nodeId: string) => {
    if (connectingRef.current === null) return;
    e.stopPropagation();
    finishConnection(nodeId);
  };

  const handleEdgeEndpointDown = (e: React.MouseEvent, edgeId: string, end: 'source' | 'target') => {
    e.stopPropagation();
    const edge = edges.find(ed => ed.id === edgeId);
    if (!edge) return;
    edgeRerouteRef.current = { edgeId, end };
    // Fixed end becomes the "source" of the preview connection
    connectingRef.current = end === 'source' ? edge.targetId : edge.sourceId;
    setConnectPreview(screenToCanvas(e.clientX, e.clientY));
  };

  const addNode = (cfg: NodeConfig) => {
    onCreateAgent(cfg);
    setShowAddModal(false);
    // The new agent will appear in the canvas when agentCreated fires and agents prop updates.
    // Pre-seed extras so it gets the right effort/role when it arrives.
    // We don't know the ID yet — it comes from the extension after creation.
  };

  const addHelper = (_parentId: string) => {
    setShowAddModal(true);
  };

  const sendMessage = (nodeId: string, text: string) => {
    if (!text.trim()) return;
    onSendMessage(Number(nodeId), text.trim());
    setChatInput('');
  };

  const deleteNode = useCallback((nodeId: string) => {
    onCloseAgent(Number(nodeId));
    setPositions(p => { const n = { ...p }; delete n[nodeId]; localStorage.setItem('pixel-agents-canvas-positions', JSON.stringify(n)); return n; });
    setNodeExtras(n => { const c = { ...n }; delete c[nodeId]; localStorage.setItem('pixel-agents-canvas-node-extras', JSON.stringify(c)); return c; });
  }, [onCloseAgent]);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges(es => {
      const next = es.filter(e => e.id !== edgeId);
      localStorage.setItem('pixel-agents-canvas-edges', JSON.stringify(next));
      return next;
    });
  }, []);

  const updateNodeExtras = useCallback((nodeId: string, updates: Partial<NodeExtras>) => {
    setNodeExtras(prev => {
      const current = prev[nodeId] ?? DEFAULT_NODE_EXTRAS;
      const next = { ...prev, [nodeId]: { ...current, ...updates } };
      localStorage.setItem('pixel-agents-canvas-node-extras', JSON.stringify(next));
      return next;
    });
  }, []);

  const updateNode = useCallback((nodeId: string, updates: Partial<AgentNode>) => {
    const numId = Number(nodeId);
    if (updates.name !== undefined) onSetMeta(numId, { name: updates.name });
    if (updates.description !== undefined) onSetMeta(numId, { task: updates.description });
    if (updates.planMode !== undefined) onSetMeta(numId, { mode: updates.planMode ? 'planner' : 'default' });
    const extras: Partial<NodeExtras> = {};
    if (updates.effort !== undefined) extras.effort = updates.effort;
    if (updates.canSpawn !== undefined) extras.canSpawn = updates.canSpawn;
    if (updates.maxSpawn !== undefined) extras.maxSpawn = updates.maxSpawn;
    if (updates.role !== undefined) extras.role = updates.role;
    if (updates.enabled !== undefined) extras.enabled = updates.enabled;
    if (updates.planMode !== undefined) extras.planOverride = updates.planMode;
    if (Object.keys(extras).length > 0) updateNodeExtras(nodeId, extras);
  }, [onSetMeta, updateNodeExtras]);

  // Adapter: convert extension ChatMessage (role/text/ts) → local ChatMessage (id/from/text/ts)
  const messagesForNode = (nodeId: string): ChatMessage[] =>
    (agentMessages[Number(nodeId)] ?? []).map((m, i) => ({
      id: `${nodeId}-${i}-${m.ts}`,
      from: (m.role === 'user' ? 'user' : 'agent') as 'user' | 'agent',
      text: m.text,
      ts: m.ts,
    }));

  // Edge communication kind — drives color/animation
  const getEdgeKind = (edge: AgentEdge): EdgeKind => {
    const srcId = Number(edge.sourceId);
    const tgtId = Number(edge.targetId);
    const srcActive = (agentTools[srcId]?.length ?? 0) > 0;
    const tgtActive = (agentTools[tgtId]?.length ?? 0) > 0;
    if (srcActive && tgtActive) return 'active';
    if (subagentCharacters.some(sc => sc.parentAgentId === srcId && sc.id === tgtId)) return 'instructing';
    if (agentStatuses[tgtId] === 'waiting') return 'waiting';
    if (srcActive || tgtActive) return 'active';
    return 'idle';
  };

  const edgePaths = edges.map(edge => {
    const src = nodes.find(n => n.id === edge.sourceId);
    const tgt = nodes.find(n => n.id === edge.targetId);
    if (!src || !tgt) return null;
    const { sp, tp } = bestPorts(src, tgt);
    const kind = getEdgeKind(edge);
    return { ...edge, sp, tp, path: bezier(sp.x, sp.y, tp.x, tp.y), mid: { x: (sp.x + tp.x) / 2, y: (sp.y + tp.y) / 2 }, kind };
  }).filter((e): e is NonNullable<typeof e> => e !== null);
  edgePathsRef.current = edgePaths; // keep in sync for particle/preview effects

  // Snap preview path to target port when close enough
  let previewPath: string | null = null;
  if (connectingRef.current && connectPreview) {
    const src = nodes.find(n => n.id === connectingRef.current);
    if (src) {
      const snapNode = snapTargetId ? nodes.find(n => n.id === snapTargetId) : null;
      const target = snapNode ? nearestPort(snapNode, nearestPort(src, connectPreview)) : connectPreview;
      const sp = nearestPort(src, target);
      previewPath = bezier(sp.x, sp.y, target.x, target.y);
    }
  }

  const workingCount = nodes.filter(n => n.status === 'working').length;
  const waitingCount = nodes.filter(n => n.status === 'waiting').length;

  const toolCursor: Record<Tool, string> = {
    hand: 'grab', move: 'default', connect: 'crosshair', cut: 'default',
  };

  return (
    <div style={{
      ...(contained
        ? { position: 'relative', width: '100%', height: '100%', zIndex: 0 }
        : { position: 'fixed', inset: 0, zIndex: 200 }
      ),
      background: 'var(--color-bg)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'FS Pixel Sans, monospace',
    }}>
      {/* ── Top bar ── */}
      <div style={{
        height: 68, display: 'flex', alignItems: 'center',
        padding: '0 20px', gap: 16,
        borderBottom: '2px solid var(--color-border)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 26, fontWeight: 'bold', color: 'var(--color-text)' }}>
          ⬡ Agent Network
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{
            fontSize: 14, padding: '3px 12px',
            background: 'rgba(55,148,255,0.12)',
            color: 'var(--color-status-active)',
            border: '1px solid var(--color-status-active)',
          }}>
            ● {workingCount} working
          </span>
          {waitingCount > 0 && (
            <span style={{
              fontSize: 14, padding: '3px 12px',
              background: 'rgba(204,167,0,0.12)',
              color: 'var(--color-status-permission)',
              border: '1px solid var(--color-status-permission)',
            }}>
              ● {waitingCount} waiting
            </span>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAddModal(true)} style={{
          background: 'var(--color-accent)', border: 'none',
          color: '#fff', cursor: 'pointer', fontSize: 18,
          fontFamily: 'FS Pixel Sans, monospace', fontWeight: 'bold', padding: '10px 22px',
        }}>
          + Add Agent
        </button>
        {agents.length > 0 && (
          <button
            onClick={saveRoster}
            title="Save current agents as a reusable roster to ~/.pixel-agents/roster.json"
            style={{
              background: rosterSaved ? 'var(--color-status-success)22' : 'transparent',
              border: `2px solid ${rosterSaved ? 'var(--color-status-success)' : 'var(--color-border)'}`,
              color: rosterSaved ? 'var(--color-status-success)' : 'var(--color-text-muted)',
              cursor: 'pointer', fontSize: 16,
              fontFamily: 'FS Pixel Sans, monospace', padding: '8px 16px',
              transition: 'all 0.2s',
            }}
          >
            {rosterSaved ? '✓ Saved' : '💾 Save Roster'}
          </button>
        )}
        <button
          onClick={() => vscode.postMessage({ type: 'loadAgentRoster' })}
          title="Spawn agents from saved roster"
          style={{
            background: 'transparent',
            border: '2px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer', fontSize: 16,
            fontFamily: 'FS Pixel Sans, monospace', padding: '8px 16px',
          }}
        >
          ⟳ Spawn Roster
        </button>
        {ceoAgentIds.size === 0 && (
          <button
            onClick={() => onCreateAgent({ name: 'CEO', task: '', role: 'ceo', plan: false, effort: 'none', isCeo: true, bypassPermissions: true, headless: false, folderPath: workspaceFolders[0]?.path ?? '' })}
            title="Spawn CEO agent"
            style={{
              background: `${ROLE_COLOR.ceo}22`,
              border: `2px solid ${ROLE_COLOR.ceo}`,
              color: ROLE_COLOR.ceo,
              cursor: 'pointer', fontSize: 16,
              fontFamily: 'FS Pixel Sans, monospace', padding: '8px 16px',
              fontWeight: 'bold',
            }}
          >
            ⭐ Spawn CEO
          </button>
        )}
        <button onClick={onClose} style={{
          background: 'transparent', border: '2px solid var(--color-border)',
          color: 'var(--color-text-muted)', cursor: 'pointer',
          fontSize: 18, fontFamily: 'FS Pixel Sans, monospace', padding: '10px 18px',
        }}>
          ✕ Close
        </button>
      </div>

      {/* ── Project progress bar ── */}
      <div style={{ height: 8, display: 'flex', flexShrink: 0, background: 'var(--color-bg-dark)' }}>
        {nodes.map(n => (
          <div key={n.id} style={{
            flex: 1,
            background: n.status === 'working' ? 'var(--color-status-active)'
              : n.status === 'waiting' ? 'var(--color-status-permission)'
              : 'transparent',
            borderRight: '1px solid var(--color-bg)',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>

      {/* ── Phase gate approval banner ── */}
      {(() => {
        try {
          const gateJson = localStorage.getItem('pixel-agents-phase-gate');
          if (!gateJson) return null;
          const gate = JSON.parse(gateJson) as { phase: number; summary: string; timestamp: number };
          const ageMins = (Date.now() - gate.timestamp) / 60000;
          if (ageMins > 120) return null;
          return (
            <div style={{
              background: 'rgba(248,113,22,0.1)',
              border: '1px solid #f97316',
              borderLeft: '4px solid #f97316',
              padding: '10px 20px',
              display: 'flex', alignItems: 'center', gap: 16,
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 16 }}>🔔</span>
              <div style={{ flex: 1 }}>
                <span style={{ color: '#f97316', fontWeight: 'bold', fontSize: 14 }}>
                  Phase {gate.phase} Gate — Awaiting CEO Approval
                </span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12, marginLeft: 12 }}>
                  {gate.summary}
                </span>
              </div>
              <button
                onClick={() => {
                  localStorage.setItem('pixel-agents-phase-gate-decision', JSON.stringify({ decision: 'approved', phase: gate.phase, ts: Date.now() }));
                  localStorage.removeItem('pixel-agents-phase-gate');
                }}
                style={{
                  background: '#22c55e22', border: '2px solid #22c55e',
                  color: '#22c55e', cursor: 'pointer', fontSize: 13,
                  fontFamily: 'FS Pixel Sans, monospace', padding: '6px 16px', fontWeight: 'bold',
                }}
              >
                ✓ APPROVED
              </button>
              <button
                onClick={() => {
                  const reason = prompt('Revision needed — describe what to change:');
                  if (reason) {
                    localStorage.setItem('pixel-agents-phase-gate-decision', JSON.stringify({ decision: 'revise', reason, phase: gate.phase, ts: Date.now() }));
                    localStorage.removeItem('pixel-agents-phase-gate');
                  }
                }}
                style={{
                  background: '#f9731622', border: '2px solid #f97316',
                  color: '#f97316', cursor: 'pointer', fontSize: 13,
                  fontFamily: 'FS Pixel Sans, monospace', padding: '6px 16px', fontWeight: 'bold',
                }}
              >
                ↩ REVISE
              </button>
              <button
                onClick={() => localStorage.removeItem('pixel-agents-phase-gate')}
                style={{
                  background: 'transparent', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12,
                  fontFamily: 'FS Pixel Sans, monospace', padding: '6px 10px',
                }}
              >
                ✕
              </button>
            </div>
          );
        } catch { return null; }
      })()}

      {/* ── Canvas area ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        <div
          ref={canvasRef}
          style={{
            position: 'absolute', inset: 0,
            cursor: toolCursor[tool],
            backgroundImage: 'radial-gradient(circle, var(--color-border) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onContextMenu={e => e.preventDefault()}
        >
          {agents.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 12, pointerEvents: 'none',
            }}>
              <span style={{ fontSize: 44, opacity: 0.15 }}>⬡</span>
              <span style={{ fontSize: 16, color: 'var(--color-text-muted)' }}>
                No agents running. Click <strong style={{ color: 'var(--color-text)' }}>+ Add Agent</strong> to launch one.
              </span>
            </div>
          )}

          <div style={{
            position: 'absolute', inset: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}>
            {/* Phase flow panel — lives inside the canvas world, pans/zooms with content */}
            <PhaseFlowPanel zoom={zoom} />

            {/* SVG edges */}
            <svg style={{
              position: 'absolute', left: 0, top: 0,
              width: 4000, height: 4000, overflow: 'visible', pointerEvents: 'none',
            }}>
              <defs>
                <marker id="arrow" markerWidth="14" markerHeight="10" refX="14" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 0 L 14 5 L 0 10 Z" fill="var(--color-border)" />
                </marker>
                <marker id="arrow-instructing" markerWidth="14" markerHeight="10" refX="14" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 0 L 14 5 L 0 10 Z" fill="#f97316" />
                </marker>
                <marker id="arrow-active-slow" markerWidth="14" markerHeight="10" refX="14" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 0 L 14 5 L 0 10 Z" fill="#3794ff" />
                </marker>
                <marker id="arrow-waiting" markerWidth="14" markerHeight="10" refX="14" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 0 L 14 5 L 0 10 Z" fill="#a78bfa" />
                </marker>
                <marker id="arrow-snap" markerWidth="14" markerHeight="10" refX="14" refY="5" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 0 L 14 5 L 0 10 Z" fill="var(--color-accent)" />
                </marker>
              </defs>

              {edgePaths.map(edge => {
                const ks = EDGE_KIND_STYLE[edge.kind];
                const kindLabel: Record<string, string> = {
                  instructing: '▶', active: '⇆', waiting: '⏳',
                };
                const isSelected = selectedEdgeId === edge.id;
                const isAuto = edge.id.startsWith('auto-') || edge.id.startsWith('zone-');
                return (
                <g key={edge.id}>
                  <path
                    d={edge.path}
                    stroke={ks.color}
                    strokeWidth={edge.kind === 'idle' ? 2 : 2.5} fill="none"
                    strokeDasharray={ks.dash}
                    className={ks.cls}
                    markerEnd={ks.marker}
                  />
                  {/* Draggable endpoint dots (user-drawn edges only) */}
                  {!isAuto && (
                    <>
                      <circle cx={edge.sp.x} cy={edge.sp.y} r={5}
                        fill="var(--color-bg)" stroke={ks.color} strokeWidth={2}
                        style={{ pointerEvents: 'all', cursor: 'grab' }}
                        onMouseDown={e => handleEdgeEndpointDown(e, edge.id, 'source')} />
                      <circle cx={edge.tp.x} cy={edge.tp.y} r={5}
                        fill={ks.color} stroke="var(--color-bg)" strokeWidth={1.5}
                        style={{ pointerEvents: 'all', cursor: 'grab' }}
                        onMouseDown={e => handleEdgeEndpointDown(e, edge.id, 'target')} />
                    </>
                  )}
                  {tool === 'cut' && (
                    <path d={edge.path} stroke="transparent" strokeWidth={20} fill="none"
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onClick={() => deleteEdge(edge.id)} />
                  )}
                  {tool !== 'cut' && (
                    <g transform={`translate(${edge.mid.x}, ${edge.mid.y})`}
                      style={{ pointerEvents: 'all', cursor: 'pointer' }}
                      onClick={() => setSelectedEdgeId(id => id === edge.id ? null : edge.id)}>
                      <circle r={11} fill={isSelected ? ks.color : 'var(--color-bg)'}
                        stroke={ks.color} strokeWidth={1.5} opacity={0.9} />
                      <text x={0} y={5} textAnchor="middle" fontSize={12}
                        fill={isSelected ? '#fff' : ks.color}
                        fontFamily="FS Pixel Sans, monospace"
                        style={{ userSelect: 'none' }}>
                        {kindLabel[edge.kind] ?? '·'}
                      </text>
                    </g>
                  )}
                  {/* Edge kind label — shown when not idle */}
                  {edge.kind !== 'idle' && tool !== 'cut' && (
                    <text
                      x={edge.mid.x} y={edge.mid.y - 18}
                      textAnchor="middle" fontSize={10}
                      fill={ks.color} fontFamily="FS Pixel Sans, monospace"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                      opacity={0.8}>
                      {edge.kind}
                    </text>
                  )}
                  {/* Message preview floating label */}
                  {(() => {
                    const preview = edgeLastMessage[edge.id];
                    if (!preview) return null;
                    const age = (Date.now() - preview.shownAt) / 1000;
                    if (age > 5) return null;
                    const opacity = age > 3.5 ? 1 - (age - 3.5) / 1.5 : 1;
                    return (
                      <g transform={`translate(${edge.mid.x}, ${edge.mid.y - 34})`}
                         style={{ pointerEvents: 'none' }}>
                        <rect x={-80} y={-12} width={160} height={20}
                          fill="var(--color-bg)" stroke={ks.color}
                          strokeWidth={1} rx={3} opacity={opacity * 0.95} />
                        <text x={0} y={3} textAnchor="middle" fontSize={9}
                          fill="var(--color-text)" fontFamily="FS Pixel Sans, monospace"
                          style={{ userSelect: 'none' }} opacity={opacity}>
                          {preview.text}
                        </text>
                      </g>
                    );
                  })()}
                </g>
                );
              })}

              {previewPath && (
                <path d={previewPath}
                  stroke={snapTargetId ? 'var(--color-accent)' : 'var(--color-accent)'}
                  strokeWidth={snapTargetId ? 3 : 2}
                  strokeDasharray={snapTargetId ? undefined : '6 3'}
                  fill="none" opacity={0.85}
                  markerEnd={snapTargetId ? 'url(#arrow-snap)' : undefined}
                />
              )}

              {/* Message flow particles */}
              {messageParticles.map(p => (
                <circle key={p.id} r={5} fill={p.color} opacity={0.85}>
                  <animateMotion path={p.path} dur="1.2s" begin="0s" fill="freeze"
                    calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.6 1" />
                  <animate attributeName="opacity"
                    values="0;0.9;0.9;0" keyTimes="0;0.1;0.7;1" dur="1.2s" fill="freeze" />
                </circle>
              ))}
            </svg>

            {/* CEO zone highlight */}
            {nodes.filter(n => n.role === 'ceo').map(n => (
              <div key={`ceo-zone-${n.id}`} style={{
                position: 'absolute',
                left: n.x - 20, top: n.y - 20,
                width: NODE_W + 40, height: NODE_H + 40,
                border: `2px dashed ${ROLE_COLOR.ceo}`,
                borderRadius: 6,
                background: `${ROLE_COLOR.ceo}08`,
                pointerEvents: 'none',
              }} />
            ))}

            {nodes.map(node => (
              <NodeCard
                key={node.id}
                node={node}
                tool={tool}
                isEditing={editingId === node.id}
                isSnapTarget={snapTargetId === node.id}
                isSelected={selectedNodeId === node.id}
                onMouseDown={e => handleNodeMouseDown(e, node.id)}
                onMouseUp={e => handleNodeMouseUp(e, node.id)}
                onPortDown={e => handlePortMouseDown(e, node.id)}
                onPortUp={e => handlePortMouseUp(e, node.id)}
                onDoubleClick={() => setEditingId(node.id)}
                onBlur={() => setEditingId(null)}
                onDelete={() => deleteNode(node.id)}
                onAddHelper={() => addHelper(node.id)}
                onSelect={() => setSelectedNodeId(id => id === node.id ? null : node.id)}
                onChange={updates => updateNode(node.id, updates)}
                onRelaunch={node.role === 'ceo' ? () => {
                  onCreateAgent({
                    name: node.name,
                    task: node.description,
                    role: 'ceo',
                    plan: node.planMode,
                    effort: node.effort,
                    isCeo: true,
                    bypassPermissions: true,
                    headless: false,
                    folderPath: agentFolderPaths[Number(node.id)] ?? workspaceFolders[0]?.path ?? '',
                  });
                  onClose();
                } : undefined}
                elapsedMs={(() => {
                  void liveTick; // re-render every second
                  const start = turnStartMsRef.current[node.id];
                  return start !== undefined ? Date.now() - start : undefined;
                })()}
                tokenCount={(() => {
                  const history = agentHistory?.[Number(node.id)];
                  if (!history) return null;
                  const last = history.find(e => e.type === 'waiting' && (e.inputTokens ?? 0) > 0);
                  return last ? { input: last.inputTokens ?? 0, output: last.outputTokens ?? 0 } : null;
                })()}
                tasks={agentChecklist?.[Number(node.id)]}
                onToggleTask={(taskIndex) => {
                  const current = agentChecklist?.[Number(node.id)] ?? [];
                  const updated = current.map((t, i) => i === taskIndex ? { ...t, done: !t.done } : t);
                  onSetMeta(Number(node.id), { tasks: updated });
                }}
              />
            ))}
          </div>
        </div>

        {/* Spawn Roster Modal */}
        {showSpawnModal && (
          <div
            style={{ position: 'absolute', inset: 0, background: 'var(--modal-overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}
            onMouseDown={e => { if (e.target === e.currentTarget) setShowSpawnModal(false); }}
          >
            <div className="pixel-panel" style={{ width: 480, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '80vh', overflowY: 'auto' }} onMouseDown={e => e.stopPropagation()}>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--color-text)' }}>⟳ Spawn Roster</div>
              {!rosterData || rosterData.length === 0 ? (
                <div style={{ fontSize: 16, color: 'var(--color-text-muted)', padding: '20px 0', textAlign: 'center' }}>
                  No saved roster found. Use <strong style={{ color: 'var(--color-text)' }}>💾 Save Roster</strong> first.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>{rosterData.length} agent{rosterData.length !== 1 ? 's' : ''} saved</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rosterData.map((a, i) => (
                      <div key={i} style={{ padding: '10px 14px', border: '1px solid var(--color-border)', background: 'var(--color-bg-dark)', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: ROLE_COLOR[a.role as Role] ?? 'var(--color-border)', flexShrink: 0, display: 'inline-block' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || '(unnamed)'}</div>
                          {a.task && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.task}</div>}
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>{a.role}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button onClick={() => setShowSpawnModal(false)} style={{ flex: 1, background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 18, padding: '8px 0', fontFamily: 'FS Pixel Sans, monospace' }}>Cancel</button>
                    <button
                      onClick={() => {
                        rosterData.forEach(a => onCreateAgent({ name: a.name, task: a.task, role: (a.role as Role) || 'worker', plan: a.plan, effort: a.effort, isCeo: a.isCeo, bypassPermissions: a.bypassPermissions, headless: a.headless, folderPath: a.folderPath }));
                        setShowSpawnModal(false);
                      }}
                      style={{ flex: 2, background: 'var(--color-accent)', border: 'none', color: 'var(--color-bg)', cursor: 'pointer', fontSize: 18, fontWeight: 'bold', padding: '8px 0', fontFamily: 'FS Pixel Sans, monospace' }}
                    >
                      Launch All {rosterData.length} Agents
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Add Agent Modal */}
        {showAddModal && (
          <AddAgentModal
            onConfirm={addNode}
            onCancel={() => setShowAddModal(false)}
            ceoExists={ceoAgentIds.size > 0}
            workspaceFolders={workspaceFolders}
            externalFolderPath={externalFolderPath}
          />
        )}

        {/* ── Chat panel ── */}
        {selectedNodeId && (() => {
          const node = nodes.find(n => n.id === selectedNodeId);
          if (!node) return null;
          return (
            <ChatPanel
              node={node}
              messages={messagesForNode(selectedNodeId)}
              input={chatInput}
              onInputChange={setChatInput}
              onSend={() => sendMessage(selectedNodeId, chatInput)}
              onClose={() => setSelectedNodeId(null)}
            />
          );
        })()}

        {/* ── Edge connection panel ── */}
        {selectedEdgeId && (() => {
          const edge = edgePaths.find(e => e.id === selectedEdgeId);
          if (!edge) return null;
          const srcNode = nodes.find(n => n.id === edge.sourceId);
          const tgtNode = nodes.find(n => n.id === edge.targetId);
          const srcMsgs = agentMessages[Number(edge.sourceId)] ?? [];
          const tgtMsgs = agentMessages[Number(edge.targetId)] ?? [];
          const recent = [...srcMsgs.slice(-2), ...tgtMsgs.slice(-2)]
            .sort((a, b) => b.ts - a.ts).slice(0, 3);
          const ks = EDGE_KIND_STYLE[edge.kind];
          return (
            <div style={{
              position: 'absolute', right: 20, top: 80,
              width: 320, background: 'var(--color-bg-dark)',
              border: `2px solid ${ks.color}`,
              boxShadow: '4px 4px 0px #0a0a14',
              zIndex: 20, padding: 16, fontFamily: 'FS Pixel Sans, monospace',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: ks.color, fontWeight: 'bold' }}>
                  {srcNode?.name ?? edge.sourceId} → {tgtNode?.name ?? edge.targetId}
                </span>
                <button onClick={() => setSelectedEdgeId(null)} style={{
                  background: 'none', border: 'none', color: 'var(--color-text-muted)',
                  cursor: 'pointer', fontSize: 16, fontFamily: 'FS Pixel Sans, monospace',
                }}>✕</button>
              </div>
              <div style={{
                display: 'inline-block', fontSize: 11,
                padding: '2px 8px', marginBottom: 10,
                background: `${ks.color}22`, color: ks.color,
                border: `1px solid ${ks.color}`,
              }}>
                {edge.kind}
              </div>
              {recent.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recent.map((m, i) => (
                    <div key={i} style={{
                      fontSize: 12, color: 'var(--color-text)',
                      background: 'var(--color-bg)', padding: '6px 10px',
                      borderLeft: `2px solid ${m.role === 'user' ? 'var(--color-accent)' : ks.color}`,
                    }}>
                      <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>
                        {m.role === 'user' ? '→' : '←'}
                      </span>
                      {m.text.slice(0, 120)}{m.text.length > 120 ? '…' : ''}
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  No messages yet.
                </span>
              )}
            </div>
          );
        })()}

        {/* ── Phases overview panel rendered at App root (escapes canvas transform context) ── */}

        {/* ── Floating bottom toolbar ── */}
        <div style={{
          position: 'absolute', bottom: 28,
          left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 2,
          background: 'var(--color-bg-dark)',
          border: '2px solid var(--color-border)',
          boxShadow: '4px 4px 0px #0a0a14',
          padding: '6px', zIndex: 10, pointerEvents: 'all',
        }}>
          {TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={`${t.label}  [${t.key}]`}
              style={{
                width: 72, height: 64,
                background: tool === t.id ? 'var(--color-accent)' : 'var(--color-btn-bg)',
                border: 'none',
                color: tool === t.id ? '#fff' : 'var(--color-text)',
                cursor: 'pointer', fontFamily: 'FS Pixel Sans, monospace',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: 13, lineHeight: 1, opacity: tool === t.id ? 1 : 0.7 }}>{t.label}</span>
            </button>
          ))}
          <div style={{ width: 2, height: 44, background: 'var(--color-border)', margin: '0 6px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 54 }}>
            <span style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--color-text)', fontFamily: 'FS Pixel Sans, monospace' }}>
              {Math.round(zoom * 100)}%
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'FS Pixel Sans, monospace' }}>
              Zoom
            </span>
          </div>
          <button onClick={autoArrange} title="Auto-arrange agents (CEO top, workers below)"
            style={{
              width: 72, height: 64,
              background: 'var(--color-btn-bg)', border: 'none',
              color: 'var(--color-text)', cursor: 'pointer',
              fontFamily: 'FS Pixel Sans, monospace',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>⊞</span>
            <span style={{ fontSize: 13, lineHeight: 1, opacity: 0.7 }}>Arrange</span>
          </button>
          <button onClick={fitAll} title="Fit all agents in view"
            style={{
              width: 64, height: 64,
              background: 'var(--color-btn-bg)', border: 'none',
              color: 'var(--color-text)', cursor: 'pointer',
              fontFamily: 'FS Pixel Sans, monospace',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>⊡</span>
            <span style={{ fontSize: 13, lineHeight: 1, opacity: 0.7 }}>Fit</span>
          </button>
          <div style={{ width: 2, height: 44, background: 'var(--color-border)', margin: '0 6px' }} />
          {/* Edge legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '0 6px', justifyContent: 'center' }}>
            {([
              { color: EDGE_KIND_STYLE.idle.color,        dash: false, label: 'Idle' },
              { color: EDGE_KIND_STYLE.instructing.color, dash: true,  label: 'Instructing' },
              { color: EDGE_KIND_STYLE.active.color,      dash: true,  label: 'Communicating' },
              { color: EDGE_KIND_STYLE.waiting.color,     dash: true,  label: 'Waiting' },
            ] as const).map(({ color, dash, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width={22} height={6} style={{ flexShrink: 0 }}>
                  <line x1={0} y1={3} x2={22} y2={3} stroke={color} strokeWidth={2}
                    strokeDasharray={dash ? '4 2' : undefined} />
                </svg>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'FS Pixel Sans, monospace', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ChatPanel ─────────────────────────────────────────────────

interface ChatPanelProps {
  node: AgentNode;
  messages: ChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
}

function ChatPanel({ node, messages, input, onInputChange, onSend, onClose }: ChatPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);

  // Scroll to bottom by setting scrollTop directly — avoids scrollIntoView which can scroll the viewport
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Native wheel listener: stopPropagation before the event reaches React's root delegate
  // This prevents wheel events inside the chat panel from ever triggering the canvas pan handler
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop, { passive: true });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleSend = () => {
    if (!input.trim() && attachments.length === 0) return;
    onSend();
    setAttachments([]);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setAttachments(prev => [...prev, ...Array.from(files)]);
  };

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: 340,
        background: 'var(--color-bg)',
        borderLeft: '2px solid var(--color-border)',
        display: 'flex', flexDirection: 'column',
        zIndex: 8, fontFamily: 'FS Pixel Sans, monospace',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: '2px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span className={node.status !== 'idle' ? 'pixel-pulse' : undefined} style={{
          width: 10, height: 10, borderRadius: '50%',
          background: STATUS_COLOR[node.status], flexShrink: 0,
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--color-text)' }}>{node.name}</div>
          <div style={{ fontSize: 13, color: STATUS_COLOR[node.status] }}>{STATUS_LABEL[node.status]}</div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--color-text-muted)',
          cursor: 'pointer', fontSize: 16, padding: 0,
        }}>✕</button>
      </div>

      {/* Messages */}
      <div
        ref={messagesRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        {messages.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>
            No messages yet. Say something!
          </span>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{
            alignSelf: msg.from === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '88%', display: 'flex', flexDirection: 'column',
            gap: 3, alignItems: msg.from === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              background: msg.from === 'user' ? 'var(--color-accent)' : 'var(--color-bg-dark)',
              border: `1px solid ${msg.from === 'user' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              padding: '8px 12px',
            }}>
              <span style={{ fontSize: 14, color: msg.from === 'user' ? '#fff' : 'var(--color-text)', lineHeight: 1.4 }}>
                {msg.text}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {msg.from === 'user' ? 'You' : node.name} · {fmt(msg.ts)}
            </span>
          </div>
        ))}
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div style={{
          padding: '6px 14px 0', display: 'flex', flexWrap: 'wrap', gap: 6, flexShrink: 0,
        }}>
          {attachments.map((f, i) => (
            <span key={i} style={{
              fontSize: 12, padding: '3px 8px',
              background: 'var(--color-bg-dark)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              📎 {f.name}
              <button
                onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, fontSize: 11 }}
              >✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{
        padding: '10px 14px', borderTop: '2px solid var(--color-border)',
        display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* File attach */}
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)} />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            style={{
              background: 'var(--color-bg-dark)', border: '2px solid var(--color-border)',
              color: 'var(--color-text-muted)', cursor: 'pointer',
              fontSize: 16, padding: '0 10px', flexShrink: 0,
            }}
          >📎</button>
          <input
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={`Message ${node.name}...`}
            style={{
              flex: 1, background: 'var(--color-bg-dark)',
              border: '2px solid var(--color-border)',
              color: 'var(--color-text)', fontSize: 14,
              fontFamily: 'FS Pixel Sans, monospace',
              padding: '8px 10px', outline: 'none',
            }}
          />
          <button onClick={handleSend} style={{
            background: 'var(--color-accent)', border: 'none',
            color: '#fff', cursor: 'pointer', fontSize: 14,
            fontFamily: 'FS Pixel Sans, monospace', fontWeight: 'bold',
            padding: '8px 14px', flexShrink: 0,
          }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── NodeCard ──────────────────────────────────────────────────

interface NodeCardProps {
  node: AgentNode;
  tool: Tool;
  isEditing: boolean;
  isSnapTarget: boolean;
  isSelected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onPortDown: (e: React.MouseEvent) => void;
  onPortUp: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onBlur: () => void;
  onDelete: () => void;
  onAddHelper: () => void;
  onSelect: () => void;
  onChange: (updates: Partial<AgentNode>) => void;
  onRelaunch?: () => void;
  elapsedMs?: number;
  tokenCount?: { input: number; output: number } | null;
  tasks?: Array<{ label: string; done: boolean }>;
  onToggleTask?: (index: number) => void;
}

function NodeCard({
  node, tool, isEditing, isSnapTarget, isSelected,
  onMouseDown, onMouseUp, onPortDown, onPortUp,
  onRelaunch,
  onDoubleClick, onBlur, onDelete, onAddHelper, onSelect, onChange,
  elapsedMs, tokenCount, tasks, onToggleTask,
}: NodeCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const roleColor = nodeBorderColor(node);
  const statusColor = STATUS_COLOR[node.status];
  const showPorts = tool === 'connect' || isHovered;

  const portBase: React.CSSProperties = {
    position: 'absolute',
    left: NODE_W / 2 - PORT_R,
    width: PORT_R * 2,
    height: PORT_R * 2,
    background: 'var(--color-bg)',
    border: `2px solid ${roleColor}`,
    borderRadius: '50%',
    cursor: showPorts ? 'crosshair' : 'default',
    zIndex: 1,
    opacity: showPorts ? 1 : 0,
    transition: 'opacity 0.15s',
    pointerEvents: showPorts ? 'auto' : 'none',
  };

  const sidePortBase: React.CSSProperties = {
    position: 'absolute',
    top: NODE_H / 2 - PORT_R,
    width: PORT_R * 2,
    height: PORT_R * 2,
    background: 'var(--color-bg)',
    border: `2px solid ${roleColor}`,
    borderRadius: '50%',
    cursor: 'crosshair',
    zIndex: 1,
    opacity: showPorts ? 1 : 0,
    transition: 'opacity 0.15s',
    pointerEvents: showPorts ? 'auto' : 'none',
  };

  // Cycle status on dot click
  const cycleStatus = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next: Record<Status, Status> = { idle: 'planning', planning: 'working', working: 'waiting', waiting: 'idle', thinking: 'idle', communicating: 'idle' };
    onChange({ status: next[node.status] });
  };

  const cycleEffort = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ effort: EFFORT_CYCLE[node.effort] });
  };

  const effortOpt = EFFORT_OPTS.find(o => o.value === node.effort) ?? EFFORT_OPTS[0];

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'absolute', left: node.x, top: node.y,
        width: NODE_W,
        minHeight: NODE_H,
        height: (node.role === 'ceo' || node.role === 'manager') ? NODE_H + 22 : NODE_H,
        background: 'var(--color-bg-dark)',
        border: `2px solid ${isSelected ? 'var(--color-accent)' : node.enabled ? roleColor : 'var(--color-border)'}`,
        borderLeft: `5px solid ${node.enabled ? roleColor : 'var(--color-border)'}`,
        borderTop: (node.role === 'ceo' || node.role === 'manager') ? `3px solid ${roleColor}` : undefined,
        boxShadow: (node.role === 'ceo' || node.role === 'manager') && node.enabled
          ? `0 0 0 3px ${roleColor}, 0 0 20px ${roleColor}66, var(--shadow-pixel)`
          : isSelected
            ? '0 0 0 2px var(--color-accent), var(--shadow-pixel)'
            : (node.status === 'thinking' || node.status === 'communicating')
              ? undefined  // let CSS class animation handle the glow
              : 'var(--shadow-pixel)',
        userSelect: 'none',
        cursor: tool === 'connect' ? 'crosshair' : (tool === 'hand' || tool === 'move') ? 'grab' : 'default',
        display: 'flex', flexDirection: 'column',
        opacity: node.enabled ? 1 : 0.45,
        transition: 'opacity 0.2s',
      }}
      className={
        node.status === 'thinking' ? 'agent-node-thinking'
        : node.status === 'communicating' ? 'agent-node-communicating'
        : undefined
      }
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      {/* CEO banner strip */}
      {node.role === 'ceo' && (
        <div style={{
          height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: roleColor, flexShrink: 0, gap: 6,
        }}>
          <span style={{ fontSize: 13, fontWeight: 'bold', color: '#1a1200', letterSpacing: '0.12em', fontFamily: 'FS Pixel Sans, monospace' }}>
            ★ CEO AGENT ★
          </span>
        </div>
      )}
      {/* Manager banner strip */}
      {node.role === 'manager' && (
        <div style={{
          height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: roleColor, flexShrink: 0, gap: 6,
        }}>
          <span style={{ fontSize: 13, fontWeight: 'bold', color: '#fff', letterSpacing: '0.12em', fontFamily: 'FS Pixel Sans, monospace' }}>
            ◆ MANAGER
          </span>
        </div>
      )}
      {/* Header */}
      <div style={{
        height: 44, display: 'flex', alignItems: 'center',
        padding: '0 10px', gap: 8,
        borderBottom: `1px solid ${roleColor}50`,
        flexShrink: 0,
      }}>
        {isEditing ? (
          <input
            autoFocus value={node.name}
            onChange={e => onChange({ name: e.target.value })}
            onBlur={onBlur}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: 'var(--color-text)', fontSize: 20,
              fontFamily: 'FS Pixel Sans, monospace', fontWeight: 'bold',
              outline: 'none', minWidth: 0,
            }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span style={{
            flex: 1, fontSize: 22, fontWeight: 'bold',
            color: 'var(--color-text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}>
            {node.name}
          </span>
        )}
        {/* Chat toggle */}
        <button
          onClick={e => { e.stopPropagation(); onSelect(); }}
          onMouseDown={e => e.stopPropagation()}
          title="Open chat"
          style={{
            background: isSelected ? 'var(--color-accent)' : 'none',
            border: `1px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
            color: isSelected ? '#fff' : 'var(--color-text-muted)',
            cursor: 'pointer', fontSize: 13, padding: '1px 6px',
            lineHeight: 1, flexShrink: 0,
          }}
        >
          💬
        </button>
        {/* Enable/disable toggle */}
        <div
          onClick={e => { e.stopPropagation(); onChange({ enabled: !node.enabled }); }}
          onMouseDown={e => e.stopPropagation()}
          title={node.enabled ? 'Disable' : 'Enable'}
          style={{
            width: 26, height: 14, borderRadius: 7,
            background: node.enabled ? 'var(--color-accent)' : 'var(--color-border)',
            cursor: 'pointer', flexShrink: 0, position: 'relative',
          }}
        >
          <span style={{
            position: 'absolute', top: 2,
            left: node.enabled ? 14 : 2,
            width: 10, height: 10,
            background: '#fff', borderRadius: '50%',
            transition: 'left 0.15s',
          }} />
        </div>
        {onRelaunch && (
          <button
            onClick={e => { e.stopPropagation(); onRelaunch(); }}
            onMouseDown={e => e.stopPropagation()}
            title="Relaunch CEO terminal"
            style={{
              background: 'none', border: `1px solid ${roleColor}`,
              color: roleColor, cursor: 'pointer',
              fontSize: 13, padding: '1px 6px', lineHeight: 1, flexShrink: 0,
            }}
          >⟳</button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          onMouseDown={e => e.stopPropagation()}
          style={{
            background: 'none', border: 'none',
            color: 'var(--color-text-muted)', cursor: 'pointer',
            fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0,
          }}
        >✕</button>
      </div>

      {/* Status + action buttons section — fixed height prevents layout shifts on state change */}
      <div style={{ background: `${statusColor}18`, flexShrink: 0, height: 66 }}>
        {/* Status indicator row */}
        <div style={{
          height: 26, display: 'flex', alignItems: 'center',
          padding: '0 10px', gap: 7,
        }}>
          <span
            className={node.status !== 'idle' ? 'pixel-pulse' : undefined}
            onClick={cycleStatus}
            title="Click to cycle status"
            style={{
              width: 9, height: 9, background: statusColor,
              borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
            }}
          />
          <span style={{ fontSize: 13, color: statusColor, fontWeight: 'bold', flexShrink: 0 }}>
            {STATUS_LABEL[node.status]}
          </span>
          {node.activity && (
            <span style={{
              fontSize: 12, color: 'var(--color-text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>
              · {node.activity}
            </span>
          )}
        </div>
        {/* Plan + Priority buttons — bigger, full-width below status */}
        <div style={{ display: 'flex', gap: 6, padding: '0 10px 8px' }}>
          <button
            onClick={e => { e.stopPropagation(); onChange({ planMode: !node.planMode }); }}
            onMouseDown={e => e.stopPropagation()}
            title="Toggle planning mode"
            style={{
              flex: 1, height: 32, fontSize: 14, cursor: 'pointer',
              fontFamily: 'FS Pixel Sans, monospace',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: node.planMode ? '#a78bfa22' : 'transparent',
              border: `1px solid ${node.planMode ? '#a78bfa' : 'var(--color-border)'}`,
              color: node.planMode ? '#a78bfa' : 'var(--color-text-muted)',
            }}
          >{node.planMode ? '🔵 Plan' : 'Plan'}</button>
          <button
            onClick={cycleEffort}
            onMouseDown={e => e.stopPropagation()}
            title="Click to cycle effort level"
            style={{
              flex: 1, height: 32, fontSize: 14, cursor: 'pointer',
              fontFamily: 'FS Pixel Sans, monospace',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: node.effort !== 'none' ? `${effortOpt.color}22` : 'transparent',
              border: `1px solid ${effortOpt.color}`,
              color: effortOpt.color,
              fontWeight: node.effort !== 'none' ? 'bold' : 'normal',
            }}
          >{effortOpt.label}</button>
        </div>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, padding: '7px 10px', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', gap: 5,
      }}>
        {isEditing ? (
          <textarea
            value={node.description}
            onChange={e => onChange({ description: e.target.value })}
            rows={2}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--color-text-muted)', fontSize: 14,
              fontFamily: 'FS Pixel Sans, monospace',
              resize: 'none', outline: 'none', width: '100%',
            }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            {node.description}
          </span>
        )}
        {/* Task checklist */}
        {tasks && tasks.length > 0 && (
          <div
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            style={{ maxHeight: 76, overflowY: 'auto', margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {tasks.map((t, i) => (
              <label key={i} style={{ display: 'flex', gap: 5, fontSize: 10, cursor: 'pointer', padding: '2px 0', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => onToggleTask?.(i)}
                  style={{ cursor: 'pointer', accentColor: 'var(--color-accent)', marginTop: 1, flexShrink: 0 }}
                />
                <span style={{ textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.5 : 1, lineHeight: 1.3, color: 'var(--color-text-muted)' }}>
                  {t.label}
                </span>
              </label>
            ))}
          </div>
        )}
        {/* Can-spawn checkbox */}
        <label
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)',
            marginTop: 2,
          }}
        >
          <input
            type="checkbox"
            checked={node.canSpawn}
            onChange={e => onChange({ canSpawn: e.target.checked })}
            style={{ cursor: 'pointer', accentColor: 'var(--color-accent)', width: 14, height: 14 }}
          />
          Can spawn agents
        </label>
        {node.canSpawn && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Max:</span>
            <input
              type="number" min={1} max={10}
              value={node.maxSpawn}
              onChange={e => onChange({ maxSpawn: Math.max(1, Math.min(10, Number(e.target.value))) })}
              onMouseDown={e => e.stopPropagation()}
              style={{
                width: 44, background: 'var(--color-bg-dark)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)', fontSize: 13,
                fontFamily: 'FS Pixel Sans, monospace',
                padding: '2px 4px', textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>agents</span>
          </div>
        )}

        {node.thought && !isEditing && (
          <span style={{
            fontSize: 13, color: 'var(--color-text-muted)',
            fontStyle: 'italic', lineHeight: 1.3,
            overflow: 'hidden', display: 'block', maxHeight: 36,
          }}>
            💬 {node.thought}
          </span>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '5px 10px', borderTop: '1px solid var(--color-border)',
        display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0,
      }}>
        {(elapsedMs !== undefined || tokenCount) && (
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center',
            fontSize: 11, color: 'var(--color-text-muted)',
            fontFamily: 'FS Pixel Sans, monospace',
          }}>
            {elapsedMs !== undefined && (
              <span title="Elapsed since turn start">⏱ {(elapsedMs / 1000).toFixed(1)}s</span>
            )}
            {tokenCount && (
              <>
                <span title="Input tokens">↑ {formatTokens(tokenCount.input)}</span>
                <span title="Output tokens">↓ {formatTokens(tokenCount.output)}</span>
              </>
            )}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <select
          value={node.role}
          onChange={e => onChange({ role: e.target.value as Role })}
          onMouseDown={e => e.stopPropagation()}
          style={{
            background: 'var(--color-btn-bg)', border: 'none',
            color: roleColor, fontSize: 13,
            fontFamily: 'FS Pixel Sans, monospace',
            cursor: 'pointer', flex: 1, padding: '3px 4px',
          }}
        >
          <option value="ceo">● CEO</option>
          <option value="manager">● Manager</option>
          <option value="worker">● Worker</option>
        </select>
        <button
          onClick={e => { e.stopPropagation(); onAddHelper(); }}
          onMouseDown={e => e.stopPropagation()}
          title="Add a helper agent connected to this one"
          style={{
            background: 'var(--color-btn-bg)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer', fontSize: 13,
            fontFamily: 'FS Pixel Sans, monospace',
            padding: '3px 10px', flexShrink: 0,
          }}
        >
          + Agent
        </button>
        </div>
      </div>

      {/* Top port */}
      <div style={{ ...portBase, top: -PORT_R }} onMouseDown={onPortDown} onMouseUp={onPortUp} />

      {/* Bottom port */}
      <div style={{ ...portBase, bottom: -PORT_R }} onMouseDown={onPortDown} onMouseUp={onPortUp} />

      {/* Left port */}
      <div style={{ ...sidePortBase, left: -PORT_R }} onMouseDown={onPortDown} onMouseUp={onPortUp} />

      {/* Right port */}
      <div style={{ ...sidePortBase, right: -PORT_R }} onMouseDown={onPortDown} onMouseUp={onPortUp} />

      {/* Snap ring (shown on any port when this node is a snap target) */}
      {isSnapTarget && (
        <div className="pixel-pulse" style={{
          position: 'absolute',
          inset: -8, borderRadius: 0,
          border: '2px solid var(--color-accent)',
          pointerEvents: 'none',
          zIndex: 2,
        }} />
      )}
    </div>
  );
}

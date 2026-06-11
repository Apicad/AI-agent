import { useEffect, useMemo, useRef, useState } from 'react';

import type { AgentHistoryEntry, ChatMessage, FleetState } from '../hooks/useExtensionMessages.js';
import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import type { RoomZone, ToolActivity } from '../office/types.js';
import { vscode } from '../vscodeApi.js';

const AGENT_NAMES = [
  'Nova',
  'Atlas',
  'Sage',
  'Echo',
  'Pixel',
  'Byte',
  'Cipher',
  'Nexus',
  'Flux',
  'Vega',
  'Titan',
  'Lyra',
  'Ada',
  'Blaze',
  'Storm',
  'Aria',
  'Rex',
  'Kai',
  'Zara',
  'Orion',
  'Luna',
  'Cosmo',
  'Dash',
  'Spark',
  'Hawk',
  'Reef',
  'Ember',
  'Quill',
  'Wren',
  'Scout',
];

interface ActivitySidebarProps {
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  agentHistory: Record<number, AgentHistoryEntry[]>;
  agentNames: Record<number, string>;
  agentTasks: Record<number, string>;
  agentFolderNames: Record<number, string>;
  agentFolderPaths: Record<number, string>;
  agentModes: Record<number, string>;
  agentHomeZones?: Record<number, string>;
  agentRoles?: Record<number, string>;
  ceoAgentIds?: Set<number>;
  workspaceFolders: WorkspaceFolder[];
  agentMessages: Record<number, ChatMessage[]>;
  sentMessages: Record<number, ChatMessage[]>;
  isMeetingActive: boolean;
  zones?: RoomZone[];
  onClose: () => void;
  onCloseAgent: (id: number) => void;
  onCloseAllAgents: () => void;
  onStartMeeting: () => void;
  onSendAgentMessage: (id: number, message: string) => void;
  onSetAgentMeta: (
    id: number,
    updates: {
      name?: string;
      task?: string;
      folderPath?: string;
      mode?: string;
      homeZoneId?: string;
      role?: string;
    },
  ) => void;
  onSpawnCeo?: (name?: string, task?: string, folderPath?: string) => void;
  pendingFileAttach?: Record<number, string>;
  onClearPendingFileAttach?: (agentId: number) => void;
  onBrowseFile?: (agentId: number, imageOnly?: boolean) => void;
  fleetState?: FleetState | null;
  mode?: 'overlay' | 'split';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatRuntime(startMs: number, nowMs: number): string {
  const ms = Math.max(0, nowMs - startMs);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function timeAgo(ts: number, now: number): string {
  if (now === 0) return '';
  const diff = now - ts;
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

const EFFORT_LEVELS = [
  { label: 'Low', mode: 'default', color: 'var(--color-text-muted)' },
  { label: 'High', mode: 'automation', color: 'var(--color-status-active)' },
  { label: 'Max', mode: 'liberty', color: 'var(--color-status-permission)' },
] as const;

function modeToEffortIdx(mode: string | undefined): number {
  if (mode === 'automation') return 1;
  if (mode === 'liberty') return 2;
  return 0;
}

const ZONE_ROLE_LABELS: Record<string, string> = {
  work: '💼 Work',
  rest: '☕ Rest',
  meeting: '🏢 Meeting',
  outside: '🌿 Outside',
};

function AgentCard({
  agentId,
  tools,
  status,
  history,
  now,
  customName,
  task,
  folderName,
  folderPath,
  currentMode,
  homeZoneId,
  agentRole,
  zones,
  workspaceFolders,
  chatMessages,
  isCeo,
  onClose,
  onRelaunch,
  onSetAgentMeta,
  onSendMessage,
  pendingFileAttach,
  onClearPendingFileAttach,
  onBrowseFile,
}: {
  agentId: number;
  tools: ToolActivity[];
  status: string | undefined;
  history: AgentHistoryEntry[];
  now: number;
  customName: string | undefined;
  task: string | undefined;
  folderName: string | undefined;
  folderPath: string | undefined;
  currentMode: string | undefined;
  homeZoneId: string | undefined;
  agentRole: string | undefined;
  zones: RoomZone[];
  workspaceFolders: WorkspaceFolder[];
  chatMessages: ChatMessage[];
  isCeo: boolean;
  onClose: () => void;
  onRelaunch?: () => void;
  onSetAgentMeta: (updates: {
    name?: string;
    task?: string;
    folderPath?: string;
    mode?: string;
    homeZoneId?: string;
    role?: string;
  }) => void;
  onSendMessage: (message: string) => void;
  pendingFileAttach?: string;
  onClearPendingFileAttach?: () => void;
  onBrowseFile?: (imageOnly?: boolean) => void;
}) {
  const activeTools = tools.filter((t) => !t.done);
  const hasPermission = activeTools.some((t) => t.permissionWait);
  const isActive = activeTools.length > 0 || status === 'active';

  const [idleOverride, setIdleOverride] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (status === 'waiting' && !isActive) {
      setIdleOverride(false);
      idleTimerRef.current = setTimeout(() => setIdleOverride(true), 30000);
    } else {
      setIdleOverride(false);
    }
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [status, isActive]);

  const isWaiting = status === 'waiting' && !idleOverride;

  const [barState, setBarState] = useState<{ visible: boolean; pct: number }>({
    visible: false,
    pct: 0,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    if (isWaiting) {
      clearTimers();
      setBarState({ visible: true, pct: 100 });
      hideTimerRef.current = setTimeout(() => setBarState({ visible: false, pct: 0 }), 1800);
    } else if (isActive) {
      clearTimers();
      setBarState((s) => ({ visible: true, pct: s.pct < 5 ? 5 : s.pct }));
      intervalRef.current = setInterval(() => {
        setBarState((s) => ({ ...s, pct: s.pct + (88 - s.pct) * 0.04 }));
      }, 150);
    } else {
      clearTimers();
      setBarState({ visible: false, pct: 0 });
    }

    return clearTimers;
  }, [isActive, isWaiting]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(customName ?? '');
  const [taskInput, setTaskInput] = useState(task ?? '');
  const [savedFlash, setSavedFlash] = useState(false);
  const [taskSentNotice, setTaskSentNotice] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [effortIdx, setEffortIdx] = useState(() => modeToEffortIdx(currentMode));
  const [attachments, setAttachments] = useState<
    { id: string; type: 'file' | 'image' | 'url'; label: string; value: string }[]
  >([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

  useEffect(() => {
    if (currentMode !== 'planner') setEffortIdx(modeToEffortIdx(currentMode));
  }, [currentMode]);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const commitWithFlash = (updates: {
    name?: string;
    task?: string;
    folderPath?: string;
    mode?: string;
    homeZoneId?: string;
    role?: string;
  }) => {
    onSetAgentMeta(updates);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  useEffect(() => {
    setNameInput(customName ?? '');
  }, [customName]);
  useEffect(() => {
    setTaskInput(task ?? '');
  }, [task]);
  useEffect(() => {
    if (isEditingName) nameInputRef.current?.focus();
  }, [isEditingName]);

  useEffect(() => {
    if (!pendingFileAttach) return;
    const isImg = /\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff)$/i.test(pendingFileAttach);
    const label = pendingFileAttach.split('/').pop() ?? pendingFileAttach;
    setAttachments((a) => [
      ...a,
      {
        id: Date.now().toString(),
        type: isImg ? 'image' : 'file',
        label,
        value: pendingFileAttach,
      },
    ]);
    onClearPendingFileAttach?.();
  }, [pendingFileAttach]);

  const commitName = () => {
    setIsEditingName(false);
    commitWithFlash({ name: nameInput.trim() });
  };

  const pickRandomName = () => {
    const name = AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)];
    setNameInput(name);
    commitWithFlash({ name });
  };

  const sendChatMessage = () => {
    const msg = chatInput.trim();
    if (!msg && attachments.length === 0) return;
    const parts = [msg, ...attachments.map((a) => a.value)].filter(Boolean);
    const fullMsg = parts.join('\n');
    setChatInput('');
    setAttachments([]);
    setShowAttachMenu(false);
    setShowUrlInput(false);
    setUrlInput('');
    onSendMessage(fullMsg);
    if (!taskInput.trim() && msg) {
      const title = msg.length > 60 ? msg.slice(0, 57) + '...' : msg;
      setTaskInput(title);
      commitWithFlash({ task: title });
    }
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  const statusColor = hasPermission
    ? 'var(--color-status-permission)'
    : isWaiting
      ? 'var(--color-status-success)'
      : isActive
        ? 'var(--color-status-active)'
        : 'var(--color-text-muted)';

  const statusLabel = hasPermission
    ? 'needs approval'
    : isWaiting
      ? 'done'
      : isActive
        ? 'active'
        : 'idle';
  const displayName = customName || `Agent ${agentId}`;

  const CEO_COLOR = '#cca700';
  const MGR_COLOR = '#3b82f6';
  const WRK_COLOR = '#22c55e';
  const effectiveRole = isCeo ? 'ceo' : (agentRole ?? 'worker');
  const accentColor = isCeo ? CEO_COLOR : effectiveRole === 'manager' ? MGR_COLOR : WRK_COLOR;

  return (
    <div
      style={{
        borderBottom: '1px solid var(--color-border)',
        borderLeft: `4px solid ${accentColor}`,
        boxShadow: `inset 0 0 10px ${accentColor}10`,
      }}
    >
      {/* Progress bar — above the padded content, full width */}
      {barState.visible && (
        <div style={{ height: 3, background: 'var(--progress-track-bg)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${barState.pct}%`,
              background:
                barState.pct >= 100 ? 'var(--color-status-success)' : 'var(--color-status-active)',
              transition: barState.pct >= 100 ? 'none' : 'width 0.12s linear',
            }}
          />
        </div>
      )}

      <div style={{ padding: '10px 12px' }}>
        {/* ── Header: status pill · name · role badge · dice · flash · close ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {/* Status pill */}
          <span
            style={{
              fontSize: 16,
              padding: '3px 10px',
              borderRadius: 3,
              flexShrink: 0,
              fontWeight: 600,
              background: `${statusColor}22`,
              border: `1px solid ${statusColor}`,
              color: statusColor,
              letterSpacing: '0.04em',
            }}
          >
            {hasPermission ? '⚠ approval' : isWaiting ? '✓ done' : isActive ? '● active' : '○ idle'}
          </span>

          {/* Name / edit */}
          {isEditingName ? (
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setNameInput(customName ?? '');
                  setIsEditingName(false);
                }
              }}
              placeholder={`Agent ${agentId}`}
              style={{
                flex: 1,
                background: 'var(--color-bg-dark)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                fontSize: 26,
                fontWeight: 'bold',
                fontFamily: 'FS Pixel Sans, monospace',
                padding: '1px 6px',
                outline: 'none',
              }}
            />
          ) : (
            <span
              title="Double-click to rename"
              onDoubleClick={() => setIsEditingName(true)}
              style={{
                flex: 1,
                fontWeight: 'bold',
                fontSize: 26,
                color: customName ? 'var(--color-text)' : 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'text',
              }}
            >
              {displayName}
            </span>
          )}

          {/* Role badge — all roles */}
          {isCeo && (
            <span
              style={{
                fontSize: 15,
                padding: '2px 9px',
                borderRadius: 3,
                flexShrink: 0,
                background: `${CEO_COLOR}22`,
                border: `1px solid ${CEO_COLOR}`,
                color: CEO_COLOR,
                fontWeight: 700,
                letterSpacing: '0.06em',
              }}
            >
              ★ CEO
            </span>
          )}
          {!isCeo && effectiveRole === 'manager' && (
            <span
              style={{
                fontSize: 15,
                padding: '2px 9px',
                borderRadius: 3,
                flexShrink: 0,
                background: `${MGR_COLOR}22`,
                border: `1px solid ${MGR_COLOR}`,
                color: MGR_COLOR,
                fontWeight: 700,
                letterSpacing: '0.06em',
              }}
            >
              ◆ MGR
            </span>
          )}
          {!isCeo && effectiveRole === 'worker' && (
            <span
              style={{
                fontSize: 15,
                padding: '2px 9px',
                borderRadius: 3,
                flexShrink: 0,
                background: `${WRK_COLOR}18`,
                border: `1px solid ${WRK_COLOR}55`,
                color: WRK_COLOR,
                fontWeight: 700,
                letterSpacing: '0.06em',
              }}
            >
              · WRK
            </span>
          )}

          {/* Dice + flash + close */}
          <button
            onClick={pickRandomName}
            title="Random name"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 17,
              padding: '0 2px',
              flexShrink: 0,
              opacity: 0.6,
            }}
          >
            🎲
          </button>
          {savedFlash && (
            <span style={{ fontSize: 16, color: 'var(--color-status-success)', flexShrink: 0 }}>
              ✓
            </span>
          )}
          {onRelaunch && (
            <button
              onClick={onRelaunch}
              title="Relaunch CEO"
              style={{
                background: `${CEO_COLOR}22`,
                border: `1px solid ${CEO_COLOR}`,
                color: CEO_COLOR,
                cursor: 'pointer',
                fontSize: 14,
                padding: '2px 8px',
                flexShrink: 0,
                fontFamily: 'FS Pixel Sans, monospace',
              }}
            >
              ⟳
            </button>
          )}
          <button
            onClick={onClose}
            title="Close agent"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 20,
              padding: '0 2px',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Meta row: effort · folder ── */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 17 }}
        >
          {effortIdx > 0 && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 3,
                fontWeight: 600,
                background: `${EFFORT_LEVELS[effortIdx].color}18`,
                border: `1px solid ${EFFORT_LEVELS[effortIdx].color}55`,
                color: EFFORT_LEVELS[effortIdx].color,
                flexShrink: 0,
              }}
            >
              ⚡ {EFFORT_LEVELS[effortIdx].label}
            </span>
          )}
          <span
            title={folderPath ?? folderName ?? ''}
            style={{
              flex: 1,
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.7,
              fontSize: 15,
            }}
          >
            📁{' '}
            {folderPath
              ? folderPath.replace(/\/Users\/[^/]+\//, '~/').replace(/.*\/(agents\/[^/]+)$/, '$1')
              : (folderName ?? '—')}
          </span>
        </div>

        {/* ── Approval banner ── */}
        {hasPermission && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--color-status-permission)18',
              border: '1px solid var(--color-status-permission)',
              padding: '8px 12px',
              marginBottom: 10,
              borderRadius: 2,
            }}
          >
            <span
              style={{ fontSize: 19, color: 'var(--color-status-permission)', fontWeight: 600 }}
            >
              ⚠ Waiting for approval
            </span>
            <button
              onClick={() => vscode.postMessage({ type: 'approvePermission', id: agentId })}
              style={{
                background: 'var(--color-status-permission)',
                border: 'none',
                color: 'var(--color-bg)',
                cursor: 'pointer',
                fontSize: 17,
                fontWeight: 'bold',
                fontFamily: 'FS Pixel Sans, monospace',
                padding: '4px 12px',
                borderRadius: 2,
              }}
            >
              Approve ✓
            </button>
          </div>
        )}

        {/* ── Task input ── */}
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 19, color: 'var(--color-text-muted)', flexShrink: 0 }}>📝</span>
          <input
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onBlur={(e) => commitWithFlash({ task: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitWithFlash({ task: taskInput });
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                setTaskInput(task ?? '');
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Assign a task..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--color-border)',
              color: taskInput ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontSize: 20,
              fontFamily: 'FS Pixel Sans, monospace',
              padding: '2px 0',
              outline: 'none',
            }}
          />
          <button
            onClick={() => {
              const msg = taskInput.trim();
              if (!msg) return;
              commitWithFlash({ task: msg });
              onSendMessage(msg);
              setTaskSentNotice(true);
              setTimeout(() => setTaskSentNotice(false), 3000);
            }}
            disabled={!taskInput.trim()}
            title="Send task to agent"
            style={{
              background: taskInput.trim() ? 'var(--color-accent)' : 'transparent',
              border: '1px solid var(--color-border)',
              color: taskInput.trim() ? 'var(--color-bg-dark)' : 'var(--color-text-muted)',
              cursor: taskInput.trim() ? 'pointer' : 'default',
              fontSize: 17,
              fontFamily: 'FS Pixel Sans, monospace',
              padding: '3px 10px',
              flexShrink: 0,
              opacity: taskInput.trim() ? 1 : 0.4,
              borderRadius: 2,
            }}
          >
            ▶
          </button>
        </div>

        {taskSentNotice && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--color-status-active)12',
              border: '1px solid var(--color-status-active)',
              padding: '5px 10px',
              marginBottom: 8,
              fontSize: 16,
              color: 'var(--color-status-active)',
              borderRadius: 2,
            }}
          >
            <span>▶</span>
            <span>Task sent</span>
          </div>
        )}

        {/* ── Controls: Plan · Effort · Role — all one row ── */}
        <div style={{ marginBottom: 10, display: 'flex', gap: 5 }}>
          {/* Plan toggle */}
          {(() => {
            const isPlan = currentMode === 'planner';
            return (
              <button
                onClick={() => {
                  const next = isPlan ? EFFORT_LEVELS[effortIdx].mode : 'planner';
                  commitWithFlash({ mode: next });
                }}
                title={isPlan ? 'Planning mode ON' : 'Turn on planning mode'}
                style={{
                  flex: 1,
                  background: isPlan ? 'var(--color-status-active)22' : 'transparent',
                  border: `1px solid ${isPlan ? 'var(--color-status-active)' : 'var(--color-border)'}`,
                  color: isPlan ? 'var(--color-status-active)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 18,
                  padding: '7px 0',
                  fontFamily: 'FS Pixel Sans, monospace',
                }}
              >
                {isPlan ? '🔵 Plan' : 'Plan'}
              </button>
            );
          })()}

          {/* Effort cycler */}
          {(() => {
            const effort = EFFORT_LEVELS[effortIdx];
            return (
              <button
                onClick={() => {
                  const next = (effortIdx + 1) % EFFORT_LEVELS.length;
                  setEffortIdx(next);
                  if (currentMode !== 'planner')
                    commitWithFlash({ mode: EFFORT_LEVELS[next].mode });
                }}
                title="Cycle effort: Low → High → Max"
                style={{
                  flex: 1,
                  background: effortIdx > 0 ? `${effort.color}22` : 'transparent',
                  border: `1px solid ${effortIdx > 0 ? effort.color : 'var(--color-border)'}`,
                  color: effortIdx > 0 ? effort.color : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 18,
                  padding: '7px 0',
                  fontFamily: 'FS Pixel Sans, monospace',
                }}
              >
                ⚡ {effort.label}
              </button>
            );
          })()}

          {/* Role toggle */}
          {!isCeo && (
            <button
              onClick={() =>
                commitWithFlash({ role: effectiveRole === 'manager' ? 'worker' : 'manager' })
              }
              title="Toggle role"
              style={{
                flex: 0,
                background: effectiveRole === 'manager' ? `${MGR_COLOR}22` : 'transparent',
                border: `1px solid ${effectiveRole === 'manager' ? MGR_COLOR : 'var(--color-border)'}`,
                color: effectiveRole === 'manager' ? MGR_COLOR : 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 18,
                padding: '7px 12px',
                fontFamily: 'FS Pixel Sans, monospace',
              }}
            >
              {effectiveRole === 'manager' ? '◆ MGR' : '· WRK'}
            </button>
          )}
        </div>

        {/* ── Active tools ── */}
        {activeTools.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {activeTools.map((tool) => (
              <div
                key={tool.toolId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 19,
                  color: tool.permissionWait
                    ? 'var(--color-status-permission)'
                    : 'var(--color-text)',
                  padding: '3px 0',
                }}
              >
                <span
                  className="pixel-pulse"
                  style={{ color: 'var(--color-status-active)', flexShrink: 0, fontSize: 16 }}
                >
                  ▶
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    opacity: 0.85,
                  }}
                  title={tool.status}
                >
                  {tool.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── History ── */}
        {history.length > 0 && (
          <>
            <div
              style={{ borderTop: '1px solid var(--color-border)', marginBottom: 4, opacity: 0.3 }}
            />
            {history.slice(0, 6).map((entry) => {
              const totalTokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
              const isWaitingEntry = entry.type === 'waiting';
              return (
                <div
                  key={entry.entryId}
                  style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '3px 0' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 18,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 16,
                        color: isWaitingEntry
                          ? 'var(--color-status-success)'
                          : entry.type === 'permission'
                            ? 'var(--color-status-permission)'
                            : 'var(--color-text-muted)',
                      }}
                    >
                      {isWaitingEntry ? '✓' : '·'}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={entry.statusText}
                    >
                      {entry.statusText}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 16, opacity: 0.7 }}>
                      {entry.durationMs !== undefined
                        ? formatDuration(entry.durationMs)
                        : timeAgo(entry.timestamp, now)}
                    </span>
                  </div>
                  {isWaitingEntry && totalTokens > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        fontSize: 16,
                        paddingLeft: 22,
                        color: 'var(--color-text-muted)',
                        opacity: 0.7,
                      }}
                    >
                      {entry.inputTokens !== undefined && (
                        <span>↑ {formatTokens(entry.inputTokens)}</span>
                      )}
                      {entry.outputTokens !== undefined && (
                        <span>↓ {formatTokens(entry.outputTokens)}</span>
                      )}
                      <span>∑ {formatTokens(totalTokens)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {activeTools.length === 0 && history.length === 0 && (
          <div
            style={{
              fontSize: 18,
              color: 'var(--color-text-muted)',
              padding: '4px 0',
              opacity: 0.6,
            }}
          >
            No activity yet
          </div>
        )}

        {/* ── Chat ── */}
        <div style={{ marginTop: 10, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
          {chatMessages.length > 0 && (
            <div
              style={{
                maxHeight: 200,
                overflowY: 'auto',
                marginBottom: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              {chatMessages.slice(-20).map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <span
                    style={{
                      fontSize: 18,
                      lineHeight: '1.5',
                      color: m.role === 'user' ? 'var(--color-accent-bright)' : 'var(--color-text)',
                      background:
                        m.role === 'user' ? 'var(--color-accent)18' : 'var(--color-bg-dark)',
                      border: `1px solid ${m.role === 'user' ? 'var(--color-accent)44' : 'var(--color-border)'}`,
                      padding: '5px 10px',
                      maxWidth: '90%',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      borderRadius: 2,
                    }}
                  >
                    {m.text}
                  </span>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>
          )}

          {/* Attachment tags */}
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {attachments.map((a) => (
                <span
                  key={a.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'var(--color-bg-dark)',
                    border: '1px solid var(--color-border)',
                    fontSize: 16,
                    padding: '3px 8px',
                    maxWidth: 200,
                    fontFamily: 'FS Pixel Sans, monospace',
                    borderRadius: 2,
                  }}
                >
                  <span>{a.type === 'image' ? '🖼' : a.type === 'url' ? '🔗' : '📄'}</span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {a.label}
                  </span>
                  <button
                    onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      fontSize: 13,
                      padding: 0,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* URL input */}
          {showUrlInput && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <input
                autoFocus
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && urlInput.trim()) {
                    setAttachments((a) => [
                      ...a,
                      {
                        id: Date.now().toString(),
                        type: 'url',
                        label: urlInput.trim(),
                        value: urlInput.trim(),
                      },
                    ]);
                    setUrlInput('');
                    setShowUrlInput(false);
                  }
                  if (e.key === 'Escape') {
                    setUrlInput('');
                    setShowUrlInput(false);
                  }
                }}
                placeholder="Paste a URL..."
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontSize: 17,
                  fontFamily: 'FS Pixel Sans, monospace',
                  padding: '5px 9px',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => {
                  setUrlInput('');
                  setShowUrlInput(false);
                }}
                style={{
                  background: 'none',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: '4px 10px',
                  fontFamily: 'FS Pixel Sans, monospace',
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Input row */}
          <div style={{ display: 'flex', gap: 5, position: 'relative' }}>
            {showAttachMenu && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: 4,
                  background: 'var(--color-bg-dark)',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                  zIndex: 30,
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 140,
                }}
              >
                {(['📄 File', '🖼 Image', '🔗 URL'] as const).map((label, i) => (
                  <button
                    key={label}
                    onClick={() => {
                      setShowAttachMenu(false);
                      if (i === 0) onBrowseFile?.();
                      else if (i === 1) onBrowseFile?.(true);
                      else setShowUrlInput(true);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                      fontSize: 17,
                      padding: '9px 14px',
                      textAlign: 'left',
                      fontFamily: 'FS Pixel Sans, monospace',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                setShowAttachMenu((v) => !v);
                setShowUrlInput(false);
              }}
              title="Attach file, image, or URL"
              style={{
                background: showAttachMenu ? 'var(--color-border)' : 'none',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 19,
                padding: '6px 10px',
                flexShrink: 0,
                borderRadius: 2,
              }}
            >
              📎
            </button>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder="Send a message..."
              style={{
                flex: 1,
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                fontSize: 20,
                fontFamily: 'FS Pixel Sans, monospace',
                padding: '6px 10px',
                outline: 'none',
                borderRadius: 2,
              }}
            />
            <button
              onClick={sendChatMessage}
              disabled={!chatInput.trim() && attachments.length === 0}
              style={{
                background: 'var(--color-accent)',
                border: 'none',
                color: 'var(--color-bg-dark)',
                cursor: chatInput.trim() || attachments.length > 0 ? 'pointer' : 'default',
                fontSize: 20,
                fontFamily: 'FS Pixel Sans, monospace',
                padding: '6px 14px',
                opacity: chatInput.trim() || attachments.length > 0 ? 1 : 0.4,
                borderRadius: 2,
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActivitySidebar({
  agents,
  agentTools,
  agentStatuses,
  agentHistory,
  agentNames,
  agentTasks,
  agentFolderNames,
  agentFolderPaths,
  agentModes,
  agentHomeZones = {},
  agentRoles = {},
  ceoAgentIds,
  onSpawnCeo,
  agentMessages,
  sentMessages,
  isMeetingActive,
  zones = [],
  workspaceFolders,
  onClose,
  onCloseAgent,
  onCloseAllAgents,
  onStartMeeting,
  onSendAgentMessage,
  onSetAgentMeta,
  pendingFileAttach,
  onClearPendingFileAttach,
  onBrowseFile,
  fleetState,
  mode = 'overlay',
}: ActivitySidebarProps) {
  const nowRef = useRef(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    const update = () => {
      nowRef.current = Date.now();
      setTick((n) => n + 1);
    };
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, []);

  const [activeTab, setActiveTab] = useState<'agents' | 'summary'>('agents');

  // Phase data from localStorage (polled every 2s)
  const [lsPhaseNames, setLsPhaseNames] = useState<string[]>([]);
  const [lsCurrentPhase, setLsCurrentPhase] = useState(0);
  const [runMode, setRunMode] = useState('');
  const [lsGatePending, setLsGatePending] = useState(false);

  useEffect(() => {
    const poll = () => {
      try {
        const names = localStorage.getItem('pixel-agents-phase-names');
        setLsPhaseNames(names ? (JSON.parse(names) as string[]) : []);
        setLsCurrentPhase(
          parseInt(localStorage.getItem('pixel-agents-current-phase') ?? '0', 10) || 0,
        );
        setRunMode(localStorage.getItem('pixel-agents-run-mode') ?? '');
        setLsGatePending(!!localStorage.getItem('pixel-agents-phase-gate'));
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  // Prefer the live vault fleet (PHASE.md via fleetState) — the claude-brain fleet's
  // real source of truth — over the legacy localStorage phase mechanism (work-system mode).
  const PHASE_LABELS = ['Intake', 'Design', 'Build', 'QA · Launch'];
  const activeProject =
    fleetState?.projects?.find((p) => fleetState.activeProjects?.includes(p.slug)) ?? null;
  const fleetPhase = activeProject ? (activeProject.phase ?? activeProject.boardPhase) : null;
  const phaseNames = activeProject ? PHASE_LABELS : lsPhaseNames;
  const currentPhase = activeProject ? (fleetPhase ?? 0) : lsCurrentPhase;
  const phaseGatePending = activeProject
    ? activeProject.gate === 'awaiting-approval' || activeProject.boardGate === 'awaiting-approval'
    : lsGatePending;

  // Token totals across all agents
  const tokenSummary = useMemo(() => {
    let totalInput = 0,
      totalOutput = 0;
    const perAgent: Array<{ id: number; name: string; input: number; output: number }> = [];
    for (const id of agents) {
      let agentInput = 0,
        agentOutput = 0;
      for (const entry of agentHistory[id] ?? []) {
        agentInput += entry.inputTokens ?? 0;
        agentOutput += entry.outputTokens ?? 0;
      }
      totalInput += agentInput;
      totalOutput += agentOutput;
      if (agentInput + agentOutput > 0) {
        perAgent.push({
          id,
          name: agentNames[id] ?? `Agent ${id}`,
          input: agentInput,
          output: agentOutput,
        });
      }
    }
    perAgent.sort((a, b) => b.input + b.output - (a.input + a.output));
    return { totalInput, totalOutput, total: totalInput + totalOutput, perAgent };
  }, [agents, agentHistory, agentNames]);

  // Project start: the active vault project's start (PHASE.md/brief.md) when present —
  // not the earliest-ever agent-history entry (which spans days across sessions).
  const projectStart = useMemo(() => {
    if (activeProject?.started) return activeProject.started;
    if (activeProject) {
      // active project but no start stamp → earliest history of CURRENTLY-LIVE agents
      let earliest = Infinity;
      for (const id of agents) {
        for (const entry of agentHistory[id] ?? []) {
          if (entry.timestamp < earliest) earliest = entry.timestamp;
        }
      }
      return earliest === Infinity ? null : earliest;
    }
    return null;
  }, [activeProject, agents, agentHistory]);

  return (
    <div
      className="pixel-panel"
      style={
        mode === 'split'
          ? {
              width: 340,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRight: '2px solid var(--color-border)',
            }
          : {
              position: 'absolute',
              right: 10,
              top: 10,
              bottom: 76,
              width: 420,
              zIndex: 20,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }
      }
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '2px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 30, fontWeight: 'bold', color: 'var(--color-text)' }}>
          Activity Monitor
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onSpawnCeo && (ceoAgentIds?.size ?? 0) === 0 && (
            <button
              onClick={() => onSpawnCeo()}
              title="Spawn CEO agent"
              style={{
                background: '#cca70022',
                border: '1px solid #cca700',
                color: '#cca700',
                cursor: 'pointer',
                fontSize: 16,
                padding: '2px 8px',
                lineHeight: 1.4,
                fontFamily: 'FS Pixel Sans, monospace',
                fontWeight: 'bold',
              }}
            >
              ⭐ Spawn CEO
            </button>
          )}
          {agents.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm(`Close all ${agents.length} agent(s) and reset counter to 1?`)) {
                  onCloseAllAgents();
                  vscode.postMessage({ type: 'resetAgentCounter' });
                }
              }}
              title="Close all agents"
              style={{
                background: 'none',
                border: '1px solid var(--color-status-permission)',
                color: 'var(--color-status-permission)',
                cursor: 'pointer',
                fontSize: 16,
                padding: '2px 8px',
                lineHeight: 1.4,
                fontFamily: 'FS Pixel Sans, monospace',
              }}
            >
              End All
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 20,
              padding: '0 2px',
              lineHeight: 1,
            }}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '2px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        {(['agents', 'summary'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px 0',
              background: 'none',
              border: 'none',
              borderBottom:
                activeTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
              marginBottom: -2,
              color: activeTab === tab ? 'var(--color-text)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 16,
              fontFamily: 'FS Pixel Sans, monospace',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              transition: 'color 0.15s',
            }}
          >
            {tab === 'agents' ? `Agents (${agents.length})` : 'Summary'}
          </button>
        ))}
      </div>

      {/* Agent cards */}
      {activeTab === 'agents' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {agents.length === 0 ? (
            <div
              style={{
                padding: '20px 14px',
                fontSize: 19,
                color: 'var(--color-text-muted)',
                textAlign: 'center',
              }}
            >
              No agents running.
              <br />
              Click + Agent to start.
            </div>
          ) : (
            agents.map((id) => (
              <AgentCard
                key={id}
                agentId={id}
                tools={agentTools[id] ?? []}
                status={agentStatuses[id]}
                history={agentHistory[id] ?? []}
                now={nowRef.current}
                customName={agentNames[id]}
                task={agentTasks[id]}
                folderName={agentFolderNames[id]}
                folderPath={agentFolderPaths[id]}
                currentMode={agentModes[id]}
                homeZoneId={agentHomeZones[id]}
                agentRole={agentRoles[id]}
                zones={zones}
                workspaceFolders={workspaceFolders}
                isCeo={ceoAgentIds?.has(id) ?? false}
                onRelaunch={
                  ceoAgentIds?.has(id) && onSpawnCeo
                    ? () => onSpawnCeo(agentNames[id], agentTasks[id], agentFolderPaths[id])
                    : undefined
                }
                chatMessages={[...(agentMessages[id] ?? []), ...(sentMessages[id] ?? [])].sort(
                  (a, b) => a.ts - b.ts,
                )}
                onClose={() => onCloseAgent(id)}
                onSetAgentMeta={(updates) => onSetAgentMeta(id, updates)}
                onSendMessage={(msg) => onSendAgentMessage(id, msg)}
                pendingFileAttach={pendingFileAttach?.[id]}
                onClearPendingFileAttach={() => onClearPendingFileAttach?.(id)}
                onBrowseFile={(imageOnly) => onBrowseFile?.(id, imageOnly)}
              />
            ))
          )}
        </div>
      )}

      {/* Summary tab */}
      {activeTab === 'summary' && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {/* Active Agents — who's working right now */}
          <section>
            <div
              style={{
                fontSize: 13,
                letterSpacing: '0.12em',
                color: 'var(--color-text-muted)',
                marginBottom: 12,
                textTransform: 'uppercase',
              }}
            >
              Active Now
            </div>
            {(() => {
              const activeAgents = agents.filter((id) => {
                const tools = agentTools[id] ?? [];
                const hasActiveTools = tools.some((t) => !t.done);
                return hasActiveTools || agentStatuses[id] === 'active';
              });
              if (activeAgents.length === 0) {
                return (
                  <div style={{ fontSize: 16, color: 'var(--color-text-muted)' }}>
                    No agents working
                  </div>
                );
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activeAgents.map((id) => {
                    const tools = (agentTools[id] ?? []).filter((t) => !t.done);
                    const currentTool = tools[0];
                    const name = agentNames[id] ?? agentFolderNames[id] ?? `Agent ${id}`;
                    return (
                      <div
                        key={id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          background: 'var(--color-status-active)10',
                          border: '1px solid var(--color-status-active)44',
                          borderRadius: 3,
                        }}
                      >
                        <span
                          className="pixel-pulse"
                          style={{
                            color: 'var(--color-status-active)',
                            fontSize: 16,
                            flexShrink: 0,
                          }}
                        >
                          ▶
                        </span>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                              color: 'var(--color-text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            #{id} {name}
                          </div>
                          <div
                            style={{
                              fontSize: 14,
                              color: 'var(--color-text-muted)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={currentTool?.status}
                          >
                            {currentTool ? currentTool.status : 'thinking…'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </section>

          {/* Phase progress */}
          <section>
            <div
              style={{
                fontSize: 13,
                letterSpacing: '0.12em',
                color: 'var(--color-text-muted)',
                marginBottom: 12,
                textTransform: 'uppercase',
              }}
            >
              Phase Progress
            </div>
            {phaseNames.length === 0 ? (
              <div style={{ fontSize: 16, color: 'var(--color-text-muted)' }}>
                No active project
              </div>
            ) : (
              (() => {
                const total = phaseNames.length;
                const pct =
                  total > 0
                    ? Math.min(1, (currentPhase - 1) / total + (currentPhase > 0 ? 0.5 / total : 0))
                    : 0;
                const currentName = phaseNames[currentPhase - 1] ?? `Phase ${currentPhase}`;
                return (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 18, color: 'var(--color-text)' }}>
                        {phaseGatePending ? '⏳ ' : '● '}
                        {currentName}
                      </span>
                      <span style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>
                        {currentPhase} / {total}
                        {runMode ? ` · @${runMode}` : ''}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div
                      style={{
                        height: 10,
                        background: 'var(--color-border)',
                        borderRadius: 5,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.round(pct * 100)}%`,
                          background: phaseGatePending ? '#f59e0b' : 'var(--color-accent)',
                          borderRadius: 5,
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                    {/* Phase pills */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                      {phaseNames.map((name, i) => {
                        const phNum = i + 1;
                        const done = phNum < currentPhase;
                        const active = phNum === currentPhase;
                        return (
                          <span
                            key={i}
                            style={{
                              fontSize: 13,
                              padding: '3px 9px',
                              border: `1px solid ${done ? 'var(--color-text-muted)' : active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                              color: done
                                ? 'var(--color-text-muted)'
                                : active
                                  ? 'var(--color-text)'
                                  : 'var(--color-border)',
                              borderRadius: 3,
                            }}
                          >
                            {done ? '✓ ' : active ? '● ' : ''}
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  </>
                );
              })()
            )}
          </section>

          {/* Runtime */}
          <section>
            <div
              style={{
                fontSize: 13,
                letterSpacing: '0.12em',
                color: 'var(--color-text-muted)',
                marginBottom: 12,
                textTransform: 'uppercase',
              }}
            >
              Project Runtime
            </div>
            <div
              style={{
                fontSize: 38,
                fontWeight: 'bold',
                color: 'var(--color-text)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {projectStart ? formatRuntime(projectStart, nowRef.current || Date.now()) : '—'}
            </div>
            {projectStart && (
              <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 6 }}>
                Started{' '}
                {new Date(projectStart).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            )}
          </section>

          {/* Token totals */}
          <section>
            <div
              style={{
                fontSize: 13,
                letterSpacing: '0.12em',
                color: 'var(--color-text-muted)',
                marginBottom: 12,
                textTransform: 'uppercase',
              }}
            >
              Token Usage
            </div>
            {tokenSummary.total === 0 ? (
              <div style={{ fontSize: 16, color: 'var(--color-text-muted)' }}>
                No turns completed yet
              </div>
            ) : (
              <>
                {/* Total row */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 18 }}>
                  {[
                    {
                      label: '↑ In',
                      value: tokenSummary.totalInput,
                      color: 'var(--color-text-muted)',
                    },
                    {
                      label: '↓ Out',
                      value: tokenSummary.totalOutput,
                      color: 'var(--color-status-active)',
                    },
                    { label: '∑ Total', value: tokenSummary.total, color: 'var(--color-text)' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ flex: 1 }}>
                      <div
                        style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}
                      >
                        {label}
                      </div>
                      <div
                        style={{
                          fontSize: 26,
                          fontWeight: 'bold',
                          color,
                          fontVariantNumeric: 'tabular-nums',
                          lineHeight: 1,
                        }}
                      >
                        {formatTokens(value)}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Per-agent breakdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {tokenSummary.perAgent.map(({ id, name, input, output }) => {
                    const total = input + output;
                    const pct = tokenSummary.total > 0 ? total / tokenSummary.total : 0;
                    return (
                      <div key={id}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: 4,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 15,
                              color: 'var(--color-text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '60%',
                            }}
                          >
                            {name}
                          </span>
                          <span
                            style={{
                              fontSize: 14,
                              color: 'var(--color-text-muted)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            ↑{formatTokens(input)} ↓{formatTokens(output)}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 5,
                            background: 'var(--color-border)',
                            borderRadius: 3,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.round(pct * 100)}%`,
                              background: 'var(--color-accent)',
                              borderRadius: 3,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

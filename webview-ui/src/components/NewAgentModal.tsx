import { useEffect, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { vscode } from '../vscodeApi.js';

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

export interface NewAgentConfig {
  name: string;
  task: string;
  plan: boolean;
  effort: string;
  isCeo: boolean;
  bypassPermissions: boolean;
  headless: boolean;
  folderPath: string;
}

interface NewAgentModalProps {
  workspaceFolders: WorkspaceFolder[];
  onConfirm: (config: NewAgentConfig) => void;
  onCancel: () => void;
  externalFolderPath?: string;
  ceoExists?: boolean;
}

export function NewAgentModal({ workspaceFolders, onConfirm, onCancel, externalFolderPath, ceoExists }: NewAgentModalProps) {
  const [name, setName] = useState('');
  const [task, setTask] = useState('');
  const [plan, setPlan] = useState(false);
  const [effort, setEffort] = useState('none');
  const [isCeo, setIsCeo] = useState(false);
  const [bypassPermissions, setBypassPermissions] = useState(true);
  const [headless, setHeadless] = useState(false);
  const [folderPath, setFolderPath] = useState(workspaceFolders[0]?.path ?? '');

  useEffect(() => {
    if (externalFolderPath) setFolderPath(externalFolderPath);
  }, [externalFolderPath]);

  const pickRandomName = () => {
    setName(AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)]);
  };

  const handleBrowse = () => {
    vscode.postMessage({ type: 'browseFolder', agentId: -1 });
  };

  const handleConfirm = () => {
    onConfirm({ name, task, plan, effort, isCeo, bypassPermissions, headless: isCeo ? false : headless, folderPath });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--pixel-bg)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    fontSize: 18,
    fontFamily: 'FS Pixel Sans, monospace',
    padding: '6px 10px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 16,
    color: 'var(--color-text-muted)',
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--modal-overlay-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="pixel-panel"
        style={{ width: 480, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--color-text)', marginBottom: 4 }}>
          New Agent
        </div>

        {/* Name */}
        <div>
          <label style={labelStyle}>Name</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name (optional)"
              style={{ ...inputStyle, flex: 1 }}
              autoFocus
            />
            <button
              onClick={pickRandomName}
              title="Random name"
              style={{
                background: 'none',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 16,
                padding: '4px 8px',
                flexShrink: 0,
              }}
            >
              🎲
            </button>
          </div>
        </div>

        {/* Task */}
        <div>
          <label style={labelStyle}>Task / Instructions</label>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What should this agent do?"
            rows={4}
            style={{
              ...inputStyle,
              resize: 'vertical',
              lineHeight: 1.5,
            }}
          />
        </div>

        {/* Mode */}
        <div>
          <label style={labelStyle}>Mode</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Plan toggle */}
            <button
              onClick={() => setPlan(p => !p)}
              title={plan ? 'Click to disable plan mode' : 'Click to enable plan mode'}
              style={{
                flex: 1,
                background: plan ? 'var(--color-status-active)22' : 'transparent',
                border: `1px solid ${plan ? 'var(--color-status-active)' : 'var(--color-border)'}`,
                color: plan ? 'var(--color-status-active)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 16,
                padding: '8px 0',
                fontFamily: 'FS Pixel Sans, monospace',
              }}
            >
              {plan ? '🔵 Plan' : 'Plan'}
            </button>
            {/* Effort cycler — Low / Medium / High / Max, click again to turn off */}
            {(() => {
              const active = effort !== 'none';
              const opt = EFFORT_OPTIONS.find(o => o.value === effort);
              const cycleEffort = () => {
                if (!active) { setEffort('low'); return; }
                const idx = EFFORT_VALUES.indexOf(effort as typeof EFFORT_VALUES[number]);
                const next = EFFORT_VALUES[(idx + 1) % EFFORT_VALUES.length];
                // wrap past max → turn off
                setEffort(idx === EFFORT_VALUES.length - 1 ? 'none' : next);
              };
              return (
                <button
                  onClick={cycleEffort}
                  title={active ? `${opt!.label} — click to change, click past Max to turn off` : 'Click to set effort level'}
                  style={{
                    flex: 1,
                    background: active ? `${opt!.color}22` : 'transparent',
                    border: `1px solid ${active ? opt!.color : 'var(--color-border)'}`,
                    color: active ? opt!.color : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    fontSize: 16,
                    padding: '8px 0',
                    fontFamily: 'FS Pixel Sans, monospace',
                  }}
                >
                  {active ? opt!.label : 'Effort'}
                </button>
              );
            })()}
          </div>
        </div>

        {/* Folder */}
        <div>
          <label style={labelStyle}>Working Folder</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder={workspaceFolders[0]?.path ?? '/path/to/project'}
              style={{ ...inputStyle, flex: 1 }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) {
                  // In Electron/VS Code webview, file.path is available
                  const p = (file as File & { path?: string }).path ?? file.name;
                  setFolderPath(p);
                }
              }}
            />
            <button
              onClick={handleBrowse}
              title="Browse for folder"
              style={{
                background: 'none',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 14,
                padding: '6px 12px',
                flexShrink: 0,
                fontFamily: 'FS Pixel Sans, monospace',
                whiteSpace: 'nowrap',
              }}
            >
              📁 Browse
            </button>
          </div>
        </div>

        {/* Options row */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { checked: bypassPermissions, set: setBypassPermissions, label: 'Skip permissions', disabled: false },
            { checked: headless, set: setHeadless, label: 'Headless (no terminal)', disabled: isCeo },
          ].map(({ checked, set, label, disabled }) => (
            <label
              key={label}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                border: `1px solid ${checked && !disabled ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: checked && !disabled ? 'var(--color-accent)11' : 'transparent',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                fontSize: 13,
                color: checked && !disabled ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontFamily: 'FS Pixel Sans, monospace',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={disabled ? false : checked}
                disabled={disabled}
                onChange={() => !disabled && set(v => !v)}
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
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '10px 12px',
            border: `1px solid ${isCeo ? 'var(--color-accent)' : 'var(--color-border)'}`,
            background: isCeo ? 'var(--color-accent)11' : 'transparent',
            cursor: ceoExists && !isCeo ? 'not-allowed' : 'pointer',
            opacity: ceoExists && !isCeo ? 0.5 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={isCeo}
            disabled={ceoExists && !isCeo}
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
                : 'Always-on supervisor. Immune to restarts. Writes session log to CLAUDE.md if terminal closes, then auto-relaunches. Cannot be removed except from the UI.'}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 18,
              padding: '8px 0',
              fontFamily: 'FS Pixel Sans, monospace',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              flex: 2,
              background: 'var(--color-accent)',
              border: 'none',
              color: 'var(--pixel-bg)',
              cursor: 'pointer',
              fontSize: 18,
              fontWeight: 'bold',
              padding: '8px 0',
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

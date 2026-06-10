import { useState } from 'react';

import type { FleetState } from '../hooks/useExtensionMessages.js';
import { vscode } from '../vscodeApi.js';

/**
 * FleetPanel — live view of a claude-brain vault's fleet tree.
 * Rendered only when the backend is watching a vault (PIXEL_AGENTS_VAULT_ROOT).
 * Read-only: shows board rows, phase/gate state, pending inbox briefs, drift.
 */

const STATUS_COLORS: Record<string, string> = {
  'IN PROGRESS': 'var(--color-status-active)',
  'TO DO': 'var(--color-text-muted)',
  BLOCKED: 'var(--color-status-error)',
  'ON HOLD': 'var(--color-warning)',
  'IN REVIEW': 'var(--color-accent)',
  DONE: 'var(--color-status-success)',
  CANCELLED: 'var(--color-text-muted)',
};

interface FleetPanelProps {
  state: FleetState;
  lastError?: string | null;
}

export function FleetPanel({ state, lastError }: FleetPanelProps) {
  const [open, setOpen] = useState(false);
  const [spawning, setSpawning] = useState<Set<string>>(new Set());

  const briefCount = Object.values(state.inboxes).reduce((n, v) => n + v.length, 0);
  const gateOpen = state.projects.some((p) => (p.gate ?? p.boardGate) === 'awaiting-approval');

  const spawnBrief = (agent: string, brief: string) => {
    const key = `${agent}/${brief}`;
    if (spawning.has(key)) return;
    vscode.postMessage({ type: 'spawnFromBrief', agent, brief });
    setSpawning((prev) => new Set(prev).add(key));
    setTimeout(() => {
      setSpawning((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 5000);
  };

  return (
    <>
      {/* Toggle button */}
      <button
        className="pixel-panel"
        onClick={() => setOpen((v) => !v)}
        title={`Vault fleet — ${state.vaultRoot}`}
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 150,
          padding: '6px 10px',
          fontSize: 11,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>⛁ Fleet</span>
        {state.activeProjects.length > 0 && (
          <span style={{ color: 'var(--color-status-active)' }}>{state.activeProjects.length}</span>
        )}
        {briefCount > 0 && <span style={{ color: 'var(--color-warning)' }}>✉ {briefCount}</span>}
        {gateOpen && <span style={{ color: 'var(--color-status-error)' }}>● gate</span>}
        {state.drift.length > 0 && (
          <span style={{ color: 'var(--color-status-error)' }}>⚠ {state.drift.length}</span>
        )}
      </button>

      {open && (
        <div
          className="pixel-panel"
          style={{
            position: 'absolute',
            top: 48,
            left: 12,
            zIndex: 150,
            width: 420,
            maxHeight: '70vh',
            overflowY: 'auto',
            padding: 12,
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong>Vault fleet</strong>
            <span style={{ opacity: 0.6 }}>board updated {state.boardUpdated ?? '?'}</span>
          </div>

          {lastError && (
            <div style={{ color: 'var(--color-status-error)', marginBottom: 8 }}>✖ {lastError}</div>
          )}

          {state.drift.length > 0 && (
            <div style={{ color: 'var(--color-status-error)', marginBottom: 8 }}>
              {state.drift.map((d, i) => (
                <div key={i}>⚠ {d}</div>
              ))}
            </div>
          )}

          {state.projects.map((p) => {
            const phase = p.phase ?? p.boardPhase;
            const gate = p.gate ?? p.boardGate;
            const activePlan =
              p.plans.find((pl) => phase !== null && pl.title.startsWith(`Phase ${phase} `)) ??
              p.plans[p.plans.length - 1];
            return (
              <div key={p.slug} style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>{p.slug}</strong>{' '}
                  <span style={{ opacity: 0.8 }}>
                    {phase !== null ? `Phase ${phase}` : ''}
                    {p.phaseName ? ` — ${p.phaseName}` : ''}
                  </span>{' '}
                  {gate && (
                    <span
                      style={{
                        color:
                          gate === 'awaiting-approval'
                            ? 'var(--color-status-error)'
                            : 'var(--color-status-success)',
                      }}
                    >
                      gate: {gate}
                    </span>
                  )}
                </div>

                {p.rows.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {p.rows.map((r, i) => (
                        <tr key={i}>
                          <td
                            style={{
                              padding: '1px 6px 1px 0',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'top',
                            }}
                          >
                            {r.agent}
                          </td>
                          <td
                            style={{
                              padding: '1px 6px 1px 0',
                              opacity: 0.75,
                              verticalAlign: 'top',
                            }}
                          >
                            {r.task.length > 60 ? r.task.slice(0, 60) + '…' : r.task}
                          </td>
                          <td
                            style={{
                              padding: '1px 0',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'top',
                              color: STATUS_COLORS[r.status.toUpperCase()] ?? 'var(--color-text)',
                            }}
                          >
                            {r.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {activePlan && activePlan.items.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ opacity: 0.6 }}>{activePlan.title}</div>
                    {activePlan.items.map((it, i) => (
                      <div key={i} style={{ opacity: it.done ? 0.5 : 1 }}>
                        {it.done ? '☑' : '☐'}{' '}
                        {it.text.length > 70 ? it.text.slice(0, 70) + '…' : it.text}
                      </div>
                    ))}
                  </div>
                )}

                {p.blockers &&
                  p.blockers.toLowerCase() !== 'none.' &&
                  p.blockers.toLowerCase() !== 'none' && (
                    <div style={{ color: 'var(--color-status-error)', marginTop: 2 }}>
                      Blockers: {p.blockers}
                    </div>
                  )}
                {p.nextGate && (
                  <div style={{ opacity: 0.7, marginTop: 2 }}>Next gate: {p.nextGate}</div>
                )}
              </div>
            );
          })}

          {Object.keys(state.inboxes).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <strong>Pending briefs</strong>
              {Object.entries(state.inboxes).flatMap(([agent, briefs]) =>
                briefs.map((brief) => (
                  <div
                    key={`${agent}/${brief}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ✉ {agent}: {brief}
                    </span>
                    <button
                      className="pixel-panel"
                      disabled={spawning.has(`${agent}/${brief}`)}
                      title={`Spawn ${agent} headless in the vault with: "Execute the brief at fleet/${agent}/inbox/${brief}"`}
                      style={{
                        padding: '1px 6px',
                        fontSize: 10,
                        cursor: spawning.has(`${agent}/${brief}`) ? 'default' : 'pointer',
                        opacity: spawning.has(`${agent}/${brief}`) ? 0.5 : 1,
                        flexShrink: 0,
                      }}
                      onClick={() => spawnBrief(agent, brief)}
                    >
                      {spawning.has(`${agent}/${brief}`) ? '… spawning' : '▶ spawn'}
                    </button>
                  </div>
                )),
              )}
            </div>
          )}

          {state.handoffs.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <strong>Recent handoffs</strong>
              {state.handoffs.slice(0, 8).map((h) => (
                <div
                  key={`${h.project}/${h.file}`}
                  title={`${h.project}/handoffs/${h.file}`}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    opacity: 0.85,
                  }}
                >
                  {h.from} → {h.to} · {h.topic} ·{' '}
                  {Math.max(0, Math.round((state.generatedAt - h.mtime) / 60000))}m ago
                </div>
              ))}
            </div>
          )}

          {state.idleRoster.length > 0 && (
            <div style={{ opacity: 0.6 }}>Idle: {state.idleRoster.join(' · ')}</div>
          )}
        </div>
      )}
    </>
  );
}

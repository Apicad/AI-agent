import { useState } from 'react';

export interface AgentSummary {
  agent: string;
  content: string;
}

interface PhaseReviewModalProps {
  isOpen: boolean;
  project: string;
  phase: number;
  summaries: AgentSummary[];
  ceoAgentId: number | null;
  onSendToCeo: (agentId: number, message: string) => void;
  onDismiss: () => void;
}

type ResponseMode = 'approved' | 'approved-with-notes' | 'revise' | 'reject' | null;

export function PhaseReviewModal({
  isOpen,
  project,
  phase,
  summaries,
  ceoAgentId,
  onSendToCeo,
  onDismiss,
}: PhaseReviewModalProps) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [responseMode, setResponseMode] = useState<ResponseMode>(null);
  const [responseText, setResponseText] = useState('');

  if (!isOpen) return null;

  const toggleAgent = (name: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const summaryText =
    summaries.length > 0
      ? summaries.map((s) => `--- ${s.agent} ---\n${s.content}`).join('\n\n')
      : '(No PROGRESS.md files found for this project)';

  const buildNextStepLine = (mode: ResponseMode, text: string) => {
    switch (mode) {
      case 'approved':
        return `Dispatch Phase ${phase + 1} tasks to all relevant agents now.`;
      case 'approved-with-notes':
        return `Dispatch Phase ${phase + 1} tasks. Embed these notes in each agent's task message:\n${text}`;
      case 'revise':
        return `Send the revision reason to the Scrum Master. Re-dispatch affected agents. Do NOT advance to Phase ${phase + 1} until the revision is resolved.`;
      case 'reject':
        return `Halt the project. Write the rejection reason to PHASE-LEDGER.md. Await CEO direction before any further work.`;
      default:
        return '';
    }
  };

  const buildCeoResponseLine = (mode: ResponseMode, text: string) => {
    switch (mode) {
      case 'approved': return 'APPROVED';
      case 'approved-with-notes': return `APPROVED WITH NOTES:\n${text}`;
      case 'revise': return `REVISE: ${text}`;
      case 'reject': return `REJECT: ${text}`;
      default: return '';
    }
  };

  const handleSend = (mode: ResponseMode) => {
    if (!ceoAgentId) {
      alert('No CEO agent is running. Launch a CEO agent first, then try again.');
      return;
    }
    const ceoResponse = buildCeoResponseLine(mode, responseText.trim());
    const nextStep = buildNextStepLine(mode, responseText.trim());

    const message =
      `PHASE ${phase} GATE — ${mode === 'approved' ? 'APPROVED' : mode === 'approved-with-notes' ? 'APPROVED WITH NOTES' : mode === 'revise' ? 'REVISE' : 'REJECT'}\n` +
      `Project: ${project || '(unnamed)'}\n\n` +
      `=== Deliverables ===\n${summaryText}\n\n` +
      `=== CEO Response ===\n${ceoResponse}\n\n` +
      `=== Next Step ===\n${nextStep}`;

    onSendToCeo(ceoAgentId, message);
    setResponseMode(null);
    setResponseText('');
    onDismiss();
  };

  const needsText = responseMode === 'approved-with-notes' || responseMode === 'revise' || responseMode === 'reject';
  const canSend = responseMode === 'approved' || (needsText && responseText.trim().length > 0);

  const allExpanded = summaries.length > 0 && summaries.every((s) => expandedAgents.has(s.agent));
  const toggleAll = () => {
    if (allExpanded) setExpandedAgents(new Set());
    else setExpandedAgents(new Set(summaries.map((s) => s.agent)));
  };

  const responseBtns: Array<{ mode: ResponseMode; label: string; color: string; bg: string; border: string }> = [
    { mode: 'approved',            label: '✓ APPROVED',            color: '#fff',    bg: '#16a34a', border: '#16a34a' },
    { mode: 'approved-with-notes', label: '✓ APPROVED WITH NOTES', color: '#fff',    bg: '#2563eb', border: '#2563eb' },
    { mode: 'revise',              label: '↩ REVISE',              color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: '#f97316' },
    { mode: 'reject',              label: '✕ REJECT',              color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: '#ef4444' },
  ];

  const textareaPlaceholders: Partial<Record<NonNullable<ResponseMode>, string>> = {
    'approved-with-notes': 'Notes for agents in the next phase (e.g. "Use WCAG AA contrast. Keep nav sticky.")',
    'revise': 'What should be changed before proceeding? (required)',
    'reject': 'Reason for rejection (required)',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)',
      }}
    >
      <div
        style={{
          background: '#0f172a',
          border: '2px solid #3b82f6',
          width: 680,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'monospace',
          boxShadow: '0 0 40px rgba(59,130,246,0.3)',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(90deg, #1d4ed8, #3b82f6)',
            padding: '14px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }}>
              ◆ Phase {phase} Gate
            </span>
            {project && (
              <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
                {project}
              </span>
            )}
          </div>
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.7)',
              fontSize: 22,
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '18px 20px' }}>
          {/* Agent Output Section */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  color: '#f59e0b',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                Deliverables
              </span>
              {summaries.length > 1 && (
                <button
                  onClick={toggleAll}
                  style={{
                    background: 'none',
                    border: '1px solid #374151',
                    color: '#6b7280',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: '2px 8px',
                    fontFamily: 'monospace',
                  }}
                >
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>
            {summaries.length === 0 ? (
              <div
                style={{
                  color: '#9ca3af',
                  fontSize: 12,
                  padding: '14px 16px',
                  border: '1px dashed #374151',
                  borderRadius: 3,
                  background: 'rgba(31, 41, 55, 0.3)',
                  lineHeight: 1.6,
                }}
              >
                <div style={{ color: '#fbbf24', fontWeight: 700, marginBottom: 6 }}>
                  ⚠ No PROGRESS.md files attached to this gate
                </div>
                <div>
                  Either workers haven't written their progress logs yet, OR the files
                  live outside the search paths. The CLI looks for PROGRESS.md in:
                </div>
                <div style={{ marginTop: 8, color: '#60a5fa', fontFamily: 'monospace', fontSize: 11 }}>
                  ~/CEO-Agent-Claude/projects/{project || '<name>'}/&lt;agent&gt;-WORKER/PROGRESS.md<br />
                  ~/Automation/{project || '<name>'}/phase{phase}/&lt;agent&gt;-WORKER/PROGRESS.md<br />
                  ~/Automation/{project || '<name>'}/phase{phase}-revise/&lt;agent&gt;-WORKER/PROGRESS.md<br />
                  ~/Automation/{project || '<name>'}/phase{phase}-revise2/&lt;agent&gt;-WORKER/PROGRESS.md
                </div>
                <div style={{ marginTop: 8 }}>
                  Verify on disk before approving — or click <strong>Dismiss</strong> and
                  inspect the workspace, then re-trigger via{' '}
                  <code style={{ color: '#60a5fa' }}>phase done --project {project || '<name>'}</code>.
                </div>
              </div>
            ) : (
              summaries.map((s) => (
                <div
                  key={s.agent}
                  style={{ border: '1px solid #1e3a5f', marginBottom: 8, borderRadius: 2 }}
                >
                  <div
                    onClick={() => toggleAgent(s.agent)}
                    style={{
                      padding: '9px 14px',
                      background: '#111827',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ color: '#60a5fa', fontSize: 13, fontWeight: 600 }}>
                      {s.agent}
                    </span>
                    <span style={{ color: '#4b5563', fontSize: 11 }}>
                      {expandedAgents.has(s.agent) ? '▲' : '▼'}
                    </span>
                  </div>
                  {expandedAgents.has(s.agent) && (
                    <pre
                      style={{
                        margin: 0,
                        padding: '12px 14px',
                        color: '#d1d5db',
                        fontSize: 12,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        background: '#080e1a',
                        maxHeight: 220,
                        overflow: 'auto',
                        borderTop: '1px solid #1e3a5f',
                      }}
                    >
                      {s.content}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Response Section */}
          <div>
            <div
              style={{
                color: '#f59e0b',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              CEO Decision
            </div>

            {/* Response buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {responseBtns.map(({ mode, label, color, bg, border }) => (
                <button
                  key={mode}
                  onClick={() => {
                    if (mode === 'approved') {
                      handleSend('approved');
                    } else {
                      setResponseMode(responseMode === mode ? null : mode);
                      setResponseText('');
                    }
                  }}
                  style={{
                    padding: '8px 14px',
                    background: responseMode === mode ? bg : 'transparent',
                    border: `2px solid ${border}`,
                    color: responseMode === mode ? color : border,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    transition: 'all 0.15s',
                    opacity: !ceoAgentId ? 0.5 : 1,
                  }}
                  disabled={!ceoAgentId}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Notes textarea (only for modes that need text) */}
            {responseMode && responseMode !== 'approved' && (
              <div style={{
                marginTop: 4,
                padding: 12,
                background: '#080e1a',
                border: `2px solid ${
                  responseMode === 'approved-with-notes' ? '#2563eb'
                  : responseMode === 'revise' ? '#f97316'
                  : '#ef4444'
                }`,
                borderRadius: 4,
              }}>
                {/* Heading so the input area is unambiguous */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 8,
                }}>
                  <label style={{
                    color: responseMode === 'approved-with-notes' ? '#60a5fa'
                         : responseMode === 'revise' ? '#fb923c'
                         : '#fca5a5',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}>
                    {responseMode === 'approved-with-notes' ? '✎ Notes — embedded in next phase agent prompts'
                      : responseMode === 'revise' ? '✎ What needs to change (required)'
                      : '✎ Reason for rejection (required)'}
                  </label>
                  <span style={{ color: '#4b5563', fontSize: 11 }}>
                    {responseText.length} chars · ⌘⏎ to send
                  </span>
                </div>
                <textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  onKeyDown={(e) => {
                    // ⌘⏎ / Ctrl⏎ to send
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSend) {
                      e.preventDefault();
                      handleSend(responseMode);
                    }
                  }}
                  placeholder={textareaPlaceholders[responseMode] ?? ''}
                  autoFocus
                  style={{
                    width: '100%',
                    minHeight: 140,
                    background: '#0f172a',
                    border: '1px solid #1e3a5f',
                    color: '#e5e7eb',
                    padding: '12px 14px',
                    fontSize: 13,
                    fontFamily: 'monospace',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    outline: 'none',
                    lineHeight: 1.6,
                    borderRadius: 3,
                  }}
                />
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 10,
                }}>
                  <span style={{ color: '#6b7280', fontSize: 11 }}>
                    {responseMode === 'approved-with-notes'
                      ? 'Tip: bullets work great. Each line is preserved verbatim.'
                      : responseMode === 'revise'
                      ? 'Be specific — file paths + symptoms + exact fixes work best.'
                      : 'Project will halt and await CEO direction.'}
                  </span>
                  <button
                    onClick={() => handleSend(responseMode)}
                    disabled={!canSend}
                    style={{
                      padding: '10px 26px',
                      background: canSend
                        ? (responseMode === 'approved-with-notes' ? '#2563eb'
                           : responseMode === 'revise' ? 'rgba(249,115,22,0.2)'
                           : 'rgba(239,68,68,0.15)')
                        : '#1e3a5f',
                      border: canSend
                        ? `2px solid ${responseMode === 'approved-with-notes' ? '#3b82f6' : responseMode === 'revise' ? '#f97316' : '#ef4444'}`
                        : '2px solid #1e3a5f',
                      color: canSend
                        ? (responseMode === 'approved-with-notes' ? '#fff' : responseMode === 'revise' ? '#f97316' : '#ef4444')
                        : '#4b5563',
                      cursor: canSend ? 'pointer' : 'not-allowed',
                      fontSize: 13,
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      letterSpacing: 0.5,
                    }}
                  >
                    Send to CEO →
                  </button>
                </div>
              </div>
            )}

            {!ceoAgentId && (
              <div
                style={{
                  marginTop: 8,
                  color: '#ef4444',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                ⚠ No CEO agent running — launch one first to send feedback
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #1e3a5f',
            display: 'flex',
            justifyContent: 'flex-end',
            background: '#080e1a',
          }}
        >
          <button
            onClick={onDismiss}
            style={{
              padding: '7px 20px',
              background: 'transparent',
              border: '1px solid #374151',
              color: '#6b7280',
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'monospace',
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

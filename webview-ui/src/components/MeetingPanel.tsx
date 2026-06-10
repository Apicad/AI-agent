import { useEffect, useRef, useState } from 'react';

import type { ChatMessage } from '../hooks/useExtensionMessages.js';

interface MeetingMessage extends ChatMessage {
  agentId?: number;
  agentLabel: string;
}

interface MeetingPanelProps {
  topic: string;
  agents: number[];
  agentNames: Record<number, string>;
  agentMessages: Record<number, ChatMessage[]>;
  sentMessages: Record<number, ChatMessage[]>;
  onEndMeeting: () => void;
  onBroadcast: (message: string) => void;
}

export function MeetingPanel({
  topic,
  agents,
  agentNames,
  agentMessages,
  sentMessages,
  onEndMeeting,
  onBroadcast,
}: MeetingPanelProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Merge all agent messages + broadcast (user) messages into a unified feed
  const allMessages: MeetingMessage[] = [];

  // Agent responses
  for (const id of agents) {
    const label = agentNames[id] || `Agent ${id}`;
    for (const m of agentMessages[id] ?? []) {
      allMessages.push({ ...m, agentId: id, agentLabel: label });
    }
  }

  // User-sent broadcasts (stored under agent 0 sentinel or in sentMessages[0])
  for (const m of sentMessages[0] ?? []) {
    allMessages.push({ ...m, agentLabel: 'You (broadcast)' });
  }

  allMessages.sort((a, b) => a.ts - b.ts);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length]);

  const send = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    onBroadcast(msg);
  };

  return (
    <div
      className="pixel-panel"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 76,
        transform: 'translateX(-50%)',
        width: 440,
        maxHeight: 380,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: '2px solid var(--color-border)',
          flexShrink: 0,
          background: 'var(--color-bg-dark)',
        }}
      >
        <span style={{ fontSize: 18, flexShrink: 0 }}>🏢</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--color-text)' }}>
            Team Meeting
          </div>
          {topic && (
            <div
              style={{
                fontSize: 14,
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {topic}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {agents.length} agent{agents.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={onEndMeeting}
            style={{
              background: 'none',
              border: '1px solid var(--color-status-permission)',
              color: 'var(--color-status-permission)',
              cursor: 'pointer',
              fontSize: 13,
              padding: '2px 8px',
              lineHeight: 1.4,
            }}
          >
            End Meeting
          </button>
        </div>
      </div>

      {/* Message feed */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {allMessages.length === 0 ? (
          <div
            style={{
              fontSize: 16,
              color: 'var(--color-text-muted)',
              textAlign: 'center',
              paddingTop: 12,
            }}
          >
            Waiting for agents to respond...
          </div>
        ) : (
          allMessages.map((m, i) => {
            const isUser = m.role === 'user';
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: isUser ? 'var(--color-accent-bright)' : 'var(--color-status-active)',
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  {m.agentLabel}
                </span>
                <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  <span
                    style={{
                      fontSize: 15,
                      lineHeight: 1.45,
                      color: 'var(--color-text)',
                      background: isUser ? 'var(--color-active-bg)' : 'var(--color-bg-dark)',
                      border: `1px solid ${isUser ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      padding: '4px 8px',
                      maxWidth: '88%',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.text}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Broadcast input */}
      <div
        style={{
          borderTop: '1px solid var(--color-border)',
          padding: '6px 10px',
          display: 'flex',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Send to all agents..."
          style={{
            flex: 1,
            background: 'transparent',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            fontSize: 14,
            padding: '3px 8px',
            outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim()}
          style={{
            background: 'var(--color-accent)',
            border: 'none',
            color: 'white',
            cursor: input.trim() ? 'pointer' : 'default',
            fontSize: 14,
            padding: '3px 10px',
            opacity: input.trim() ? 1 : 0.4,
          }}
        >
          Send All
        </button>
      </div>
    </div>
  );
}

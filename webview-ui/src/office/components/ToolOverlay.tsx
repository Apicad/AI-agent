import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import { CHARACTER_SITTING_OFFSET_PX, TOOL_OVERLAY_VERTICAL_OFFSET } from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

/** Map tool name to an activity icon emoji */
function getActivityIcon(toolName: string | null): string {
  if (!toolName) return '';
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) return '✏️';
  if (['Read'].includes(toolName)) return '📖';
  if (['Grep', 'Glob'].includes(toolName)) return '🔍';
  if (['Bash'].includes(toolName)) return '⚡';
  if (['WebFetch', 'WebSearch'].includes(toolName)) return '🌐';
  if (['Task', 'Agent'].includes(toolName)) return '🤖';
  return '🔧';
}

/** Return a mode badge label + color, or null for default */
function getModeBadge(mode?: string): { label: string; color: string } | null {
  if (mode === 'planner') return { label: 'PLAN', color: 'var(--color-status-active)' };
  if (mode === 'automation') return { label: 'AUTO', color: 'var(--color-status-success)' };
  if (mode === 'liberty') return { label: 'FREE', color: 'var(--color-status-permission)' };
  return null;
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return 'Idle';
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;

        // Only show for hovered or selected agents (unless always-show is on)
        if (!alwaysShowOverlay && !isSelected && !isHovered) return null;

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        let activityText: string;
        if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            const sub = subagentCharacters.find((s) => s.id === id);
            activityText = sub ? sub.label : 'Subtask';
          }
        } else {
          activityText = getActivityText(id, agentTools, ch.isActive);
        }

        // Determine dot color
        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;

        let dotColor: string | null = null;
        if (hasPermission) {
          dotColor = 'var(--color-status-permission)';
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--color-status-active)';
        }

        const modeBadge = isSub ? null : getModeBadge(ch.mode);
        return (
          <div
            key={id}
            className="absolute flex flex-col items-center -translate-x-1/2"
            style={{
              left: screenX,
              top: screenY - (ch.customName && ch.folderName ? 44 : (ch.customName || ch.folderName || modeBadge) ? 36 : 28),
              pointerEvents: isSelected ? 'auto' : 'none',
              opacity: alwaysShowOverlay && !isSelected && !isHovered ? (isSub ? 0.5 : 0.75) : 1,
              zIndex: isSelected ? 42 : 41,
            }}
          >
            <div className="flex items-center border-border px-8 pt-2 pb-4 gap-5 pixel-panel whitespace-nowrap max-w-2xs">
              {dotColor && (
                <span
                  className={`w-6 h-6 rounded-full shrink-0 ${isActive && !hasPermission ? 'pixel-pulse' : ''}`}
                  style={{ background: dotColor }}
                />
              )}
              <div className="flex flex-col gap-0 overflow-hidden">
                {ch.customName && !isSub && (
                  <div className="flex items-center gap-4 leading-none">
                    <span
                      className="font-bold overflow-hidden text-ellipsis"
                      style={{ fontSize: '20px' }}
                    >
                      {ch.customName}
                    </span>
                    {modeBadge && (
                      <span style={{
                        fontSize: '11px',
                        color: modeBadge.color,
                        border: `1px solid ${modeBadge.color}`,
                        padding: '0 3px',
                        flexShrink: 0,
                        lineHeight: 1.4,
                      }}>
                        {modeBadge.label}
                      </span>
                    )}
                  </div>
                )}
                {!ch.customName && modeBadge && (
                  <span style={{
                    fontSize: '11px',
                    color: modeBadge.color,
                    border: `1px solid ${modeBadge.color}`,
                    padding: '0 3px',
                    alignSelf: 'flex-start',
                    marginBottom: 2,
                    lineHeight: 1.4,
                  }}>
                    {modeBadge.label}
                  </span>
                )}
                <div className="flex items-center gap-3 leading-none overflow-hidden">
                  {!isSub && getActivityIcon(ch.currentTool) && (
                    <span style={{ fontSize: ch.customName ? '14px' : '16px', flexShrink: 0 }}>
                      {getActivityIcon(ch.currentTool)}
                    </span>
                  )}
                  <span
                    className="overflow-hidden text-ellipsis block"
                    style={{
                      fontSize: isSub ? '20px' : ch.customName ? '18px' : '22px',
                      fontStyle: isSub ? 'italic' : undefined,
                    }}
                  >
                    {activityText}
                  </span>
                </div>
                {ch.folderName && (
                  <span className="text-2xs leading-none overflow-hidden text-ellipsis block">
                    {ch.folderName}
                  </span>
                )}
              </div>
              {isSelected && !isSub && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  className="ml-2 shrink-0 leading-none"
                >
                  ×
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

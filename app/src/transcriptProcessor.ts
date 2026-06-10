import * as fs from 'fs';
import * as path from 'path';

const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

// Timing constants (inlined to avoid cross-package imports at runtime)
const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;
const TOOL_DONE_DELAY_MS = 300;
const TEXT_IDLE_DELAY_MS = 5000;
const PERMISSION_TIMER_DELAY_MS = 7000;

import type { StandaloneAgent } from './types.js';
import { recordTurnComplete } from './agentHistoryStore.js';

export type BroadcastFn = (msg: object) => void;

const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'Agent', 'AskUserQuestion']);

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':
      return `Reading ${base(input.file_path)}`;
    case 'Edit':
      return `Editing ${base(input.file_path)}`;
    case 'Write':
      return `Writing ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'Glob':
      return 'Searching files';
    case 'Grep':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task':
    case 'Agent': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    case 'EnterPlanMode':
      return 'Planning';
    case 'NotebookEdit':
      return 'Editing notebook';
    default:
      return `Using ${toolName}`;
  }
}

function cancelWaitingTimer(
  agentId: number,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
  const timer = waitingTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    waitingTimers.delete(agentId);
  }
}

function cancelPermissionTimer(
  agentId: number,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
  const timer = permissionTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    permissionTimers.delete(agentId);
  }
}

function startWaitingTimer(
  agentId: number,
  delayMs: number,
  agents: Map<number, StandaloneAgent>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  broadcast: BroadcastFn,
): void {
  cancelWaitingTimer(agentId, waitingTimers);
  const timer = setTimeout(() => {
    waitingTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) { broadcast({ type: 'agentStatus', id: agentId, status: 'waiting' }); return; }
    agent.isWaiting = true;
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
  }, delayMs);
  waitingTimers.set(agentId, timer);
}

function startPermissionTimer(
  agentId: number,
  agents: Map<number, StandaloneAgent>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  broadcast: BroadcastFn,
): void {
  cancelPermissionTimer(agentId, permissionTimers);
  const timer = setTimeout(() => {
    permissionTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) return;

    let hasNonExempt = false;
    for (const toolId of agent.activeToolIds) {
      const toolName = agent.activeToolNames.get(toolId);
      if (!PERMISSION_EXEMPT_TOOLS.has(toolName || '')) {
        hasNonExempt = true;
        break;
      }
    }

    const stuckSubagentParentToolIds: string[] = [];
    for (const [parentToolId, subToolNames] of agent.activeSubagentToolNames) {
      for (const [, toolName] of subToolNames) {
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          stuckSubagentParentToolIds.push(parentToolId);
          hasNonExempt = true;
          break;
        }
      }
    }

    if (hasNonExempt) {
      agent.permissionSent = true;
      console.log(`[Pixel Agents] Timer: Agent ${agentId} - possible permission wait detected`);
      broadcast({ type: 'agentToolPermission', id: agentId });
      for (const parentToolId of stuckSubagentParentToolIds) {
        broadcast({ type: 'subagentToolPermission', id: agentId, parentToolId });
      }
    }
  }, PERMISSION_TIMER_DELAY_MS);
  permissionTimers.set(agentId, timer);
}

function clearAgentActivity(
  agent: StandaloneAgent,
  agentId: number,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  broadcast: BroadcastFn,
): void {
  if (agent.backgroundAgentToolIds.size > 0) {
    for (const toolId of agent.activeToolIds) {
      if (agent.backgroundAgentToolIds.has(toolId)) continue;
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      const toolName = agent.activeToolNames.get(toolId);
      agent.activeToolNames.delete(toolId);
      if (toolName === 'Task' || toolName === 'Agent') {
        agent.activeSubagentToolIds.delete(toolId);
        agent.activeSubagentToolNames.delete(toolId);
      }
    }
  } else {
    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    agent.activeSubagentToolIds.clear();
    agent.activeSubagentToolNames.clear();
  }
  agent.isWaiting = false;
  agent.permissionSent = false;
  agent.turnStartAt = Date.now();
  agent.turnInputTokens = 0;
  agent.turnOutputTokens = 0;
  cancelPermissionTimer(agentId, permissionTimers);
  broadcast({ type: 'agentToolsClear', id: agentId });
  for (const toolId of agent.backgroundAgentToolIds) {
    const status = agent.activeToolStatuses.get(toolId);
    if (status) broadcast({ type: 'agentToolStart', id: agentId, toolId, status });
  }
  broadcast({ type: 'agentStatus', id: agentId, status: 'active' });
}

export function processTranscriptLine(
  agentId: number,
  line: string,
  agents: Map<number, StandaloneAgent>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  broadcast: BroadcastFn,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.lastDataAt = Date.now();
  agent.linesProcessed++;

  try {
    const record = JSON.parse(line);
    const assistantContent = record.message?.content ?? record.content;

    // Accumulate token usage from every assistant message
    if (record.type === 'assistant' && record.message?.usage) {
      const u = record.message.usage as { input_tokens?: number; output_tokens?: number };
      if (u.input_tokens) agent.turnInputTokens = (agent.turnInputTokens || 0) + u.input_tokens;
      if (u.output_tokens) agent.turnOutputTokens = (agent.turnOutputTokens || 0) + u.output_tokens;
    }

    if (record.type === 'assistant' && Array.isArray(assistantContent)) {
      const blocks = assistantContent as Array<{
        type: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      const hasToolUse = blocks.some((b) => b.type === 'tool_use');

      // Pillar D3 — Any non-empty assistant record is proof of activity. Emit `active`
      // unconditionally if the agent is currently in `waiting` so the activity bar shows
      // even when PreToolUse hooks miss (text-only turns, race-condition gaps, or hook
      // delivery delays). The downstream tool_use branch may emit again — broadcasts are
      // idempotent so this is safe. Skip if blocks is empty (no content = no signal).
      if (blocks.length > 0 && agent.isWaiting) {
        agent.isWaiting = false;
        broadcast({ type: 'agentStatus', id: agentId, status: 'active' });
      }

      if (hasToolUse) {
        cancelWaitingTimer(agentId, waitingTimers);
        agent.isWaiting = false;
        agent.hadToolsInTurn = true;
        broadcast({ type: 'agentStatus', id: agentId, status: 'active' });
        let hasNonExemptTool = false;
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id) {
            const toolName = block.name || '';
            const status = formatToolStatus(toolName, block.input || {});
            if (debug) console.log(`[Pixel Agents] JSONL: Agent ${agentId} - tool start: ${block.id} ${status}`);
            agent.activeToolIds.add(block.id);
            agent.activeToolStatuses.set(block.id, status);
            agent.activeToolNames.set(block.id, toolName);
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExemptTool = true;
            const isAgentTool = toolName === 'Task' || toolName === 'Agent';
            if (!agent.hookDelivered || isAgentTool) {
              broadcast({
                type: 'agentToolStart',
                id: agentId,
                toolId: block.id,
                status,
                toolName,
                permissionActive: agent.permissionSent,
              });
            }
          }
        }
        if (hasNonExemptTool && !agent.hookDelivered) {
          startPermissionTimer(agentId, agents, permissionTimers, broadcast);
        }
      } else if (blocks.some((b) => b.type === 'text') && !agent.hadToolsInTurn) {
        if (!agent.hookDelivered) {
          startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, broadcast);
        }
        const text = (blocks as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('');
        if (text) broadcast({ type: 'agentTextOutput', id: agentId, text });
      }
    } else if (record.type === 'assistant' && typeof assistantContent === 'string') {
      if (!agent.hadToolsInTurn && !agent.hookDelivered) {
        startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, broadcast);
      }
      if (assistantContent) broadcast({ type: 'agentTextOutput', id: agentId, text: assistantContent });
    } else if (record.type === 'progress') {
      processProgressRecord(agentId, record, agents, permissionTimers, broadcast);
    } else if (record.type === 'user') {
      const content = record.message?.content ?? record.content;
      if (Array.isArray(content)) {
        const blocks = content as Array<{ type: string; tool_use_id?: string }>;
        const hasToolResult = blocks.some((b) => b.type === 'tool_result');
        if (hasToolResult) {
          for (const block of blocks) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const completedToolId = block.tool_use_id;
              const completedToolName = agent.activeToolNames.get(completedToolId);

              if ((completedToolName === 'Task' || completedToolName === 'Agent') && isAsyncAgentResult(block)) {
                agent.backgroundAgentToolIds.add(completedToolId);
                continue;
              }

              if (debug) console.log(`[Pixel Agents] JSONL: Agent ${agentId} - tool done: ${block.tool_use_id}`);
              if (completedToolName === 'Task' || completedToolName === 'Agent') {
                agent.activeSubagentToolIds.delete(completedToolId);
                agent.activeSubagentToolNames.delete(completedToolId);
                broadcast({ type: 'subagentClear', id: agentId, parentToolId: completedToolId });
              }
              agent.activeToolIds.delete(completedToolId);
              agent.activeToolStatuses.delete(completedToolId);
              agent.activeToolNames.delete(completedToolId);

              const isCompletedAgentTool = completedToolName === 'Task' || completedToolName === 'Agent';
              if (!agent.hookDelivered || isCompletedAgentTool) {
                const toolId = completedToolId;
                setTimeout(() => {
                  broadcast({ type: 'agentToolDone', id: agentId, toolId });
                }, TOOL_DONE_DELAY_MS);
              }
            }
          }
          if (agent.activeToolIds.size === 0) agent.hadToolsInTurn = false;
        } else {
          cancelWaitingTimer(agentId, waitingTimers);
          clearAgentActivity(agent, agentId, permissionTimers, broadcast);
          agent.hadToolsInTurn = false;
        }
      } else if (typeof content === 'string' && content.trim()) {
        cancelWaitingTimer(agentId, waitingTimers);
        clearAgentActivity(agent, agentId, permissionTimers, broadcast);
        agent.hadToolsInTurn = false;
      }
    } else if (record.type === 'queue-operation' && record.operation === 'enqueue') {
      const content = record.content as string | undefined;
      if (content) {
        const toolIdMatch = content.match(/<tool-use-id>(.*?)<\/tool-use-id>/);
        if (toolIdMatch) {
          const completedToolId = toolIdMatch[1];
          if (agent.backgroundAgentToolIds.has(completedToolId)) {
            agent.backgroundAgentToolIds.delete(completedToolId);
            agent.activeSubagentToolIds.delete(completedToolId);
            agent.activeSubagentToolNames.delete(completedToolId);
            broadcast({ type: 'subagentClear', id: agentId, parentToolId: completedToolId });
            agent.activeToolIds.delete(completedToolId);
            agent.activeToolStatuses.delete(completedToolId);
            agent.activeToolNames.delete(completedToolId);
            if (!agent.hookDelivered) {
              const toolId = completedToolId;
              setTimeout(() => {
                broadcast({ type: 'agentToolDone', id: agentId, toolId });
              }, TOOL_DONE_DELAY_MS);
            }
          }
        }
      }
    } else if (record.type === 'system' && record.subtype === 'turn_duration') {
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);

      const hasForegroundTools = agent.activeToolIds.size > agent.backgroundAgentToolIds.size;
      if (hasForegroundTools) {
        for (const toolId of agent.activeToolIds) {
          if (agent.backgroundAgentToolIds.has(toolId)) continue;
          agent.activeToolIds.delete(toolId);
          agent.activeToolStatuses.delete(toolId);
          const toolName = agent.activeToolNames.get(toolId);
          agent.activeToolNames.delete(toolId);
          if (toolName === 'Task' || toolName === 'Agent') {
            agent.activeSubagentToolIds.delete(toolId);
            agent.activeSubagentToolNames.delete(toolId);
          }
        }
        if (!agent.hookDelivered) broadcast({ type: 'agentToolsClear', id: agentId });
        for (const toolId of agent.backgroundAgentToolIds) {
          const status = agent.activeToolStatuses.get(toolId);
          if (status) broadcast({ type: 'agentToolStart', id: agentId, toolId, status });
        }
      } else if (agent.activeToolIds.size > 0 && agent.backgroundAgentToolIds.size === 0) {
        agent.activeToolIds.clear();
        agent.activeToolStatuses.clear();
        agent.activeToolNames.clear();
        agent.activeSubagentToolIds.clear();
        agent.activeSubagentToolNames.clear();
        if (!agent.hookDelivered) broadcast({ type: 'agentToolsClear', id: agentId });
      }

      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      if (!agent.hookDelivered) {
        broadcast({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }
    }
  } catch {
    // Ignore malformed lines
  }
}

function processProgressRecord(
  agentId: number,
  record: Record<string, unknown>,
  agents: Map<number, StandaloneAgent>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  broadcast: BroadcastFn,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const parentToolId = record.parentToolUseID as string | undefined;
  if (!parentToolId) return;

  const data = record.data as Record<string, unknown> | undefined;
  if (!data) return;

  const dataType = data.type as string | undefined;
  if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
    if (agent.activeToolIds.has(parentToolId) && !agent.hookDelivered) {
      startPermissionTimer(agentId, agents, permissionTimers, broadcast);
    }
    return;
  }

  const parentToolName = agent.activeToolNames.get(parentToolId);
  if (parentToolName !== 'Task' && parentToolName !== 'Agent') return;

  const msg = data.message as Record<string, unknown> | undefined;
  if (!msg) return;

  const msgType = msg.type as string;
  const innerMsg = msg.message as Record<string, unknown> | undefined;
  const content = innerMsg?.content;
  if (!Array.isArray(content)) return;

  if (msgType === 'assistant') {
    let hasNonExemptSubTool = false;
    for (const block of content) {
      if (block.type === 'tool_use' && block.id) {
        const toolName = block.name || '';
        const status = formatToolStatus(toolName, block.input || {});

        let subTools = agent.activeSubagentToolIds.get(parentToolId);
        if (!subTools) { subTools = new Set(); agent.activeSubagentToolIds.set(parentToolId, subTools); }
        subTools.add(block.id);

        let subNames = agent.activeSubagentToolNames.get(parentToolId);
        if (!subNames) { subNames = new Map(); agent.activeSubagentToolNames.set(parentToolId, subNames); }
        subNames.set(block.id, toolName);

        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExemptSubTool = true;

        broadcast({ type: 'subagentToolStart', id: agentId, parentToolId, toolId: block.id, status });
      }
    }
    if (hasNonExemptSubTool && !agent.hookDelivered) {
      startPermissionTimer(agentId, agents, permissionTimers, broadcast);
    }
  } else if (msgType === 'user') {
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        const subTools = agent.activeSubagentToolIds.get(parentToolId);
        if (subTools) subTools.delete(block.tool_use_id);
        const subNames = agent.activeSubagentToolNames.get(parentToolId);
        if (subNames) subNames.delete(block.tool_use_id);

        const toolId = block.tool_use_id;
        setTimeout(() => {
          broadcast({ type: 'subagentToolDone', id: agentId, parentToolId, toolId });
        }, 300);
      }
    }
    let stillHasNonExempt = false;
    for (const [, subNames] of agent.activeSubagentToolNames) {
      for (const [, toolName] of subNames) {
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) { stillHasNonExempt = true; break; }
      }
      if (stillHasNonExempt) break;
    }
    if (stillHasNonExempt && !agent.hookDelivered) {
      startPermissionTimer(agentId, agents, permissionTimers, broadcast);
    }
  }
}

function isAsyncAgentResult(block: Record<string, unknown>): boolean {
  const content = block.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).text === 'string' &&
        ((item as Record<string, unknown>).text as string).startsWith('Async agent launched successfully.')
      ) {
        return true;
      }
    }
  } else if (typeof content === 'string') {
    return content.startsWith('Async agent launched successfully.');
  }
  return false;
}

/**
 * Read new lines from agent's JSONL file and process them.
 */
export function readNewLines(
  agentId: number,
  agents: Map<number, StandaloneAgent>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  broadcast: BroadcastFn,
): void {
  const agent = agents.get(agentId);
  if (!agent || !agent.jsonlFile) return;

  try {
    if (!fs.existsSync(agent.jsonlFile)) return;

    const fd = fs.openSync(agent.jsonlFile, 'r');
    try {
      const stats = fs.fstatSync(fd);
      if (stats.size <= agent.fileOffset) return;

      const bufSize = stats.size - agent.fileOffset;
      const buf = Buffer.allocUnsafe(bufSize);
      const bytesRead = fs.readSync(fd, buf, 0, bufSize, agent.fileOffset);
      if (bytesRead <= 0) return;

      agent.fileOffset += bytesRead;
      const chunk = agent.lineBuffer + buf.slice(0, bytesRead).toString('utf-8');
      const lines = chunk.split('\n');
      agent.lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          processTranscriptLine(agentId, trimmed, agents, waitingTimers, permissionTimers, broadcast);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // File may not exist yet or may be unreadable
  }
}

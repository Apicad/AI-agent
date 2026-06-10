export type AgentMode = 'default' | 'planner';
export type AgentEffort = 'none' | 'low' | 'medium' | 'high' | 'max';

export interface StandaloneAgent {
  id: number;
  sessionId: string;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  backgroundAgentToolIds: Set<string>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  hookDelivered: boolean;
  folderPath: string;
  folderName: string;
  lastDataAt: number;
  linesProcessed: number;
  turnStartAt?: number;
  turnInputTokens: number;
  turnOutputTokens: number;
  seenUnknownRecordTypes: Set<string>;
  palette?: number;
  hueShift?: number;
  seatId?: string | null;
  customName?: string;
  task?: string;
  mode?: AgentMode;
  effort?: AgentEffort;
  isCeo?: boolean;
  role?: 'ceo' | 'manager' | 'worker';
  homeZoneId?: string;
  ttyPath?: string;
  pendingMessages?: string[];
  tasks?: Array<{ label: string; done: boolean }>;
  headless?: boolean;
  headlessModel?: string;
  systemPrompt?: string;
  promptVersion?: number;
  lastTrained?: string;
  canSpawn?: boolean;
  maxSpawn?: number;
  childProcess?: import('child_process').ChildProcess;
  stdinWritable?: import('stream').Writable;
  pendingClear?: boolean;
  currentHookToolId?: string;
  /** External session adopted via hook events (e.g. a vault CEO session):
   *  purely observational — no terminal, no subprocess, never persisted. */
  observed?: boolean;
  lastHookAt?: number;
  pollTimer?: ReturnType<typeof setInterval>;
  permissionTimer?: ReturnType<typeof setTimeout>;
  waitingTimer?: ReturnType<typeof setTimeout>;
}

export interface AppConfig {
  soundEnabled: boolean;
  hooksEnabled: boolean;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  lastSeenVersion: string;
  hooksInfoShown: boolean;
  folders: string[];
  agentSeats: Record<number, string | null>;
  persistedAgents: PersistedAppAgent[];
}

export interface PersistedAppAgent {
  id: number;
  sessionId: string;
  folderPath: string;
  folderName: string;
  jsonlFile: string;
  projectDir: string;
  palette?: number;
  hueShift?: number;
  seatId?: string | null;
  customName?: string;
  task?: string;
  mode?: AgentMode;
  effort?: AgentEffort;
  isCeo?: boolean;
  role?: 'ceo' | 'manager' | 'worker';
  homeZoneId?: string;
  systemPrompt?: string;
  promptVersion?: number;
  lastTrained?: string;
  canSpawn?: boolean;
  maxSpawn?: number;
}

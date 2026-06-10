import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AppConfig } from './types.js';

const CONFIG_DIR = '.pixel-agents';
const APP_CONFIG_NAME = 'app-config.json';

const DEFAULT_CONFIG: AppConfig = {
  soundEnabled: true,
  hooksEnabled: true,
  watchAllSessions: false,
  alwaysShowLabels: false,
  lastSeenVersion: '',
  hooksInfoShown: false,
  folders: [],
  agentSeats: {},
  persistedAgents: [],
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), CONFIG_DIR, APP_CONFIG_NAME);
}

export function readAppConfig(): AppConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      soundEnabled: parsed.soundEnabled ?? DEFAULT_CONFIG.soundEnabled,
      hooksEnabled: parsed.hooksEnabled ?? DEFAULT_CONFIG.hooksEnabled,
      watchAllSessions: parsed.watchAllSessions ?? DEFAULT_CONFIG.watchAllSessions,
      alwaysShowLabels: parsed.alwaysShowLabels ?? DEFAULT_CONFIG.alwaysShowLabels,
      lastSeenVersion: parsed.lastSeenVersion ?? DEFAULT_CONFIG.lastSeenVersion,
      hooksInfoShown: parsed.hooksInfoShown ?? DEFAULT_CONFIG.hooksInfoShown,
      folders: Array.isArray(parsed.folders) ? parsed.folders.filter((f): f is string => typeof f === 'string') : [],
      agentSeats: (parsed.agentSeats && typeof parsed.agentSeats === 'object') ? parsed.agentSeats as Record<number, string | null> : {},
      persistedAgents: Array.isArray(parsed.persistedAgents) ? parsed.persistedAgents : [],
    };
  } catch (err) {
    console.error('[Pixel Agents] Failed to read app config:', err);
    return { ...DEFAULT_CONFIG };
  }
}

export function writeAppConfig(config: AppConfig): void {
  const filePath = getConfigFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(config, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write app config:', err);
  }
}

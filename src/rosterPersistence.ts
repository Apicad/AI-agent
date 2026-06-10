import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR, ROSTER_FILE_NAME } from './constants.js';

export interface RosterAgent {
  name: string;
  task: string;
  role: string;
  plan: boolean;
  effort: string;
  isCeo: boolean;
  bypassPermissions: boolean;
  headless: boolean;
  folderPath: string;
  canSpawn: boolean;
}

export interface AgentRoster {
  version: 1;
  savedAt: number;
  agents: RosterAgent[];
}

function getRosterFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, ROSTER_FILE_NAME);
}

export function readRoster(): AgentRoster | null {
  const filePath = getRosterFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AgentRoster;
    if (parsed.version !== 1 || !Array.isArray(parsed.agents)) return null;
    return parsed;
  } catch (err) {
    console.error('[Pixel Agents] Failed to read roster file:', err);
    return null;
  }
}

export function writeRoster(roster: AgentRoster): void {
  const filePath = getRosterFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(roster, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write roster file:', err);
  }
}

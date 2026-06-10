import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LAYOUT_DIR = '.pixel-agents';
const LAYOUT_FILE = 'layout.json';

function getLayoutFilePath(): string {
  return path.join(os.homedir(), LAYOUT_DIR, LAYOUT_FILE);
}

export function readLayout(): Record<string, unknown> | null {
  const filePath = getLayoutFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error('[Pixel Agents] Failed to read layout file:', err);
    return null;
  }
}

export function writeLayout(layout: Record<string, unknown>): void {
  const filePath = getLayoutFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(layout, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write layout file:', err);
  }
}

export function loadOrInitLayout(defaultLayout: Record<string, unknown> | null): {
  layout: Record<string, unknown>;
  wasReset: boolean;
} {
  const fromFile = readLayout();
  if (fromFile) {
    console.log('[Pixel Agents] Layout loaded from file');
    return { layout: fromFile, wasReset: false };
  }

  if (defaultLayout) {
    console.log('[Pixel Agents] Layout initialized from bundled default');
    writeLayout(defaultLayout);
    return { layout: defaultLayout, wasReset: false };
  }

  // Minimal fallback layout
  const fallback: Record<string, unknown> = {
    version: 1,
    cols: 20,
    rows: 11,
    tiles: new Array(20 * 11).fill(1),
    furniture: [],
  };
  writeLayout(fallback);
  return { layout: fallback, wasReset: false };
}

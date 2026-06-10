#!/usr/bin/env node
/**
 * claude-hook.mjs — standalone Claude Code hook forwarder for the app backend.
 *
 * Reads a hook event (JSON) on stdin and POSTs it to the running Pixel Agents
 * backend, discovered via ~/.pixel-agents/server.json (written on backend start).
 * Fail-silent by design: if the backend is down, unreachable, or slow (>2s),
 * exit 0 so the Claude session is never disturbed.
 *
 * Wire it from any project's .claude/settings.json, e.g.:
 *   { "hooks": { "PostToolUse": [ { "hooks": [ { "type": "command",
 *     "command": "node \"/path/to/AI-agent/app/scripts/claude-hook.mjs\"" } ] } ] } }
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

const SERVER_JSON = path.join(os.homedir(), '.pixel-agents', 'server.json');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  let server;
  try {
    server = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf-8'));
  } catch {
    process.exit(0);
  }
  if (!server || typeof server.port !== 'number' || typeof server.token !== 'string') {
    process.exit(0);
  }

  const body = JSON.stringify(data);
  await new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.port,
        path: '/api/hooks/claude',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${server.token}`,
        },
        timeout: 2000,
      },
      (res) => {
        res.resume();
        resolve();
      },
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });
  process.exit(0);
}

main().catch(() => process.exit(0));

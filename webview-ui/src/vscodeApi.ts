import { isBrowserRuntime, isStandaloneRuntime } from './runtime.js';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

function createWebSocketApi(): { postMessage(msg: unknown): void } {
  const queue: string[] = [];
  let ws: WebSocket | null = null;
  let attempts = 0;

  function connect() {
    ws = new WebSocket('ws://localhost:4000');
    ws.onopen = () => {
      attempts = 0;
      queue.forEach(m => ws!.send(m));
      queue.length = 0;
    };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string);
        window.postMessage(data, '*');
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (attempts < 10) {
        attempts++;
        setTimeout(connect, 2000);
      }
    };
  }
  connect();

  return {
    postMessage(msg: unknown) {
      const str = JSON.stringify(msg);
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(str);
      } else {
        queue.push(str);
      }
    }
  };
}

export const vscode: { postMessage(msg: unknown): void } = isBrowserRuntime
  ? { postMessage: (msg: unknown) => console.log('[vscode.postMessage]', msg) }
  : isStandaloneRuntime
    ? createWebSocketApi()
    : (acquireVsCodeApi() as { postMessage(msg: unknown): void });

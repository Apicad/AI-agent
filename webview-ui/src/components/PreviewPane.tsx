import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button.js';

interface PreviewPaneProps {
  open: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'pixel-agents-preview-url';
const DEFAULT_URL = 'http://localhost:3000';
// Common dev-server ports we probe in priority order
const COMMON_DEV_PORTS = [3000, 3001, 3002, 5173, 5174, 8080, 8000, 4321];

async function probeFirstReachable(ports: number[], timeoutMs = 1500): Promise<string | null> {
  for (const p of ports) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      // no-cors lets us at least confirm the socket answered
      await fetch(`http://localhost:${p}`, { method: 'HEAD', mode: 'no-cors', signal: ac.signal });
      clearTimeout(t);
      return `http://localhost:${p}`;
    } catch {
      clearTimeout(t);
    }
  }
  return null;
}

export function PreviewPane({ open, onClose }: PreviewPaneProps) {
  const [url, setUrl] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_URL;
  });
  const [draftUrl, setDraftUrl] = useState(url);
  const [reloadKey, setReloadKey] = useState(0);
  const [reachable, setReachable] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [scanning, setScanning] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => { setDraftUrl(url); }, [url]);

  // Probe reachability — best-effort HEAD with a short timeout.
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    fetch(url, { method: 'HEAD', mode: 'no-cors', signal: ac.signal })
      .then(() => setReachable('yes'))
      .catch(() => setReachable('no'))
      .finally(() => clearTimeout(t));
    return () => { clearTimeout(t); ac.abort(); };
  }, [url, open, reloadKey]);

  // On first open, if we have no saved URL OR the current URL is unreachable,
  // scan common dev ports and auto-pick the first one that's live.
  useEffect(() => {
    if (!open) return;
    if (localStorage.getItem(STORAGE_KEY)) return; // user has explicit choice — respect it
    setScanning(true);
    probeFirstReachable(COMMON_DEV_PORTS).then((found) => {
      if (found && found !== url) {
        setUrl(found);
      }
      setScanning(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rescan = async () => {
    setScanning(true);
    const found = await probeFirstReachable(COMMON_DEV_PORTS);
    if (found) {
      setUrl(found);
      localStorage.setItem(STORAGE_KEY, found);
      setReloadKey((k) => k + 1);
    }
    setScanning(false);
  };

  if (!open) return null;

  const commitUrl = () => {
    const trimmed = draftUrl.trim();
    if (!trimmed) return;
    const final = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
    setUrl(final);
    localStorage.setItem(STORAGE_KEY, final);
    setReloadKey((k) => k + 1);
  };

  const reload = () => setReloadKey((k) => k + 1);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(8,12,22,0.96)',
        zIndex: 250,
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(4px)',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px',
          background: 'rgba(14,14,24,0.94)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          fontFamily: 'FS Pixel Sans, monospace',
        }}
      >
        <span style={{ fontSize: 13, color: '#4dd9ff', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          🌐 Preview
        </span>
        <input
          type="text"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitUrl();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="http://localhost:3000"
          style={{
            flex: 1,
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6,
            color: '#fff',
            fontSize: 13,
            fontFamily: 'monospace',
            outline: 'none',
          }}
        />
        <Button variant="default" onClick={commitUrl} title="Load URL">Load</Button>
        <Button variant="default" onClick={reload} title="Reload iframe">⟳ Reload</Button>
        <Button
          variant="default"
          onClick={rescan}
          title="Scan common dev ports (3000, 3001, 5173, 8080…) and jump to the first reachable one"
        >
          {scanning ? '◌ Scanning…' : '⌕ Find dev server'}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.7)',
            textDecoration: 'none',
            fontSize: 12,
            fontFamily: 'FS Pixel Sans, monospace',
          }}
          title="Open in new browser tab"
        >
          ↗ New Tab
        </a>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 10,
            color: reachable === 'yes' ? '#22c55e' : reachable === 'no' ? '#f59e0b' : 'rgba(255,255,255,0.4)',
            border: `1px solid ${reachable === 'yes' ? 'rgba(34,197,94,0.4)' : reachable === 'no' ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.15)'}`,
            whiteSpace: 'nowrap',
          }}
          title={reachable === 'yes' ? 'Server reachable' : reachable === 'no' ? 'Server not reachable yet — start it or check the URL' : 'Probing...'}
        >
          {reachable === 'yes' ? '● live' : reachable === 'no' ? '○ down' : '◌ ...'}
        </span>
        <Button variant="default" onClick={onClose} title="Close preview (Esc)">✕ Close</Button>
      </div>

      {/* Body — iframe or empty state */}
      {reachable === 'no' ? (
        <div
          style={{
            flex: 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)',
            fontFamily: 'FS Pixel Sans, monospace',
            gap: 12,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 64 }}>🛠️</div>
          <div style={{ fontSize: 18, color: '#fff' }}>No dev server at <code style={{ color: '#4dd9ff' }}>{url}</code> yet.</div>
          <div style={{ fontSize: 13, maxWidth: 560, lineHeight: 1.6 }}>
            The preview will appear here once the build phase starts and a dev server is running.
            It fires up when an agent runs <code style={{ color: '#4dd9ff' }}>pnpm dev</code> (or <code style={{ color: '#4dd9ff' }}>npm run dev</code>) in your project (typically on :3000, falling through to :3001 if taken).
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            Click <kbd style={{ padding: '2px 6px', background: 'rgba(77,217,255,0.1)', color: '#4dd9ff', borderRadius: 3, border: '1px solid rgba(77,217,255,0.3)' }}>⌕ Find dev server</kbd> above to auto-scan common ports (3000 / 3001 / 5173 / 8080), or type a URL into the bar.
          </div>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          key={reloadKey}
          src={url}
          style={{ flex: 1, border: 'none', background: '#fff' }}
          title="Project preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        />
      )}
    </div>
  );
}

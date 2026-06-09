/**
 * Runtime detection, provider-agnostic
 *
 * Single source of truth for determining whether the webview is running
 * inside an IDE extension (VS Code, Cursor, Windsurf, etc.), as a standalone
 * web app, or in a browser dev environment.
 */

declare function acquireVsCodeApi(): unknown;
declare const __PIXEL_AGENTS_STANDALONE__: boolean | undefined;

type Runtime = 'vscode' | 'standalone' | 'browser';
// Future: 'cursor' | 'windsurf' | 'electron' | etc.

const runtime: Runtime =
  typeof acquireVsCodeApi !== 'undefined'
    ? 'vscode'
    : typeof __PIXEL_AGENTS_STANDALONE__ !== 'undefined' && __PIXEL_AGENTS_STANDALONE__
      ? 'standalone'
      : 'browser';

export const isBrowserRuntime = runtime === 'browser';
export const isStandaloneRuntime = runtime === 'standalone';

/**
 * Stands in for the VS Code webview API so `src/webview/main.ts` runs unchanged in a plain
 * browser page: state goes to localStorage, copy goes to the clipboard, and the host's `config`
 * reply is posted back on `ready`. Must be imported before `main.ts`.
 */
import type { Oklch } from '../src/color';
import { FORMAT } from './store';

const STATE_KEY = 'oklch-lab.state';

let latest: (Oklch & Record<string, unknown>) | undefined;

function readState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** The explorer's current colour, as last persisted by `main.ts`. */
export function currentState(): Oklch | undefined {
  latest ??= readState();
  return latest;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // file:// pages in some browsers have no async clipboard.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

(window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  getState: readState,
  setState(state: Oklch & Record<string, unknown>) {
    latest = state;
    // The panel controls in plugin.ts follow the explorer through this event.
    window.dispatchEvent(new CustomEvent('oklch:state', { detail: state }));
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // Private windows can refuse storage; the page still works without it.
    }
  },
  postMessage(msg: { type: string; text?: string }) {
    if (msg.type === 'ready') window.postMessage({ type: 'config', format: FORMAT }, '*');
    else if (msg.type === 'copy' && msg.text) void copyText(msg.text);
  },
});

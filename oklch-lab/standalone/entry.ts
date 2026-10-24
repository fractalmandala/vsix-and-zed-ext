// Order matters: the shim defines `acquireVsCodeApi` before main.ts calls it.
import './shim';
import '../src/webview/main';
import './saved';
import './plugin';

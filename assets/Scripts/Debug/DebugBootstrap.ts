export type DebugLogLevel = 'log' | 'warn' | 'error' | 'info';

export interface DebugLogEntry {
    id: number;
    level: DebugLogLevel;
    message: string;
    timestamp: number;
    source?: string;
}

export interface DebugDeviceInfo {
    userAgent: string;
    url: string;
    viewport: string;
    dpr: number;
    orientation: string;
    language: string;
    platform: string;
}

type DebugListener = (entry: DebugLogEntry) => void;

const MAX_ENTRIES = 250;
const ROOT_ID = '__mgh_in_app_console_root';
const STYLE_ID = '__mgh_in_app_console_style';

interface DebugBootstrapState {
    installed: boolean;
    nextId: number;
    entries: DebugLogEntry[];
    listeners: Set<DebugListener>;
    original: Partial<Record<DebugLogLevel, (...args: unknown[]) => void>>;
    htmlVisible: boolean;
    autoScroll: boolean;
    multiTapCount: number;
    multiTapTimer: ReturnType<typeof setTimeout> | null;
    earlyErrorShown: boolean;
}

declare global {
    interface Window {
        __MGH_DEBUG__?: {
            install: typeof installDebugBootstrap;
            log: typeof debugLog;
            warn: typeof debugWarn;
            error: typeof debugError;
            breadcrumb: typeof debugBreadcrumb;
            clear: typeof clearDebugLogs;
            getEntries: typeof getDebugEntries;
            getDeviceInfo: typeof getDebugDeviceInfo;
            show: typeof showDebugOverlay;
            hide: typeof hideDebugOverlay;
            toggle: typeof toggleDebugOverlay;
        };
    }
}

const state: DebugBootstrapState = {
    installed: false,
    nextId: 1,
    entries: [],
    listeners: new Set(),
    original: {},
    htmlVisible: false,
    autoScroll: true,
    multiTapCount: 0,
    multiTapTimer: null,
    earlyErrorShown: false,
};

function safeStringify(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (value instanceof Error) {
        return value.stack || `${value.name}: ${value.message}`;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function formatArgs(args: unknown[]): string {
    return args.map((arg) => safeStringify(arg)).join(' ');
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

function pushEntry(level: DebugLogLevel, message: string, source?: string): DebugLogEntry {
    const entry: DebugLogEntry = {
        id: state.nextId++,
        level,
        message,
        timestamp: Date.now(),
        source,
    };

    state.entries.push(entry);
    if (state.entries.length > MAX_ENTRIES) {
        state.entries.splice(0, state.entries.length - MAX_ENTRIES);
    }

    for (const listener of state.listeners) {
        try {
            listener(entry);
        } catch {
            // Ignore listener failures so logging never throws.
        }
    }

    renderHtmlOverlay();

    if ((level === 'error' || level === 'warn') && !state.earlyErrorShown) {
        state.earlyErrorShown = true;
        showDebugOverlay();
    }

    return entry;
}

function wrapConsoleMethod(level: DebugLogLevel): void {
    if (typeof console === 'undefined') {
        return;
    }

    const original = console[level]?.bind(console);
    state.original[level] = original;

    console[level] = (...args: unknown[]) => {
        pushEntry(level, formatArgs(args));
        original?.(...args);
    };
}

function ensureStyle(): void {
    if (typeof document === 'undefined') {
        return;
    }

    if (document.getElementById(STYLE_ID)) {
        return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID} {
  position: fixed;
  z-index: 2147483646;
  left: 8px;
  right: 8px;
  bottom: 8px;
  max-height: 45vh;
  display: none;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  line-height: 1.35;
  color: #f3f3f3;
  background: rgba(10, 12, 18, 0.92);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 10px;
  overflow: hidden;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  pointer-events: auto;
}
#${ROOT_ID}.visible { display: flex; }
#${ROOT_ID} .hdr {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px;
  background: rgba(255,255,255,0.06);
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
#${ROOT_ID} .hdr strong { flex: 1; font-size: 12px; }
#${ROOT_ID} button {
  border: 0;
  border-radius: 6px;
  padding: 6px 8px;
  background: rgba(255,255,255,0.12);
  color: #fff;
  font-size: 11px;
}
#${ROOT_ID} .meta {
  padding: 6px 8px;
  color: #9fb0c7;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  word-break: break-word;
}
#${ROOT_ID} .body {
  overflow: auto;
  padding: 8px;
  flex: 1;
  -webkit-overflow-scrolling: touch;
}
#${ROOT_ID} .row { margin-bottom: 6px; word-break: break-word; white-space: pre-wrap; }
#${ROOT_ID} .row .t { color: #8aa0b8; margin-right: 6px; }
#${ROOT_ID} .row.log { color: #e8eef7; }
#${ROOT_ID} .row.info { color: #9ad0ff; }
#${ROOT_ID} .row.warn { color: #ffd166; }
#${ROOT_ID} .row.error { color: #ff7b7b; }
#${ROOT_ID}_pill {
  position: fixed;
  z-index: 2147483647;
  top: max(8px, env(safe-area-inset-top));
  right: 8px;
  border: 0;
  border-radius: 999px;
  padding: 8px 12px;
  background: rgba(20, 24, 34, 0.85);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  pointer-events: auto;
}
`;
    document.head.appendChild(style);
}

function ensurePill(): void {
    if (typeof document === 'undefined') {
        return;
    }

    if (document.getElementById(`${ROOT_ID}_pill`)) {
        return;
    }

    const pill = document.createElement('button');
    pill.id = `${ROOT_ID}_pill`;
    pill.type = 'button';
    pill.textContent = 'DEBUG';
    pill.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleDebugOverlay();
    });
    document.body.appendChild(pill);
}

function ensureRoot(): HTMLElement | null {
    if (typeof document === 'undefined') {
        return null;
    }

    ensureStyle();
    ensurePill();

    let root = document.getElementById(ROOT_ID);
    if (root) {
        return root;
    }

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="hdr">
        <strong>In-App Console</strong>
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="clear">Clear</button>
        <button type="button" data-action="pause">Pause</button>
        <button type="button" data-action="hide">Hide</button>
      </div>
      <div class="meta" data-role="meta"></div>
      <div class="body" data-role="body"></div>
    `;

    root.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        const action = target?.getAttribute('data-action');
        if (!action) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (action === 'hide') {
            hideDebugOverlay();
            return;
        }

        if (action === 'clear') {
            clearDebugLogs();
            return;
        }

        if (action === 'pause') {
            state.autoScroll = !state.autoScroll;
            target!.textContent = state.autoScroll ? 'Pause' : 'Resume';
            return;
        }

        if (action === 'copy') {
            void copyDebugLogs();
        }
    });

    document.body.appendChild(root);
    return root;
}

function renderHtmlOverlay(): void {
    const root = ensureRoot();
    if (!root) {
        return;
    }

    root.classList.toggle('visible', state.htmlVisible);

    const meta = root.querySelector('[data-role="meta"]') as HTMLElement | null;
    const body = root.querySelector('[data-role="body"]') as HTMLElement | null;
    if (!meta || !body) {
        return;
    }

    const info = getDebugDeviceInfo();
    meta.textContent = [
        info.platform,
        info.viewport,
        `dpr=${info.dpr}`,
        info.orientation,
        info.url,
    ].join(' | ');

    body.innerHTML = state.entries
        .map((entry) => {
            const source = entry.source ? ` [${entry.source}]` : '';
            return `<div class="row ${entry.level}"><span class="t">${formatTime(entry.timestamp)}</span>[${entry.level}]${source} ${escapeHtml(entry.message)}</div>`;
        })
        .join('');

    if (state.autoScroll) {
        body.scrollTop = body.scrollHeight;
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function copyDebugLogs(): Promise<void> {
    const text = dumpDebugLogs();
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            pushEntry('info', 'Copied console text to clipboard.');
            return;
        }
    } catch {
        // Fall through to prompt.
    }

    if (typeof window !== 'undefined') {
        window.prompt('Copy debug logs:', text);
    }
}

function installMultiTapGesture(): void {
    if (typeof document === 'undefined') {
        return;
    }

    const onTap = (): void => {
        state.multiTapCount += 1;
        if (state.multiTapTimer) {
            clearTimeout(state.multiTapTimer);
        }

        state.multiTapTimer = setTimeout(() => {
            state.multiTapCount = 0;
            state.multiTapTimer = null;
        }, 900);

        if (state.multiTapCount >= 3) {
            state.multiTapCount = 0;
            toggleDebugOverlay();
        }
    };

    document.addEventListener('touchend', onTap, { passive: true });
    document.addEventListener('click', onTap, { passive: true });
}

function installGlobalErrorHooks(): void {
    if (typeof window === 'undefined') {
        return;
    }

    window.addEventListener('error', (event) => {
        const message = event.error instanceof Error
            ? event.error.stack || event.error.message
            : `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`;
        pushEntry('error', message, 'window.onerror');
    });

    window.addEventListener('unhandledrejection', (event) => {
        pushEntry('error', safeStringify(event.reason), 'unhandledrejection');
    });
}

export function getDebugDeviceInfo(): DebugDeviceInfo {
    const width = typeof window !== 'undefined' ? window.innerWidth : 0;
    const height = typeof window !== 'undefined' ? window.innerHeight : 0;
    const orientation = width >= height ? 'landscape' : 'portrait';

    return {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
        url: typeof location !== 'undefined' ? location.href : 'n/a',
        viewport: `${width}x${height}`,
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        orientation,
        language: typeof navigator !== 'undefined' ? navigator.language : 'n/a',
        platform: typeof navigator !== 'undefined'
            ? ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
                || navigator.platform
                || 'n/a')
            : 'n/a',
    };
}

export function installDebugBootstrap(): void {
    if (state.installed) {
        return;
    }

    state.installed = true;
    wrapConsoleMethod('log');
    wrapConsoleMethod('info');
    wrapConsoleMethod('warn');
    wrapConsoleMethod('error');
    installGlobalErrorHooks();
    installMultiTapGesture();
    ensureRoot();

    const info = getDebugDeviceInfo();
    pushEntry(
        'info',
        `Debug bootstrap ready | ${info.platform} | ${info.viewport} | dpr=${info.dpr} | ${info.orientation}`,
        'DebugBootstrap',
    );
    pushEntry('info', `UA: ${info.userAgent}`, 'DebugBootstrap');
    pushEntry('info', `URL: ${info.url}`, 'DebugBootstrap');
    pushEntry('info', 'Tap DEBUG pill, or triple-tap screen, to toggle console.', 'DebugBootstrap');

    if (typeof window !== 'undefined') {
        window.__MGH_DEBUG__ = {
            install: installDebugBootstrap,
            log: debugLog,
            warn: debugWarn,
            error: debugError,
            breadcrumb: debugBreadcrumb,
            clear: clearDebugLogs,
            getEntries: getDebugEntries,
            getDeviceInfo: getDebugDeviceInfo,
            show: showDebugOverlay,
            hide: hideDebugOverlay,
            toggle: toggleDebugOverlay,
        };
    }
}

export function subscribeDebugLogs(listener: DebugListener): () => void {
    state.listeners.add(listener);
    return () => {
        state.listeners.delete(listener);
    };
}

export function getDebugEntries(): DebugLogEntry[] {
    return state.entries.slice();
}

export function clearDebugLogs(): void {
    state.entries.length = 0;
    renderHtmlOverlay();
}

export function dumpDebugLogs(): string {
    const info = getDebugDeviceInfo();
    const header = [
        `UA: ${info.userAgent}`,
        `URL: ${info.url}`,
        `Viewport: ${info.viewport}`,
        `DPR: ${info.dpr}`,
        `Orientation: ${info.orientation}`,
        `Platform: ${info.platform}`,
        '',
    ].join('\n');

    const body = state.entries
        .map((entry) => {
            const source = entry.source ? ` [${entry.source}]` : '';
            return `${formatTime(entry.timestamp)} [${entry.level}]${source} ${entry.message}`;
        })
        .join('\n');

    return `${header}${body}`;
}

export function showDebugOverlay(): void {
    state.htmlVisible = true;
    renderHtmlOverlay();
}

export function hideDebugOverlay(): void {
    state.htmlVisible = false;
    renderHtmlOverlay();
}

export function toggleDebugOverlay(): void {
    state.htmlVisible = !state.htmlVisible;
    renderHtmlOverlay();
}

export function debugLog(...args: unknown[]): void {
    installDebugBootstrap();
    pushEntry('log', formatArgs(args));
    state.original.log?.(...args);
}

export function debugWarn(...args: unknown[]): void {
    installDebugBootstrap();
    pushEntry('warn', formatArgs(args));
    state.original.warn?.(...args);
}

export function debugError(...args: unknown[]): void {
    installDebugBootstrap();
    pushEntry('error', formatArgs(args));
    state.original.error?.(...args);
}

export function debugBreadcrumb(source: string, message: string, data?: unknown): void {
    installDebugBootstrap();
    const suffix = data === undefined ? '' : ` ${safeStringify(data)}`;
    pushEntry('info', `${message}${suffix}`, source);
}

// Install as early as this module is evaluated.
installDebugBootstrap();

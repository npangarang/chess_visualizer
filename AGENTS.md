# AGENTS.md — Chess Pressure Heatmap

A Chrome MV3 extension that draws a per-square "pressure" heatmap on chess.com boards. **No build step, no `package.json`, no test runner, no linter, no formatter** — plain JS files, loaded directly by Chrome. Do not introduce any.

## Loading for development

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this repo root (where `manifest.json` lives).
3. After edits: click the extension's reload button, then refresh the chess.com tab.

## File roles and load order

Order in `manifest.json` is load order. Each file is an IIFE that attaches a global the next file reads, so reordering silently breaks startup.

1. `chess-engine.js` — pure logic, no DOM. Exposes `window.ChessEngine` (`idxToRowCol`, `rowColToIdx`, `fenToPieceMap`, `buildAttackMaps`, `computePressure`, `pressureToColor`).
2. `overlay.js` — canvas renderer. Reads `window.ChessEngine`, exposes `window.HeatmapOverlay`.
3. `content.js` — entry point. Wires engine + overlay + observers, listens for popup messages.
4. `inject.js` — runs in the **page's main world**, not the content-script isolated world. Loaded via `chrome.runtime.getURL('inject.js')` from `content.js`. Polls every 200ms for the FEN and posts results back via `CustomEvent('chess-heatmap-state', { detail: { fen, orientation, source } })` on `document`.

`popup/` is the toolbar popup (`popup.html` + `popup.js` + `popup.css`). `styles.css` is a content-script stylesheet. `icons/icon{16,48,128}.png` are referenced from `manifest.json` and must exist.

## Critical conventions

- **Square indexing: `a1=0, h1=7, a8=56, h8=63` (rank 8 = row 0).** Inverse of many chess libraries. White pawns attack toward row −1. A wrong flip inverts the heatmap silently with no test to catch it — see `chess-engine.js` `idxToRowCol` / `pawnAttacks`.
- **No MV3 permissions.** `permissions: []` is intentional. Adding any triggers a Chrome Web Store review. `host_permissions` is restricted to `chess.com` and `www.chess.com` only — do not widen it.
- **Page world ↔ content world bridge is `CustomEvent` on `document`.** Content scripts cannot read `window.game` directly. Do not "simplify" this into a direct global read; it will silently break.
- **FEN source fallback chain (in `inject.js`):** `window.game` → `window.chesscom.analysis` → `<wc-chess-board>` (`board.fen`, `board.game.fen`, `board.getFEN()`, `board.getPosition()`, `getAttribute('fen')`, `board._game.fen`) → window-wide FEN-shaped string scan. If a new chess.com page type breaks the heatmap, add the new source here first.
- **MutationObserver timings are tuned for chess.com.** `content.js` debounces board mutations by 80ms (`_observerTimer`), uses `requestAnimationFrame` throttling on the body-level SPA navigation observer, and retries initial board discovery 20× every 500ms. Change with care.

## Renderer tunables

Hard-coded in `overlay.js` `render()` with a "tweak these to taste" comment, **not** a settings UI:

- `SQUARE_OFFSET_X = 10`, `SQUARE_OFFSET_Y = -10` (px)
- `BG_ALPHA = 0.50`, `TEXT_ALPHA = 0.30`
- Color stops: red `(220,40,0)` → yellow `(255,180,0)` → green `(0,200,0)`, clamped to `maxNet = 5`. Squares remapped for orientation as `(7 − row, 7 − col)` when black.
- Canvas is `<canvas id="chess-pressure-overlay">`, prepended to `<wc-chess-board>`, `pointer-events: none`, `z-index: 1` (in `styles.css`). `ResizeObserver` keeps the pixel buffer at `boardRect × devicePixelRatio`.

**Engine↔renderer contract:** `pressureToColor` returns the magic string `'__debug__|NET'` for contested squares only (`friendly > 0 && enemy > 0`). `overlay.js` strips the 10-char prefix and parses the integer. Do not "clean up" this coupling.

## Popup messages

`popup.js` → `content.js` via `chrome.tabs.sendMessage`. Content script handles in `chrome.runtime.onMessage.addListener`:

- `getState` → `{ enabled, orientation, manualOrientation }`
- `toggle` → `{ enabled }`
- `setOrientation` → `{ orientation: 'w' | 'b' | null }` (`null` = auto-detect)
- `refresh` → no payload, forces `updateHeatmap()`

Popup only sends to the active tab if its URL contains `chess.com`. Silent popup = wrong tab.

## Debugging on chess.com

- Logs are prefixed `[ChessHeatmap]` (content/overlay) or `[ChessHeatmap:page]` (inject).
- The first `inject.js` poll dumps a one-shot `ENV SCAN: {...}` object listing every FEN source it detected. If the heatmap is blank, read this first.
- Each detected FEN logs `FEN via <source>:` and is also carried in the `chess-heatmap-state` event `detail.source`.

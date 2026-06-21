# Chess Pressure Heatmap

A Chrome MV3 extension that overlays a per-square "pressure" heatmap on chess.com boards. Color a square by the net difference between the number of friendly attackers and enemy defenders — a quick visual read of where the position is hot.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. After editing any file, hit the extension's reload button, then refresh the chess.com tab.

## What it works on

- `/play/computer/<bot>` — bot games
- `/game/daily/<id>` — daily games
- `/game/live/<id>` — live rapid, blitz, bullet
- `/analysis` and similar — analysis boards

## What it does

- Computes attack maps for both sides from the current FEN
- Renders a red→yellow→green overlay on every square
- Contested squares (defended and attacked) get the debug treatment with the net-pressure number on top
- Toolbar popup: toggle on/off, force orientation (white / black / auto), refresh

## Architecture

This is intentionally a **no-build** project. No `package.json`, no bundler, no linter, no test runner. Plain JS files loaded directly by Chrome.

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, load order |
| `chess-engine.js` | Pure logic. FEN → piece map → attack maps → pressure. Exposes `window.ChessEngine`. |
| `overlay.js` | Canvas renderer. Reads `window.ChessEngine`, exposes `window.HeatmapOverlay`. |
| `content.js` | Entry point. Wires engine + overlay + observers, listens for popup messages. |
| `inject.js` | Runs in the page's main world. Polls for the FEN and posts it back via `CustomEvent('chess-heatmap-state')`. |
| `popup/` | Toolbar popup. |
| `styles.css` | Content-script stylesheet. |
| `icons/` | Extension icons. |

See `AGENTS.md` for the full set of conventions, square-indexing rules, FEN source fallback chain, and renderer tunables.

## Permissions

`permissions: []` and `host_permissions` are restricted to `chess.com` and `www.chess.com` only. Do not widen either.

## Debugging

- Logs are prefixed `[ChessHeatmap]` (content/overlay) or `[ChessHeatmap:page]` (inject).
- On every fresh page, the inject script logs a one-shot `ENV SCAN: {...}` listing every FEN source it detected and what each returned.
- If a page type renders the board without a heatmap, read that ENV SCAN first and add the new source to `inject.js`'s fallback chain.

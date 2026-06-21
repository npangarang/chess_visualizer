/**
 * Content Script — Entry point injected into chess.com pages.
 *
 * Strategy: Content scripts run in an ISOLATED world and CANNOT access
 * page-level JS globals like window.game. We inject a small script into
 * the PAGE's context that reads window.game.fen and posts it back via
 * CustomEvent on document.
 */

(function () {
  'use strict';

  console.log('[ChessHeatmap] Content script loaded');

  let Engine;
  let OverlayClass;
  try {
    Engine = window.ChessEngine;
    OverlayClass = window.HeatmapOverlay;
    if (!Engine) throw new Error('window.ChessEngine not found');
    if (!OverlayClass) throw new Error('window.HeatmapOverlay not found');
    console.log('[ChessHeatmap] APIs loaded');
  } catch (e) {
    console.error('[ChessHeatmap]', e.message);
    return;
  }

  const { computePressure, fenToPieceMap } = Engine;

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */

  let overlay = null;
  let observer = null;
  let boardEl = null;
  let _observerTimer = null;

  let manualOrientation = null;
  let enabled = true;
  let _currentFen = null;
  let _currentOrientation = 'w';

  /* ------------------------------------------------------------------ */
  /*  Inject script into page context to read window.game                */
  /* ------------------------------------------------------------------ */

  function injectGameReader() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
    console.log('[ChessHeatmap] Game reader injected into page context');
  }

  /* ------------------------------------------------------------------ */
  /*  Listen for game state from injected page script                    */
  /* ------------------------------------------------------------------ */

  document.addEventListener('chess-heatmap-state', (event) => {
    const newFen = event.detail.fen;
    const newOrientation = event.detail.orientation;

    if (newFen !== _currentFen || newOrientation !== _currentOrientation) {
      _currentFen = newFen;
      _currentOrientation = newOrientation;
      console.log('[ChessHeatmap] Game state from page:', newFen, 'orientation:', newOrientation);
      updateHeatmap();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Board discovery                                                    */
  /* ------------------------------------------------------------------ */

  function findBoard() {
    return document.querySelector('wc-chess-board');
  }

  /* ------------------------------------------------------------------ */
  /*  Piece map — from FEN received via CustomEvent                     */
  /* ------------------------------------------------------------------ */

  function getPieceMap() {
    if (_currentFen) {
      return fenToPieceMap(_currentFen);
    }
    return new Map();
  }

  /* ------------------------------------------------------------------ */
  /*  Orientation                                                        */
  /* ------------------------------------------------------------------ */

  function getOrientation() {
    if (manualOrientation) return manualOrientation;
    return _currentOrientation || 'w';
  }

  /* ------------------------------------------------------------------ */
  /*  Heatmap update                                                    */
  /* ------------------------------------------------------------------ */

  function updateHeatmap() {
    try {
      const newBoard = findBoard();

      if (!newBoard) {
        if (overlay) { overlay.destroy(); overlay = null; }
        if (observer) { observer.disconnect(); observer = null; }
        boardEl = null;
        return;
      }

      if (newBoard !== boardEl) {
        console.log('[ChessHeatmap] Board changed, recreating overlay');
        if (overlay) { overlay.destroy(); overlay = null; }
        if (observer) { observer.disconnect(); observer = null; }
        boardEl = newBoard;
      }

      if (!overlay) {
        console.log('[ChessHeatmap] Creating HeatmapOverlay');
        overlay = new OverlayClass(boardEl);
      }

      const pieceMap = getPieceMap();
      console.log('[ChessHeatmap] Pieces:', pieceMap.size);

      if (pieceMap.size === 0) {
        overlay.setVisible(false);
        return;
      }

      overlay.setVisible(enabled);

      const orientation = getOrientation();
      const pressure = computePressure(pieceMap, orientation);
      const drawn = pressure.filter(Boolean).length;
      console.log('[ChessHeatmap] Pressure squares:', drawn, 'orientation:', orientation);

      // Always renders in debug mode (the only mode now)
      overlay.render(pressure, orientation);
    } catch (e) {
      console.error('[ChessHeatmap] Error in updateHeatmap:', e);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Mutation observer                                                  */
  /* ------------------------------------------------------------------ */

  function setupObserver() {
    boardEl = findBoard();
    if (!boardEl) return;

    if (_observerTimer) { clearTimeout(_observerTimer); _observerTimer = null; }
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      if (_observerTimer) clearTimeout(_observerTimer);
      _observerTimer = setTimeout(updateHeatmap, 80);
    });

    observer.observe(boardEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    console.log('[ChessHeatmap] Observer attached to board');
  }

  /* ------------------------------------------------------------------ */
  /*  Popup messages                                                    */
  /* ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      switch (msg.type) {
        case 'getState':
          sendResponse({ enabled, orientation: getOrientation(), manualOrientation });
          break;
        case 'toggle':
          enabled = msg.enabled;
          updateHeatmap();
          break;
        case 'setOrientation':
          manualOrientation = msg.orientation;
          updateHeatmap();
          break;
        case 'refresh':
          updateHeatmap();
          break;
        case 'toggleCalibration':
          if (overlay) overlay.setCalibrationMode(msg.enabled);
          sendResponse({ calibrationMode: overlay ? overlay._calibrationMode : false });
          break;
      }
    } catch (e) {
      console.error('[ChessHeatmap] Message error:', e);
    }
    return true;
  });

  /* ------------------------------------------------------------------ */
  /*  Initialisation                                                     */
  /* ------------------------------------------------------------------ */

  function init() {
    try {
      console.log('[ChessHeatmap] init() called');

      injectGameReader();

      updateHeatmap();
      setupObserver();

      // Retry if board isn't ready yet
      if (!boardEl) {
        let retries = 0;
        const maxRetries = 20;
        const retry = () => {
          retries++;
          updateHeatmap();
          setupObserver();
          if (!boardEl && retries < maxRetries) {
            setTimeout(retry, 500);
          } else if (boardEl) {
            console.log('[ChessHeatmap] Board found on retry', retries);
          } else {
            console.warn('[ChessHeatmap] Board never found after', maxRetries, 'retries');
          }
        };
        setTimeout(retry, 500);
      }

      // SPA navigation watcher
      let bodyTimer = null;
      const bodyObserver = new MutationObserver(() => {
        if (bodyTimer) return;
        bodyTimer = requestAnimationFrame(() => {
          bodyTimer = null;
          const newBoard = findBoard();
          if (newBoard && newBoard !== boardEl) {
            console.log('[ChessHeatmap] BodyObserver detected new board');
            updateHeatmap();
            setupObserver();
          }
        });
      });

      bodyObserver.observe(document.body, {
        childList: true,
        subtree: true
      });

      console.log('[ChessHeatmap] init() complete, boardEl:', !!boardEl);
    } catch (e) {
      console.error('[ChessHeatmap] Fatal init error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
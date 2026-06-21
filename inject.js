/**
 * inject.js — Runs in the PAGE's JavaScript context (not content script).
 * Reads game state from whatever API chess.com exposes on this page type.
 * Communicates via CustomEvent on document.
 */
(function () {
  'use strict';

  var attempts = 0;
  var lastFen = null;
  var found = false;

  /* ------------------------------------------------------------------ */
  /*  Deep environment scan — called once on first poll                  */
  /* ------------------------------------------------------------------ */

  function explore() {
    var info = {};

    // window.chesscom top-level keys
    try {
      var ccKeys = window.chesscom ? Object.keys(window.chesscom).sort().join(', ') : 'none';
      info.chesscomKeys = ccKeys;
    } catch (e) { info.chesscomKeys = 'error'; }

    // window.game
    try {
      info.hasWindowGame = !!window.game;
      if (window.game) {
        info.gameFen = window.game.fen || null;
        info.gameGetFEN = typeof window.game.getFEN === 'function' || typeof window.game.getPosition === 'function';
        info.gameGetPlayingAs = typeof window.game.getPlayingAs === 'function';
        info.gameKeys = Object.keys(window.game).slice(0, 30).join(', ');
      }
    } catch (e) {}

    // <wc-chess-board> and any element with a .fen property
    try {
      var board = document.querySelector('wc-chess-board');
      if (board) {
        info.boardFound = true;
        info.boardTag = board.tagName;
        // Try direct properties
        info.boardFen = board.fen || null;
        if (board.game) {
          info.boardGameFen = board.game.fen || null;
          info.boardGameKeys = Object.keys(board.game).slice(0, 20).join(', ');
          info.boardGameHasGetFEN = typeof board.game.getFEN === 'function';
          info.boardGameHasGetPosition = typeof board.game.getPosition === 'function';
          if (typeof board.game.getFEN === 'function') {
            try { info.boardGameGetFEN = board.game.getFEN().substring(0, 40); } catch(e) {}
          }
          if (typeof board.game.getPosition === 'function') {
            try {
              var gp = board.game.getPosition();
              info.boardGameGetPosFen = (gp && gp.fen) ? gp.fen.substring(0, 40) : null;
            } catch(e) {}
          }
        }
        if (typeof board.getFEN === 'function') {
          try { info.boardGetFENResult = board.getFEN(); } catch(e) {}
        }
        if (typeof board.getPosition === 'function') {
          try { info.boardGetPosResult = board.getPosition(); } catch(e) {}
        }
        if (typeof board.getAttribute === 'function') {
          info.boardAttrFen = board.getAttribute('fen') || null;
        }
        // Scan ALL own properties for fen-like strings
        var fenProps = [];
        for (var pk in board) {
          try {
            var pv = board[pk];
            if (typeof pv === 'string' && pv.length > 20 && pv.includes('/')) fenProps.push(pk + '=' + pv.substring(0, 20));
          } catch(e) {}
        }
        info.boardFenProps = fenProps.slice(0, 10).join(' | ') || 'none';
      } else {
        info.boardFound = false;
        info.boardFoundInIframes = 'checking iframes...';
      }
    } catch (e) { info.boardError = e.message; }

    // PixiJS renderers — chess.com uses PixiJS for board rendering
    try {
      var pixiApps = [];
      for (var k in window) {
        try {
          var w = window[k];
          if (w && w._app && w._app.stage) {
            pixiApps.push(k + ':app');
          }
          if (w && w.pixi && w.pixi instanceof Object) {
            pixiApps.push(k + ':pixi');
          }
        } catch(e) {}
      }
      info.pixiApps = pixiApps.join(', ') || 'none';
    } catch(e) {}

    // If frames exist, try them
    try {
      var frames = [];
      var iframes = document.querySelectorAll('iframe');
      iframes.forEach(function(f, i) {
        frames.push('iframe[' + i + '] src=' + (f.src || 'about:blank').substring(0, 40));
        try {
          if (f.contentWindow && f.contentWindow.game) {
            frames.push('iframe[' + i + '].game.fen=' + f.contentWindow.game.fen);
          }
          if (f.contentWindow && f.contentWindow.chesscom && f.contentWindow.chesscom.analysis) {
            frames.push('iframe[' + i + '].chesscom.analysis.fen=' + f.contentWindow.chesscom.analysis.fen);
          }
        } catch(e) {}
      });
      info.iframes = frames.join(', ') || 'none';
    } catch(e) {}

    // Scan window for any fen-like string > 30 chars
    try {
      var fenMatches = [];
      var seen = new Set();
      for (var wk in window) {
        if (seen.has(wk)) continue;
        try {
          var wv = window[wk];
          if (typeof wv === 'string' && wv.length > 40 && wv.includes('/') && wv.split('/').length >= 4) {
            seen.add(wk);
            fenMatches.push(wk + '=' + wv.substring(0, 25));
          }
          if (wv && typeof wv === 'object') {
            for (var ik in wv) {
              try {
                var iv = wv[ik];
                if (typeof iv === 'string' && iv.length > 40 && iv.includes('/') && iv.split('/').length >= 4) {
                  var key = wk + '.' + ik;
                  if (!seen.has(key)) { seen.add(key); fenMatches.push(key + '=' + iv.substring(0, 25)); }
                }
              } catch(e) {}
            }
          }
        } catch(e) {}
      }
      info.fenLikeStrings = fenMatches.slice(0, 10).join(' | ') || 'none';
    } catch(e) {}

    console.log('[ChessHeatmap:page] ENV SCAN:', JSON.stringify(info));
    return info;
  }

  /* ------------------------------------------------------------------ */
  /*  Try all known game data sources                                    */
  /* ------------------------------------------------------------------ */

  function getGameData() {
    // Source 1: window.game
    try {
      var g = window.game;
      if (g && g.fen && typeof g.fen === 'string' && g.fen !== '') {
        var orientation = 'w';
        try {
          var side = g.getPlayingAs();
          if (side === 'black' || side === 0) orientation = 'b';
          else if (side === 'white' || side === 1) orientation = 'w';
        } catch (e) {}
        return { fen: g.fen, orientation: orientation, source: 'window.game' };
      }
    } catch (e) {}

    // Source 2: window.chesscom.analysis
    try {
      var analysis = window.chesscom && window.chesscom.analysis;
      if (analysis && analysis.fen && analysis.fen !== '') {
        return { fen: analysis.fen, orientation: 'w', source: 'chesscom.analysis' };
      }
    } catch (e) {}

    // Source 3: <wc-chess-board> custom element
    try {
      var board = document.querySelector('wc-chess-board');
      if (board) {
        if (board.fen && typeof board.fen === 'string' && board.fen !== '') {
          return { fen: board.fen, orientation: 'w', source: 'board.fen' };
        }
        if (board.game && board.game.fen && typeof board.game.fen === 'string' && board.game.fen !== '') {
          return { fen: board.game.fen, orientation: 'w', source: 'board.game' };
        }
        if (typeof board.getFEN === 'function') {
          try {
            var fen = board.getFEN();
            if (fen && typeof fen === 'string' && fen !== '') {
              return { fen: fen, orientation: 'w', source: 'board.getFEN()' };
            }
          } catch (e) {}
        }
        if (typeof board.getPosition === 'function') {
          try {
            var pos = board.getPosition();
            if (pos && typeof pos === 'string' && pos !== '') {
              return { fen: pos, orientation: 'w', source: 'board.getPosition()' };
            }
          } catch (e) {}
        }
        // board.game methods — used on daily/live/rapid game pages
        if (board.game) {
          if (typeof board.game.getFEN === 'function') {
            try {
              var gf = board.game.getFEN();
              if (gf && typeof gf === 'string' && gf !== '') {
                var orient = 'w';
                try {
                  var side = board.game.getPlayingAs();
                  if (side === 'black' || side === 0) orient = 'b';
                  else if (side === 'white' || side === 1) orient = 'w';
                } catch (e) {}
                return { fen: gf, orientation: orient, source: 'board.game.getFEN()' };
              }
            } catch (e) {}
          }
          if (typeof board.game.getPosition === 'function') {
            try {
              var gp = board.game.getPosition();
              if (gp && gp.fen && typeof gp.fen === 'string' && gp.fen !== '') {
                var orient = 'w';
                try {
                  var side = board.game.getPlayingAs();
                  if (side === 'black' || side === 0) orient = 'b';
                  else if (side === 'white' || side === 1) orient = 'w';
                } catch (e) {}
                return { fen: gp.fen, orientation: orient, source: 'board.game.getPosition()' };
              }
            } catch (e) {}
          }
        }
        if (typeof board.getAttribute === 'function') {
          var attrFen = board.getAttribute('fen');
          if (attrFen && attrFen !== '') {
            return { fen: attrFen, orientation: 'w', source: 'board.attr[fen]' };
          }
        }
        if (board._game && board._game.fen && typeof board._game.fen === 'string' && board._game.fen !== '') {
          return { fen: board._game.fen, orientation: 'w', source: 'board._game' };
        }
      }
    } catch (e) {}

    // Source 4: Scan window for any top-level string that looks like FEN
    try {
      var seen = new Set();
      for (var wk in window) {
        if (seen.has(wk)) continue;
        try {
          var wv = window[wk];
          if (typeof wv === 'string' && wv.length > 40 && wv.includes('/') && wv.split('/').length >= 4) {
            // Looks like a FEN string
            seen.add(wk);
            return { fen: wv, orientation: 'w', source: 'window.' + wk };
          }
        } catch(e) {}
      }
    } catch(e) {}

    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  Polling loop                                                       */
  /* ------------------------------------------------------------------ */

  function readAndPost() {
    attempts++;
    try {
      if (attempts === 1) explore();

      var data = getGameData();

      if (data) {
        if (data.fen !== lastFen) {
          lastFen = data.fen;
          found = true;
          document.dispatchEvent(new CustomEvent('chess-heatmap-state', {
            detail: {
              fen: data.fen,
              orientation: data.orientation,
              source: data.source
            }
          }));
          console.log('[ChessHeatmap:page] FEN via', data.source + ':', data.fen.substring(0, 40));
        }
      } else {
        if (!found && (attempts <= 5 || attempts % 50 === 0)) {
          console.log('[ChessHeatmap:page] searching... attempt', attempts);
        }
      }
    } catch (e) {
      console.error('[ChessHeatmap:page] error:', e.message);
    }
  }

  readAndPost();
  setInterval(readAndPost, 200);
})();

/**
 * Chess Engine — Pure logic for attack maps, pressure calculation, and color mapping.
 * No DOM dependencies. Works with a simple piece map: Map<squareIndex, {type, color}>
 */

(function () {
  'use strict';

  console.log('[ChessHeatmap] ChessEngine script loaded');

  /* ------------------------------------------------------------------ */
  /*  Square index helpers (0–63, a1=0, h1=7, a8=56, h8=63)             */
  /* ------------------------------------------------------------------ */

  function idxToRowCol(idx) {
    return { row: Math.floor(idx / 8), col: idx % 8 };
  }

  function rowColToIdx(row, col) {
    return row * 8 + col;
  }

  function isValidRC(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  /* ------------------------------------------------------------------ */
  /*  Piece attack generators                                            */
  /* ------------------------------------------------------------------ */

  const KNIGHT_OFFSETS = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1]
  ];

  const KING_OFFSETS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  const SLIDING_DIRS = {
    b: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
    q: [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]
  };

  function knightAttacks(idx) {
    const { row, col } = idxToRowCol(idx);
    return KNIGHT_OFFSETS
      .map(([dr, dc]) => [row + dr, col + dc])
      .filter(([r, c]) => isValidRC(r, c))
      .map(([r, c]) => rowColToIdx(r, c));
  }

  function kingAttacks(idx) {
    const { row, col } = idxToRowCol(idx);
    return KING_OFFSETS
      .map(([dr, dc]) => [row + dr, col + dc])
      .filter(([r, c]) => isValidRC(r, c))
      .map(([r, c]) => rowColToIdx(r, c));
  }

  function pawnAttacks(idx, color) {
    const { row, col } = idxToRowCol(idx);
    // White pawns attack toward rank 8 (lower row numbers)
    // Black pawns attack toward rank 1 (higher row numbers)
    const dir = color === 'w' ? -1 : 1;
    const attacks = [];
    const nr = row + dir;
    if (isValidRC(nr, col - 1)) attacks.push(rowColToIdx(nr, col - 1));
    if (isValidRC(nr, col + 1)) attacks.push(rowColToIdx(nr, col + 1));
    return attacks;
  }

  function slidingAttacks(idx, occupiedSet, directions) {
    const { row, col } = idxToRowCol(idx);
    const attacks = [];
    for (const [dr, dc] of directions) {
      let r = row + dr;
      let c = col + dc;
      while (isValidRC(r, c)) {
        const tgt = rowColToIdx(r, c);
        attacks.push(tgt);
        if (occupiedSet.has(tgt)) break;
        r += dr;
        c += dc;
      }
    }
    return attacks;
  }

  /* ------------------------------------------------------------------ */
  /*  FEN parser                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Parse a FEN string into a piece map.
   * FEN example: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
   *
   * @param {string} fen
   * @returns {Map<number, {type: string, color: 'w'|'b'}>}
   */
  function fenToPieceMap(fen) {
    const pieceMap = new Map();
    if (!fen) return pieceMap;

    const ranks = fen.split(' ')[0].split('/');

    for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
      const rankStr = ranks[rankIdx];
      let fileIdx = 0;

      for (const ch of rankStr) {
        if (ch >= '1' && ch <= '8') {
          fileIdx += parseInt(ch, 10);
        } else {
          // FEN standard: UPPERCASE = WHITE, lowercase = BLACK
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          const type = ch.toLowerCase();
          const idx = rankIdx * 8 + fileIdx;  // rank 8 (index 0) → row 0, rank 1 (index 7) → row 7
          pieceMap.set(idx, { type, color });
          fileIdx++;
        }
      }
    }

    return pieceMap;
  }

  /* ------------------------------------------------------------------ */
  /*  Build attack maps                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * @param {Map<number, {type: string, color: 'w'|'b'}>} pieceMap
   * @returns {{ whiteAttacks: number[], blackAttacks: number[] }}
   */
  function buildAttackMaps(pieceMap) {
    const whiteAttacks = new Array(64).fill(0);
    const blackAttacks = new Array(64).fill(0);
    const occupied = new Set(pieceMap.keys());

    for (const [idx, piece] of pieceMap) {
      let attacks;
      switch (piece.type) {
        case 'p': attacks = pawnAttacks(idx, piece.color); break;
        case 'n': attacks = knightAttacks(idx); break;
        case 'b': attacks = slidingAttacks(idx, occupied, SLIDING_DIRS.b); break;
        case 'r': attacks = slidingAttacks(idx, occupied, SLIDING_DIRS.r); break;
        case 'q': attacks = slidingAttacks(idx, occupied, SLIDING_DIRS.q); break;
        case 'k': attacks = kingAttacks(idx); break;
        default: continue;
      }
      const arr = piece.color === 'w' ? whiteAttacks : blackAttacks;
      for (const a of attacks) arr[a]++;
    }

    return { whiteAttacks, blackAttacks };
  }

  /* ------------------------------------------------------------------ */
  /*  Pressure computation                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Compute per-square pressure relative to the player's orientation.
   *
   * @param {Map<number, {type: string, color: 'w'|'b'}>} pieceMap
   * @param {'w'|'b'} orientation  — which side the user is playing
   * @returns {(null|{net:number, friendly:number, enemy:number, total:number})[]}
   */
  function computePressure(pieceMap, orientation) {
    const { whiteAttacks, blackAttacks } = buildAttackMaps(pieceMap);
    const pressure = new Array(64).fill(null);

    for (let i = 0; i < 64; i++) {
      const w = whiteAttacks[i];
      const b = blackAttacks[i];
      if (w === 0 && b === 0) continue;

      const friendly = orientation === 'w' ? w : b;
      const enemy    = orientation === 'w' ? b : w;

      pressure[i] = {
        net: friendly - enemy,
        friendly,
        enemy,
        total: w + b
      };
    }

    return pressure;
  }

  /* ------------------------------------------------------------------ */
  /*  Color mapping — DEBUG MODE ONLY                                    */
  /* ------------------------------------------------------------------ */

  /**
   * In debug mode, returns '__debug__|NET' so the overlay can render
   * numbers with a red→yellow→green background on contested squares.
   * Returns null for non-contested squares (transparent).
   *
   * @param {{net:number, friendly:number, enemy:number, total:number}|null} data
   * @returns {string|null}  '__debug__|NET' or null
   */
  function pressureToColor(data) {
    if (!data) return null;
    // Only show squares where BOTH sides contribute
    if (data.friendly <= 0 || data.enemy <= 0) return null;
    return '__debug__|' + data.net;
  }

  /* ---- expose public API ---- */

  window.ChessEngine = {
    idxToRowCol,
    rowColToIdx,
    fenToPieceMap,
    buildAttackMaps,
    computePressure,
    pressureToColor
  };

})();
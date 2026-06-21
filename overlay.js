/**
 * Overlay — Canvas-based heatmap rendered on top of the chess.com board.
 * Only renders in debug mode: contested squares show net pressure as a
 * coloured cell with a semi-transparent number overlay.
 */

(function () {
  'use strict';

  console.log('[ChessHeatmap] Overlay script loaded');

  const CE = window.ChessEngine;
  if (!CE) {
    console.error('[ChessHeatmap] Overlay: ChessEngine not available');
    return;
  }
  const { idxToRowCol, pressureToColor } = CE;

  class HeatmapOverlay {
    constructor(boardEl) {
      this.boardEl = boardEl;
      this.canvas = null;
      this.ctx = null;
      this.visible = true;
      this.squareSize = 0;
      this._gridLeft = 0;
      this._gridTop = 0;
      this._cssWidth = 0;
      this._cssHeight = 0;
      this._resizeObserver = null;
      this._calibrationMode = false;
      this._manualMargins = this._loadMargins();
      this._dragging = null;           // 'left' | 'right' | 'top' | 'bottom' | null
      this._dragStart = { x: 0, y: 0 };
      this._dragStartMargin = 0;
      this._onMouseDown = null;
      this._onMouseMove = null;
      this._onMouseUp = null;
      this._createCanvas();
      this._observeResize();
      console.log('[ChessHeatmap] Overlay created, canvas:', !!this.canvas, 'size:', this._cssWidth, 'x', this._cssHeight);
    }

    /* ---- manual calibration ---- */

    _loadMargins() {
      try {
        const raw = localStorage.getItem('chessHeatmapCalibration');
        return raw ? JSON.parse(raw) : { left: 0, top: 0, right: 0, bottom: 0 };
      } catch (e) { return { left: 0, top: 0, right: 0, bottom: 0 }; }
    }

    _saveMargins() {
      try { localStorage.setItem('chessHeatmapCalibration', JSON.stringify(this._manualMargins)); } catch (e) {}
    }

    setCalibrationMode(on) {
      this._calibrationMode = !!on;
      if (this._calibrationMode) {
        this.canvas.style.pointerEvents = 'auto';
        this._bindMouse();
      } else {
        this.canvas.style.pointerEvents = 'none';
        this._unbindMouse();
        this._saveMargins();
      }
    }

    _bindMouse() {
      this._onMouseDown = (e) => this._handleMouseDown(e);
      this._onMouseMove = (e) => this._handleMouseMove(e);
      this._onMouseUp   = () => this._handleMouseUp();
      this.canvas.addEventListener('mousedown', this._onMouseDown);
      window.addEventListener('mousemove', this._onMouseMove);
      window.addEventListener('mouseup', this._onMouseUp);
    }

    _unbindMouse() {
      if (this._onMouseDown) { this.canvas.removeEventListener('mousedown', this._onMouseDown); this._onMouseDown = null; }
      if (this._onMouseMove) { window.removeEventListener('mousemove', this._onMouseMove); this._onMouseMove = null; }
      if (this._onMouseUp)   { window.removeEventListener('mouseup', this._onMouseUp); this._onMouseUp = null; }
    }

    _handleMouseDown(e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const m = this._manualMargins;
      const bw = this._cssWidth;
      const bh = this._cssHeight;
      const gx = m.left;
      const gy = m.top;
      const gw = bw - m.left - m.right;
      const gh = bh - m.top - m.bottom;
      const HIT = 10; // px hit zone

      this._dragging = null;
      if (Math.abs(mx - gx) < HIT && my > gy && my < gy + gh) this._dragging = 'left';
      else if (Math.abs(mx - (gx + gw)) < HIT && my > gy && my < gy + gh) this._dragging = 'right';
      else if (Math.abs(my - gy) < HIT && mx > gx && mx < gx + gw) this._dragging = 'top';
      else if (Math.abs(my - (gy + gh)) < HIT && mx > gx && mx < gx + gw) this._dragging = 'bottom';

      if (this._dragging) {
        this._dragStart = { x: mx, y: my };
        this._dragStartMargin = m[this._dragging];
        e.preventDefault();
      }
    }

    _handleMouseMove(e) {
      if (!this._dragging) {
        // Update cursor based on hover
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const m = this._manualMargins;
        const bw = this._cssWidth;
        const bh = this._cssHeight;
        const gx = m.left;
        const gy = m.top;
        const gw = bw - m.left - m.right;
        const gh = bh - m.top - m.bottom;
        const HIT = 10;
        if (Math.abs(mx - gx) < HIT || Math.abs(mx - (gx + gw)) < HIT) this.canvas.style.cursor = 'ew-resize';
        else if (Math.abs(my - gy) < HIT || Math.abs(my - (gy + gh)) < HIT) this.canvas.style.cursor = 'ns-resize';
        else this.canvas.style.cursor = 'default';
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = this._dragging === 'left' || this._dragging === 'right' ? mx - this._dragStart.x : my - this._dragStart.y;
      const maxDim = this._dragging === 'left' || this._dragging === 'right' ? this._cssWidth : this._cssHeight;
      let newVal = this._dragStartMargin + delta;
      newVal = Math.max(0, Math.min(newVal, maxDim * 0.3)); // clamp to 30% of board
      this._manualMargins[this._dragging] = Math.round(newVal);
      // Force re-render
      if (this._lastPressure && this._lastOrientation) {
        this.render(this._lastPressure, this._lastOrientation);
      }
    }

    _handleMouseUp() {
      this._dragging = null;
    }

    _drawCalibrationBorder(gx, gy, gw, gh) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 150, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(gx, gy, gw, gh);
      ctx.setLineDash([]);

      // Edge labels showing current margin values
      ctx.fillStyle = 'rgba(0,150,255,0.9)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      const m = this._manualMargins;
      if (m.left > 0) ctx.fillText(m.left + 'px', gx - 18, gy + gh / 2);
      if (m.right > 0) ctx.fillText(m.right + 'px', gx + gw + 18, gy + gh / 2);
      if (m.top > 0) ctx.fillText(m.top + 'px', gx + gw / 2, gy - 8);
      if (m.bottom > 0) ctx.fillText(m.bottom + 'px', gx + gw / 2, gy + gh + 16);

      // Mode indicator
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('CALIBRATION MODE — drag edges to align', 6, this._cssHeight - 8);
      ctx.restore();
    }

    /* ---- canvas setup ---- */

    _createCanvas() {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'chess-pressure-overlay';

      const pos = getComputedStyle(this.boardEl).position;
      if (pos === 'static') this.boardEl.style.position = 'relative';

      this.boardEl.insertBefore(this.canvas, this.boardEl.firstChild);
      this.ctx = this.canvas.getContext('2d');
      this._syncSize();
    }

    _syncSize() {
      const rect = this.boardEl.getBoundingClientRect();
      const newW = rect.width;
      const newH = rect.height;
      if (newW === this._cssWidth && newH === this._cssHeight) return;

      this._cssWidth = newW;
      this._cssHeight = newH;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = newW * dpr;
      this.canvas.height = newH * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.squareSize = newW / 8;
      this._calibrateGrid();
    }

    /* ---- Auto-calibrate grid position from actual piece elements ---- */

    _calibrateGrid() {
      this._gridLeft = 0;
      this._gridTop = 0;

      try {
        const boardRect = this.boardEl.getBoundingClientRect();

        // Strategy 1: measure from piece elements
        const pieces = this.boardEl.querySelectorAll('.piece');
        if (pieces.length >= 2) {
          this._calibrateFromPieces(pieces, boardRect);
          return;
        }

        // Strategy 2: fallback — use .hover-square for square size
        const hover = this.boardEl.querySelector('.hover-square');
        if (hover) {
          const hr = hover.getBoundingClientRect();
          this.squareSize = hr.width;                     // 1/8 of grid
          this._gridLeft = hr.left - boardRect.left;      // top-left of grid
          this._gridTop = hr.top - boardRect.top;
          console.log('[ChessHeatmap] Calibrated via hover-square:', {
            boardW: boardRect.width, sqPx: hr.width,
            gridLeft: this._gridLeft, gridTop: this._gridTop
          });
          return;
        }

        console.log('[ChessHeatmap] Calibrate: no .piece or .hover-square — child count:', this.boardEl.children.length);
      } catch (e) {
        console.warn('[ChessHeatmap] Calibrate error:', e.message);
      }
    }

    _calibrateFromPieces(pieces, boardRect) {
      let minFile = 9, maxFile = 0, minRank = 9, maxRank = 0;
      let minFilePiece = null, maxFilePiece = null;
      let minRankPiece = null, maxRankPiece = null;

      for (const p of pieces) {
        const match = p.className.match(/square-(\d)(\d)/);
        if (!match) continue;
        const file = parseInt(match[1], 10);
        const rank = parseInt(match[2], 10);

        if (file < minFile) { minFile = file; minFilePiece = p; }
        if (file > maxFile) { maxFile = file; maxFilePiece = p; }
        if (rank < minRank) { minRank = rank; minRankPiece = p; }
        if (rank > maxRank) { maxRank = rank; maxRankPiece = p; }
      }

      if (!minFilePiece || !maxFilePiece || minFile === maxFile) return;

      const prMin = minFilePiece.getBoundingClientRect();
      const prMax = maxFilePiece.getBoundingClientRect();

      const gridSpacingX = (prMax.left - prMin.left) / (maxFile - minFile);
      this._gridLeft = (prMin.left - boardRect.left) - (minFile - 1) * gridSpacingX;
      this.squareSize = gridSpacingX;

      let gridSpacingY;
      if (minRankPiece && maxRankPiece && minRank !== maxRank) {
        const prTop = minRankPiece.getBoundingClientRect();
        const prBot = maxRankPiece.getBoundingClientRect();
        gridSpacingY = (prBot.top - prTop.top) / (maxRank - minRank);
        this._gridTop = (prTop.top - boardRect.top) - (8 - minRank) * gridSpacingY;
      }

      console.log('[ChessHeatmap] Calibrated via pieces:', {
        boardW: boardRect.width, gridSpacingX, gridSpacingY,
        gridLeft: this._gridLeft, gridTop: this._gridTop,
        fileRange: minFile + '-' + maxFile
      });
    }

    _observeResize() {
      this._resizeObserver = new ResizeObserver(() => this._syncSize());
      this._resizeObserver.observe(this.boardEl);
    }

    /* ---- rendering — debug mode only ---- */

    render(pressureData, orientation) {
      this._syncSize();
      this._calibrateGrid();       // re-run in case pieces weren't in DOM yet

      // Cache last render args so calibration drags can re-render without FEN churn
      this._lastPressure = pressureData;
      this._lastOrientation = orientation;

      this.ctx.clearRect(0, 0, this._cssWidth, this._cssHeight);

      if (!this.visible || !pressureData) return;

      /* ---- tunables ---- */
      const BG_ALPHA         = 0.50;  // background opacity (0–1)
      const TEXT_ALPHA       = 0.30;  // text opacity (0–1)
      /* ----------------- */

      const m = this._manualMargins;
      const bw = this._cssWidth;
      const bh = this._cssHeight;

      // Use manual margins if any are set, otherwise fall back to auto-calibration
      const hasManual = m.left > 0 || m.top > 0 || m.right > 0 || m.bottom > 0;
      const gridLeft = hasManual ? m.left : this._gridLeft;
      const gridTop  = hasManual ? m.top  : this._gridTop;
      const gridW    = hasManual ? (bw - m.left - m.right) : bw;
      const gridH    = hasManual ? (bh - m.top - m.bottom) : bh;
      const sq = Math.min(gridW, gridH) / 8;

      for (let i = 0; i < 64; i++) {
        const data = pressureData[i];
        if (!data) continue;

        const result = pressureToColor(data);
        if (!result) continue;

        // result is '__debug__|NET'
        const net = parseInt(result.substring(10), 10);
        const label = net > 0 ? '+' + net : String(net);

        const { row, col } = idxToRowCol(i);

        // Map board coordinates to canvas based on orientation
        let drawRow, drawCol;
        if (orientation === 'w') {
          drawRow = row;
          drawCol = col;
        } else {
          drawRow = 7 - row;
          drawCol = 7 - col;
        }

        /* ---- Red → Yellow → Green background ---- */
        const maxNet = 5;
        const t = Math.max(-1, Math.min(1, net / maxNet));
        let r, g, b;
        if (t < 0) {
          // red → yellow
          r = 220 + (255 - 220) * (t + 1);
          g = 40 + (180 - 40) * (t + 1);
          b = 0;
        } else {
          // yellow → green
          r = 255 - 255 * t;
          g = 180 + (200 - 180) * t;
          b = 0;
        }
        const ox = gridLeft + drawCol * sq;
        const oy = gridTop + drawRow * sq;

        this.ctx.fillStyle = 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + BG_ALPHA + ')';
        this.ctx.fillRect(ox, oy, sq, sq);

        /* ---- Semi-transparent number ---- */
        const fontSize = Math.max(sq * 0.32, 9);
        this.ctx.save();
        this.ctx.font = 'bold ' + fontSize + 'px "SF Mono", Monaco, Courier, monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = 'rgba(0,0,0,' + TEXT_ALPHA + ')';
        this.ctx.fillText(label, ox + sq / 2, oy + sq / 2 + 1);
        this.ctx.restore();
      }

      if (this._calibrationMode) {
        this._drawCalibrationBorder(gridLeft, gridTop, sq * 8, sq * 8);
      }
    }

    /* ---- controls ---- */

    setVisible(v) {
      this.visible = v;
      if (!v) {
        this.ctx.clearRect(0, 0, this._cssWidth, this._cssHeight);
      }
    }

    destroy() {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      this.canvas = null;
      this.ctx = null;
    }
  }

  window.HeatmapOverlay = HeatmapOverlay;

})();
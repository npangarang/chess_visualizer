/**
 * Popup — Controls for the Chess Pressure Heatmap extension.
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggleEl = document.getElementById('toggle');
  const radios = document.querySelectorAll('input[name="orientation"]');
  const calibrateBtn = document.getElementById('calibrateBtn');
  let calibrating = false;

  /* ---- helper: safely send a message to the active tab ---- */

  function sendToTab(msg, cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab || !tab.url) return;
      if (!tab.url.includes('chess.com')) return;

      chrome.tabs.sendMessage(tab.id, msg, (response) => {
        if (chrome.runtime.lastError) return;
        if (cb) cb(response);
      });
    });
  }

  /* ---- load current state from content script ---- */

  sendToTab({ type: 'getState' }, (state) => {
    if (!state) return;

    toggleEl.checked = state.enabled;

    if (state.manualOrientation) {
      const radio = document.querySelector(`input[value="${state.manualOrientation}"]`);
      if (radio) radio.checked = true;
    } else {
      const radio = document.querySelector('input[value="auto"]');
      if (radio) radio.checked = true;
    }
  });

  /* ---- toggle ---- */

  toggleEl.addEventListener('change', () => {
    sendToTab({ type: 'toggle', enabled: toggleEl.checked });
  });

  /* ---- orientation ---- */

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const val = radio.value === 'auto' ? null : radio.value;
      sendToTab({ type: 'setOrientation', orientation: val });
    });
  });

  /* ---- calibrate ---- */

  calibrateBtn.addEventListener('click', () => {
    calibrating = !calibrating;
    calibrateBtn.textContent = calibrating ? 'Calibrating... click to stop' : 'Calibrate Grid';
    calibrateBtn.classList.toggle('active', calibrating);
    sendToTab({ type: 'toggleCalibration', enabled: calibrating }, (resp) => {
      // If the content script had no overlay (e.g. board not found), revert UI state
      if (resp && resp.calibrationMode === false && calibrating) {
        calibrating = false;
        calibrateBtn.textContent = 'Calibrate Grid';
        calibrateBtn.classList.remove('active');
      }
    });
  });
});
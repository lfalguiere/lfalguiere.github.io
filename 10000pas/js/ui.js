import { state, DIFFICULTY, FINAL_RADIUS_M } from './state.js';
import { loadHistory, getStats } from './storage.js';
import { renderResultMap } from './map.js';

const SCREENS = ['setup', 'loading', 'game', 'result'];

export function showScreen(name) {
  SCREENS.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.style.display = s === name ? 'flex' : 'none';
  });
}

export function checkAndShowMobileWarning() {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = navigator.maxTouchPoints > 0;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const isLikelyMobile = coarsePointer || hasTouch || mobileUA;

  const el = document.getElementById('mobile-warning');
  if (el) el.style.display = isLikelyMobile ? 'none' : 'flex';
}

export function showErrorOnSetup(msg) {
  const el = document.getElementById('setup-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

export function clearSetupError() {
  const el = document.getElementById('setup-error');
  if (el) el.style.display = 'none';
}

export function setLoadingMessage(msg) {
  const el = document.getElementById('loading-message');
  if (el) el.textContent = msg;
}

export function updateLoadingProgress({ phase, attempt, totalAttempts }) {
  const bar = document.getElementById('loading-progress');
  const fill = document.getElementById('loading-progress-bar');
  if (phase === 'cache') {
    setLoadingMessage('Point d\'arrivée trouvé (cache local)…');
    if (bar) bar.style.display = 'none';
    return;
  }
  if (bar) bar.style.display = 'block';
  if (fill) fill.style.width = `${Math.round((attempt / totalAttempts) * 100)}%`;
  setLoadingMessage(`Recherche d'un point d'arrivée… (tentative ${attempt}/${totalAttempts})`);
}

export function resetLoadingProgress() {
  const bar = document.getElementById('loading-progress');
  const fill = document.getElementById('loading-progress-bar');
  if (bar) bar.style.display = 'none';
  if (fill) fill.style.width = '0%';
}

export function updateHUD() {
  const radiusEl = document.getElementById('hud-radius');
  const countdownEl = document.getElementById('hud-countdown');

  if (radiusEl) {
    const r = Math.round(state.zone.radiusMeters);
    radiusEl.textContent = r >= 1000
      ? `Zone : ${(r / 1000).toFixed(1)} km`
      : `Zone : ${r} m`;

    // Colore le rayon selon l'urgence
    if (r <= FINAL_RADIUS_M * 3) {
      radiusEl.classList.add('hud-danger');
    } else {
      radiusEl.classList.remove('hud-danger');
    }
  }

  if (countdownEl && state.zone.nextShrinkAt) {
    if (state.zone.radiusMeters <= FINAL_RADIUS_M) {
      countdownEl.innerHTML = '';
    } else {
      const remaining = state.zone.nextShrinkAt - Date.now();
      const timeStr = remaining > 0 ? formatCountdown(remaining) : '...';
      const urgent = remaining < 30000;
      countdownEl.innerHTML = `
        <span class="hud-timer-label">Rétrécissement dans</span>
        <span class="hud-timer-value${urgent ? ' timer-urgent' : ''}">${timeStr}</span>
      `;
    }
  }

  const distEl = document.getElementById('hud-distance');
  if (distEl) {
    const m = state.totalDistanceM;
    const distStr = m >= 1000
      ? `${(m / 1000).toFixed(2)} km`
      : `${Math.round(m)} m`;
    distEl.innerHTML = `
      <span class="hud-timer-label">Parcouru</span>
      <span class="hud-timer-value">${distStr}</span>
    `;
  }
}

export function updateGPSBadge(accuracy) {
  const el = document.getElementById('hud-gps');
  if (!el) return;
  if (accuracy === null) {
    el.textContent = 'GPS : perdu';
    el.className = 'hud-gps gps-lost';
  } else if (accuracy <= 15) {
    el.textContent = `GPS : ±${Math.round(accuracy)} m`;
    el.className = 'hud-gps gps-good';
  } else if (accuracy <= 40) {
    el.textContent = `GPS : ±${Math.round(accuracy)} m`;
    el.className = 'hud-gps gps-medium';
  } else {
    el.textContent = `GPS : ±${Math.round(accuracy)} m`;
    el.className = 'hud-gps gps-bad';
  }
}

export function showGPSLostBanner(show) {
  const el = document.getElementById('gps-lost-banner');
  if (el) el.style.display = show ? 'flex' : 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function populateResult(result) {
  const el = document.getElementById('result-content');
  if (!el) return;

  const icon = result.won ? '🏆' : '😞';
  const title = result.won ? 'Victoire !' : 'Échec !';
  const mins = Math.floor(result.durationSecs / 60);
  const secs = result.durationSecs % 60;
  const timeStr = `${mins}min ${secs}s`;
  const diffLabel = DIFFICULTY[result.difficulty]?.label ?? result.difficulty;
  const targetNameHtml = result.won && result.targetName
    ? (result.targetLink
        ? `<p class="result-target-name">🎯 <a href="${escapeHtml(result.targetLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.targetName)}</a></p>`
        : `<p class="result-target-name">🎯 ${escapeHtml(result.targetName)}</p>`)
    : '';

  el.innerHTML = `
    <div class="result-icon">${icon}</div>
    <h2 class="result-title${result.won ? ' won' : ''}">${title}</h2>
    ${targetNameHtml}
    <div class="result-stats">
      <div class="stat"><span class="stat-label">Distance</span><span class="stat-value">${result.distanceKm} km</span></div>
      <div class="stat"><span class="stat-label">Durée</span><span class="stat-value">${timeStr}</span></div>
      <div class="stat"><span class="stat-label">Difficulté</span><span class="stat-value">${diffLabel}</span></div>
    </div>
    <div id="result-map"></div>
  `;

  // Rendre la carte récapitulative après que le DOM est mis à jour.
  // Affiche le dernier cercle (celui qui a déterminé la victoire/défaite),
  // pas le cercle de départ.
  if (state.positionHistory.length >= 1 && state.zone.center) {
    requestAnimationFrame(() => {
      renderResultMap(
        'result-map',
        state.positionHistory,
        state.zone.center,
        state.zone.radiusMeters,
      );
    });
  }

  renderHistory('result-history-list');
}

export function renderHistory(listId = 'setup-history-list') {
  const el = document.getElementById(listId);
  if (!el) return;
  const history = loadHistory();
  const stats = getStats();

  if (!stats) {
    el.innerHTML = '<p class="history-empty">Aucune partie jouée</p>';
    return;
  }

  const statsHtml = `
    <div class="history-stats">
      <span>${stats.total} partie${stats.total > 1 ? 's' : ''}</span>
      <span>${stats.winRate}% victoires</span>
      <span>Max ${stats.maxDistKm} km</span>
    </div>
  `;

  const itemsHtml = history.slice(0, 10).map(h => {
    const date = new Date(h.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const icon = h.won ? '✓' : '✗';
    const cls = h.won ? 'history-win' : 'history-loss';
    return `<div class="history-item ${cls}">
      <span class="history-icon">${icon}</span>
      <span>${date}</span>
      <span>${h.distanceKm} km</span>
      <span>${DIFFICULTY[h.difficulty]?.label ?? h.difficulty}</span>
    </div>`;
  }).join('');

  el.innerHTML = statsHtml + itemsHtml;
}

function formatCountdown(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

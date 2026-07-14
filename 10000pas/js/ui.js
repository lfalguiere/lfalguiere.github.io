import { state, DIFFICULTY, getFinalRadius } from './state.js';
import { loadHistory, getStats } from './storage.js';
import { renderResultMap } from './map.js';
import { POI_ICONS, GENERIC_POI_ICON, NON_POI_ICON } from './icons.js';

const SCREENS = ['setup', 'loading', 'game', 'result'];

let showStepsMode = true; // affichage du pill "Parcouru" : true = Pas, false = Distance

const AVG_STEP_LENGTH_M = 0.75; // longueur de foulée moyenne (marche), pour estimer le nombre de pas

function estimateSteps(distanceM) {
  return Math.round(distanceM / AVG_STEP_LENGTH_M);
}

const STEPS_TIER_MID = 4400;
const STEPS_TIER_HIGH = 7700;

// Cumul des pas du jour : parties déjà terminées aujourd'hui (historique
// local) + distance de la partie en cours en temps réel.
function getTodaySteps() {
  const todayStr = new Date().toDateString();
  const historyM = loadHistory()
    .filter(h => new Date(h.date).toDateString() === todayStr)
    .reduce((sum, h) => sum + h.distanceKm * 1000, 0);
  const liveM = state.phase === 'playing' ? state.totalDistanceM : 0;
  return estimateSteps(historyM + liveM);
}

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

export function toggleDistanceDisplay() {
  showStepsMode = !showStepsMode;
  updateHUD();
}

export function updateHUD() {
  const radiusEl = document.getElementById('hud-radius');
  const countdownEl = document.getElementById('hud-countdown');
  const dailyStepsEl = document.getElementById('hud-daily-steps');

  if (dailyStepsEl) {
    const steps = getTodaySteps();
    dailyStepsEl.textContent = `Déjà ${steps.toLocaleString('fr-FR')} pas`;
    dailyStepsEl.classList.toggle('tier-high', steps >= STEPS_TIER_HIGH);
    dailyStepsEl.classList.toggle('tier-mid', steps >= STEPS_TIER_MID && steps < STEPS_TIER_HIGH);
  }

  if (radiusEl) {
    const d = Math.round(state.zone.radiusMeters * 2);
    radiusEl.textContent = d >= 1000
      ? `⌀ ${(d / 1000).toFixed(1)} km`
      : `⌀ ${d} m`;

    // Colore selon l'urgence (seuil basé sur le rayon réel, pas le diamètre affiché)
    if (state.zone.radiusMeters <= getFinalRadius() * 3) {
      radiusEl.classList.add('hud-danger');
    } else {
      radiusEl.classList.remove('hud-danger');
    }
  }

  if (countdownEl && state.zone.nextShrinkAt) {
    if (state.zone.radiusMeters <= getFinalRadius()) {
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

  const targetTypeEl = document.getElementById('hud-target-type');
  if (targetTypeEl) {
    const isPOI = !!state.targetPos?.name;
    const detailedIcon = state.difficulty === 'easy' ? POI_ICONS[state.targetPos?.poiType] : null;
    if (detailedIcon) {
      targetTypeEl.innerHTML = detailedIcon;
      targetTypeEl.title = `Cible : ${state.targetPos.poiType}`;
    } else if (isPOI) {
      targetTypeEl.innerHTML = GENERIC_POI_ICON;
      targetTypeEl.title = 'Cible : POI notable';
    } else {
      targetTypeEl.innerHTML = NON_POI_ICON;
      targetTypeEl.title = 'Cible : point anonyme';
    }
  }

  const distEl = document.getElementById('hud-distance');
  if (distEl) {
    const m = state.totalDistanceM;
    if (showStepsMode) {
      const steps = estimateSteps(m).toLocaleString('fr-FR');
      distEl.innerHTML = `
        <span class="hud-timer-label">Pas</span>
        <span class="hud-timer-value">${steps}</span>
      `;
    } else {
      distEl.innerHTML = `
        <span class="hud-timer-label">Distance</span>
        <span class="hud-timer-value">${Math.round(m)} m</span>
      `;
    }
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
      <div class="stat"><span class="stat-label">Distance</span><span class="stat-value">${result.distanceKm} km · ${estimateSteps(result.distanceKm * 1000).toLocaleString('fr-FR')} pas</span></div>
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

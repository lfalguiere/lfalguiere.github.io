import { state, DIFFICULTY, GPS_LOSS_THRESHOLD_MS, resetState } from './state.js';
import { getInitialPosition, startWatching, haversineDistance, randomPointInDisk } from './geo.js';
import { findTargetPoint } from './overpass.js';
import { initMap, invalidateMapSize, updatePlayerPosition, updateZoneCircle, fitMapToZone, updateTrail, renderResultMap } from './map.js';
import { startZone, checkPlayerInZone } from './zone.js';
import {
  showScreen, setLoadingMessage, updateHUD, updateGPSBadge,
  showGPSLostBanner, renderHistory, showErrorOnSetup, clearSetupError,
  checkAndShowMobileWarning, updateLoadingProgress, resetLoadingProgress
} from './ui.js';

let gpsLossCheckId = null;

function onGpsUpdate(position) {
  state.lastGpsUpdate = Date.now();
  showGPSLostBanner(false);

  const { latitude: lat, longitude: lng, accuracy } = position.coords;

  // Cumuler la distance et enregistrer le tracé (seulement en jeu, signal acceptable)
  if (state.phase === 'playing' && state.playerPos && accuracy <= 50) {
    const step = haversineDistance(state.playerPos.lat, state.playerPos.lng, lat, lng);
    if (step > 0 && step < 100) {
      state.totalDistanceM += step;
      updateHUD();
    }
    // Enregistrer la position si déplacement > 5 m (évite les doublons à l'arrêt)
    if (step >= 5) {
      state.positionHistory.push({ lat, lng });
      updateTrail(state.positionHistory);
    }
  }

  state.playerPos = { lat, lng, accuracy };
  updateGPSBadge(accuracy);
  updatePlayerPosition(lat, lng);

  if (state.phase === 'playing') {
    checkPlayerInZone();
  }
}

function onGpsError(err) {
  console.warn('GPS error:', err.message);
  updateGPSBadge(null);
}

function startGpsLossDetection() {
  clearInterval(gpsLossCheckId);
  gpsLossCheckId = setInterval(() => {
    if (state.phase !== 'playing') return;
    if (state.lastGpsUpdate && Date.now() - state.lastGpsUpdate > GPS_LOSS_THRESHOLD_MS) {
      showGPSLostBanner(true);
      updateGPSBadge(null);
    }
  }, 5000);
}

async function startGame() {
  const km = DIFFICULTY[state.difficulty].distanceM / 1000;
  state.desiredDistanceKm = km;
  state.phase = 'loading';
  showScreen('loading');
  resetLoadingProgress();

  // 1. Obtenir la position GPS initiale
  setLoadingMessage('Acquisition du signal GPS…');
  let position;
  try {
    position = await getInitialPosition();
  } catch (err) {
    alert('Impossible d\'obtenir votre position GPS. Vérifiez les autorisations.');
    state.phase = 'setup';
    showScreen('setup');
    return;
  }

  const { latitude: lat, longitude: lng, accuracy } = position.coords;

  // Bloquer si la précision est trop mauvaise (géolocalisation par IP ≈ >1 000 m)
  // Un vrai GPS donne typiquement 5–50 m de précision.
  const MAX_ACCURACY_M = 500;
  if (accuracy > MAX_ACCURACY_M) {
    showErrorOnSetup(
      `GPS insuffisant (précision ±${Math.round(accuracy / 1000)} km). ` +
      `Ce jeu nécessite un GPS activé sur un appareil mobile ou en extérieur.`
    );
    state.phase = 'setup';
    showScreen('setup');
    return;
  }

  state.playerPos = { lat, lng, accuracy };
  state.startPos = { lat, lng };
  state.positionHistory = [{ lat, lng }];

  // 2. Décaler le centre de la zone par rapport à la position du joueur
  // (sinon le joueur démarre pile au centre et n'a rien à faire au début)
  const radiusM = km * 1000;
  const zoneCenter = randomPointInDisk(lat, lng, radiusM * 0.7);

  // 3. Trouver un point cible accessible via Overpass, relatif au centre de zone
  setLoadingMessage('Recherche d\'un point d\'arrivée…');
  const target = await findTargetPoint(zoneCenter.lat, zoneCenter.lng, radiusM, updateLoadingProgress);

  if (!target) {
    alert('Aucun chemin accessible trouvé dans cette zone. Réessayez dans quelques secondes.');
    state.phase = 'setup';
    showScreen('setup');
    disableStartBtnTemporarily(8000);
    return;
  }

  state.targetPos = target;

  // 4. Initialiser la zone
  state.zone.center = zoneCenter;
  state.zone.radiusMeters = radiusM;

  // 5. Afficher la carte
  showScreen('game');
  initMap('map');
  requestAnimationFrame(() => {
    invalidateMapSize();
    fitMapToZone(zoneCenter.lat, zoneCenter.lng, radiusM);
    updateZoneCircle(zoneCenter.lat, zoneCenter.lng, radiusM, false);
    updatePlayerPosition(lat, lng);
    updateGPSBadge(accuracy);
  });

  // 6. Lancer le suivi GPS et les timers de zone
  state.phase = 'playing';
  state.startTime = Date.now();
  state.lastGpsUpdate = Date.now();

  state.gpsWatchId = startWatching(onGpsUpdate, onGpsError);
  startGpsLossDetection();
  startZone();
}

function disableStartBtnTemporarily(ms) {
  const btn = document.getElementById('start-btn');
  if (!btn) return;
  btn.disabled = true;
  const original = btn.textContent;
  let remaining = Math.ceil(ms / 1000);
  btn.textContent = `Patientez (${remaining}s)…`;
  const id = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(id);
      btn.disabled = false;
      btn.textContent = original;
    } else {
      btn.textContent = `Patientez (${remaining}s)…`;
    }
  }, 1000);
}

function setupUI() {
  // Sélection de la difficulté
  document.querySelectorAll('.difficulty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.difficulty = btn.dataset.difficulty;
    });
  });

  // Bouton démarrer
  document.getElementById('start-btn')?.addEventListener('click', startGame);

  // Bouton rejouer
  document.getElementById('replay-btn')?.addEventListener('click', () => {
    resetState();
    clearSetupError();
    renderHistory();
    showScreen('setup');
  });

  // Toggle historique sur l'écran setup
  document.getElementById('history-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('history-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // Marquer la difficulté par défaut
  document.querySelector('[data-difficulty="medium"]')?.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  setupUI();
  renderHistory();
  checkAndShowMobileWarning();
  showScreen('setup');
});

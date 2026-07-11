import { state, DIFFICULTY, GPS_LOSS_THRESHOLD_MS, resetState } from './state.js';
import { getInitialPosition, startWatching, haversineDistance } from './geo.js';
import { findTargetPoint } from './overpass.js';
import { initMap, invalidateMapSize, updatePlayerPosition, updateZoneCircle, fitMapToZone, updateTrail, renderResultMap } from './map.js';
import { startZone, checkPlayerInZone } from './zone.js';
import {
  showScreen, setLoadingMessage, updateHUD, updateGPSBadge,
  showGPSLostBanner, renderHistory, showErrorOnSetup, clearSetupError,
  checkAndShowMobileWarning
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
  const distInput = document.getElementById('distance-input');
  const km = parseFloat(distInput?.value ?? '2');
  if (isNaN(km) || km < 0.5 || km > 15) {
    alert('Distance invalide. Choisissez entre 0,5 et 15 km.');
    return;
  }

  state.desiredDistanceKm = km;
  state.phase = 'loading';
  showScreen('loading');

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

  // 2. Trouver un point cible accessible via Overpass
  setLoadingMessage('Recherche d\'un point d\'arrivée…');
  const radiusM = km * 1000;
  const target = await findTargetPoint(lat, lng, radiusM);

  if (!target) {
    alert('Aucun chemin accessible trouvé dans cette zone. Essayez une autre distance ou un autre lieu.');
    state.phase = 'setup';
    showScreen('setup');
    return;
  }

  state.targetPos = target;

  // 3. Initialiser la zone
  state.zone.center = { lat, lng };
  state.zone.radiusMeters = radiusM;
  state.zone.initialCenter = { lat, lng };
  state.zone.initialRadius = radiusM;

  // 4. Afficher la carte
  showScreen('game');
  initMap('map');
  requestAnimationFrame(() => {
    invalidateMapSize();
    fitMapToZone(lat, lng, radiusM);
    updateZoneCircle(lat, lng, radiusM, false);
    updatePlayerPosition(lat, lng);
    updateGPSBadge(accuracy);
  });

  // 5. Lancer le suivi GPS et les timers de zone
  state.phase = 'playing';
  state.startTime = Date.now();
  state.lastGpsUpdate = Date.now();

  state.gpsWatchId = startWatching(onGpsUpdate, onGpsError);
  startGpsLossDetection();
  startZone();
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

import { state, DIFFICULTY, FINAL_RADIUS_M } from './state.js';
import { haversineDistance, metersToLatDeg, metersToLngDeg } from './geo.js';
import { updateZoneCircle, zoomToZone, updatePreviewCircle, hidePreviewCircle } from './map.js';
import { updateHUD, showScreen, populateResult } from './ui.js';
import { saveResult } from './storage.js';

// Calcule le nouveau centre avec deux contraintes :
// 1. dist(C', T) ≤ newRadius         → cible reste dans le nouveau cercle
// 2. dist(C', C) ≤ R - newRadius     → nouveau cercle inscrit dans le cercle ACTUEL
//    (pas le cercle de départ — sinon deux cercles successifs peuvent se chevaucher
//    sans être emboîtés, ce qui donne l'impression que le cercle suivant "dépasse").
//
// L'intersection de ces deux disques est toujours non-vide : par construction, la
// cible est toujours contenue dans le cercle courant (chaque étape échantillonne
// dans disk(cible, rayon), donc dist(cible, centre_i) ≤ rayon_i à chaque palier).
function computeNewCenter(target, newRadius) {
  const { center: C, radiusMeters: R } = state.zone;
  const maxDistFromC = R - newRadius;

  for (let i = 0; i < 50; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(Math.random()) * newRadius;
    const candidate = {
      lat: target.lat + metersToLatDeg(r * Math.sin(angle)),
      lng: target.lng + metersToLngDeg(r * Math.cos(angle), target.lat),
    };
    if (haversineDistance(candidate.lat, candidate.lng, C.lat, C.lng) <= maxDistFromC) {
      return candidate;
    }
  }

  // Fallback déterministe : point sur le segment T→C dans la plage valide.
  const d = haversineDistance(target.lat, target.lng, C.lat, C.lng);
  const dSafe = d || 1;
  const tMin = Math.max(0, 1 - maxDistFromC / dSafe);
  const tMax = Math.min(1, newRadius / dSafe);
  const t = (tMin + tMax) / 2;
  return {
    lat: target.lat + t * (C.lat - target.lat),
    lng: target.lng + t * (C.lng - target.lng),
  };
}

function formatCountdown(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function endGame(won) {
  clearTimeout(state.zone.timerId);
  clearInterval(state.zone.countdownId);
  state.zone.timerId = null;
  state.zone.countdownId = null;

  if (state.gpsWatchId !== null) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
  }

  // S'assurer que la position finale du joueur figure dans le tracé, même si
  // elle n'a pas atteint le seuil de 5 m depuis le dernier point enregistré
  // (parties très courtes) — sinon la carte récapitulative n'a rien à tracer.
  if (state.playerPos) {
    const last = state.positionHistory[state.positionHistory.length - 1];
    const isNew = !last || haversineDistance(last.lat, last.lng, state.playerPos.lat, state.playerPos.lng) > 0;
    if (isNew) {
      state.positionHistory.push({ lat: state.playerPos.lat, lng: state.playerPos.lng });
    }
  }

  const durationSecs = Math.floor((Date.now() - state.startTime) / 1000);
  const distanceKm = state.totalDistanceM / 1000;

  const result = {
    won,
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationSecs,
    difficulty: state.difficulty,
    targetName: state.targetPos?.name ?? null,
    targetLink: state.targetPos?.link ?? null,
    date: new Date().toISOString(),
  };

  saveResult(result);
  state.phase = won ? 'victory' : 'loss';
  populateResult(result);
  showScreen('result');
}

// Réduction en pourcentage du rayon courant (cf. DIFFICULTY.shrinkPct) : un
// pourcentage faible donne des paliers plus nombreux et progressifs.
function computeNextZone(baseRadius) {
  const cfg = DIFFICULTY[state.difficulty];
  const newRadius = Math.max(FINAL_RADIUS_M, baseRadius * (1 - cfg.shrinkPct));
  const newCenter = computeNewCenter(state.targetPos, newRadius);
  return { center: newCenter, radius: newRadius };
}

function shrinkZone() {
  // Consomme la prochaine zone précalculée (affichée en aperçu pointillé)
  // plutôt que de la recalculer, pour que l'aperçu corresponde exactement
  // au résultat réel du rétrécissement.
  const next = (state.zone.nextCenter && state.zone.nextRadiusMeters != null)
    ? { center: state.zone.nextCenter, radius: state.zone.nextRadiusMeters }
    : computeNextZone(state.zone.radiusMeters);

  state.zone.center = next.center;
  state.zone.radiusMeters = next.radius;

  updateZoneCircle(next.center.lat, next.center.lng, next.radius);
  zoomToZone(next.center.lat, next.center.lng, next.radius);
  updateHUD();

  // Vérifier si le joueur est sorti du cercle après le déplacement du centre.
  // Nécessaire car le cercle peut se déplacer loin du joueur (pas seulement
  // l'inverse), et le GPS ne se met pas toujours à jour entre deux paliers.
  checkPlayerInZone();

  // Vérification de fin de partie (rayon minimal)
  if (next.radius <= FINAL_RADIUS_M) {
    state.zone.nextCenter = null;
    state.zone.nextRadiusMeters = null;
    hidePreviewCircle();

    const distPlayer = state.playerPos
      ? haversineDistance(
          state.playerPos.lat, state.playerPos.lng,
          next.center.lat, next.center.lng
        )
      : Infinity;
    endGame(distPlayer <= FINAL_RADIUS_M);
  } else {
    const following = computeNextZone(next.radius);
    state.zone.nextCenter = following.center;
    state.zone.nextRadiusMeters = following.radius;
    // Le pointillé ne redevient visible que dans la fenêtre previewLeadRatio
    // avant le prochain rétrécissement (cf. updatePreviewVisibility) — on le
    // masque ici pour le nouveau palier qui démarre.
    hidePreviewCircle();
  }
}

// Révèle ou masque le cercle pointillé selon le temps restant avant le
// prochain rétrécissement, par rapport à previewLeadRatio × l'intervalle
// courant (recalculé à chaque palier, cf. scheduleNextShrink).
function updatePreviewVisibility() {
  if (!state.zone.nextCenter || state.zone.nextRadiusMeters == null || !state.zone.nextShrinkAt) return;
  const cfg = DIFFICULTY[state.difficulty];
  const leadMs = state.zone.currentIntervalMs * cfg.previewLeadRatio;
  const remaining = state.zone.nextShrinkAt - Date.now();
  if (remaining <= leadMs) {
    updatePreviewCircle(state.zone.nextCenter.lat, state.zone.nextCenter.lng, state.zone.nextRadiusMeters);
  } else {
    hidePreviewCircle();
  }
}

function onShrinkTimerFire() {
  if (state.phase !== 'playing') return;
  shrinkZone();
  if (state.zone.radiusMeters > FINAL_RADIUS_M) {
    scheduleNextShrink();
  }
}

// Programme le prochain rétrécissement : l'intervalle est proportionnel au
// rayon courant (radiusMeters × intervalMsPerMeter), donc le rythme
// s'accélère naturellement à mesure que le cercle rétrécit. Se reprogramme
// elle-même après chaque shrinkZone() tant que la partie continue.
function scheduleNextShrink() {
  const cfg = DIFFICULTY[state.difficulty];
  const intervalMs = state.zone.radiusMeters * cfg.intervalMsPerMeter;
  state.zone.currentIntervalMs = intervalMs;
  state.zone.nextShrinkAt = Date.now() + intervalMs;
  state.zone.timerId = setTimeout(onShrinkTimerFire, intervalMs);
}

// Debug/test : un clic sur le timer saute à l'apparition du pointillé (si on
// n'y est pas encore), un second clic déclenche le rétrécissement immédiat.
export function skipTimer() {
  if (state.phase !== 'playing' || state.zone.currentIntervalMs == null || !state.zone.nextShrinkAt) return;
  const cfg = DIFFICULTY[state.difficulty];
  const leadMs = state.zone.currentIntervalMs * cfg.previewLeadRatio;
  const remaining = state.zone.nextShrinkAt - Date.now();

  clearTimeout(state.zone.timerId);
  if (remaining > leadMs) {
    state.zone.nextShrinkAt = Date.now() + leadMs;
    state.zone.timerId = setTimeout(onShrinkTimerFire, leadMs);
    updatePreviewVisibility();
    updateHUD();
  } else {
    onShrinkTimerFire();
  }
}

export function checkPlayerInZone() {
  if (!state.playerPos || !state.zone.center || state.phase !== 'playing') return;
  const dist = haversineDistance(
    state.playerPos.lat, state.playerPos.lng,
    state.zone.center.lat, state.zone.center.lng
  );
  // Tolérance GPS plafonnée à 30 m (évite les faux positifs sur mauvais signal,
  // mais n'annule pas la détection pour les géoloc IP avec accuracy > 100 m)
  const margin = Math.min(30, Math.max(0, state.playerPos.accuracy));
  if (dist - margin > state.zone.radiusMeters) {
    endGame(false);
  }
}

export function startZone() {
  const preview = computeNextZone(state.zone.radiusMeters);
  state.zone.nextCenter = preview.center;
  state.zone.nextRadiusMeters = preview.radius;

  scheduleNextShrink();
  updatePreviewVisibility();
  updateHUD();

  state.zone.countdownId = setInterval(() => {
    if (state.phase !== 'playing') return;
    updateHUD();
    updatePreviewVisibility();
  }, 1000);
}

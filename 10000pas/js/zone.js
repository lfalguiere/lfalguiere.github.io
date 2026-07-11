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
  clearInterval(state.zone.timerId);
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
    date: new Date().toISOString(),
  };

  saveResult(result);
  state.phase = won ? 'victory' : 'loss';
  populateResult(result);
  showScreen('result');
}

// Réduction absolue = vitesse_cible × durée_intervalle
// Garantit le même effort physique à chaque palier quelle que soit la taille du cercle.
function computeNextZone(baseRadius) {
  const cfg = DIFFICULTY[state.difficulty];
  const shrinkM = (cfg.speedKmh * 1000 / 3600) * (cfg.intervalMs / 1000);
  const newRadius = Math.max(FINAL_RADIUS_M, baseRadius - shrinkM);
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
    updatePreviewCircle(following.center.lat, following.center.lng, following.radius);
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
  const cfg = DIFFICULTY[state.difficulty];
  state.zone.nextShrinkAt = Date.now() + cfg.intervalMs;

  const preview = computeNextZone(state.zone.radiusMeters);
  state.zone.nextCenter = preview.center;
  state.zone.nextRadiusMeters = preview.radius;
  updatePreviewCircle(preview.center.lat, preview.center.lng, preview.radius);

  updateHUD();

  state.zone.timerId = setInterval(() => {
    if (state.phase !== 'playing') return;
    shrinkZone();
    if (state.zone.radiusMeters > FINAL_RADIUS_M) {
      state.zone.nextShrinkAt = Date.now() + cfg.intervalMs;
    }
  }, cfg.intervalMs);

  state.zone.countdownId = setInterval(() => {
    if (state.phase !== 'playing') return;
    updateHUD();
  }, 1000);
}

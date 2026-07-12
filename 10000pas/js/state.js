export const state = {
  phase: 'setup', // 'setup' | 'loading' | 'playing' | 'victory' | 'loss'
  difficulty: 'medium',
  desiredDistanceKm: null,
  playerPos: null,     // { lat, lng, accuracy }
  targetPos: null,     // { lat, lng } — jamais affiché sur la carte
  pathCandidates: [],  // [{lat,lng}] — points de chemin réels (Overpass) réutilisés pour placer les centres de zone sur des endroits praticables
  zone: {
    center: null,         // { lat, lng }
    radiusMeters: 0,
    nextCenter: null,        // centre précalculé du prochain rétrécissement (aperçu)
    nextRadiusMeters: null,
    nextShrinkAt: null,
    currentIntervalMs: null, // intervalle du palier en cours (recalculé à chaque palier)
    timerId: null,
    countdownId: null,
  },
  startTime: null,
  startPos: null,
  totalDistanceM: 0,   // cumul des distances entre positions GPS successives
  positionHistory: [], // [{lat, lng}] — points enregistrés pour le tracé du parcours
  gpsWatchId: null,
  lastGpsUpdate: null,
};

// shrinkPct : fraction du rayon courant retirée à chaque palier — pilote le
// nombre de paliers (faible % = progressif = beaucoup de paliers, adapté aux
// grandes cartes ; % élevé = rapide = peu de paliers, adapté aux petites).
// intervalMsPerMeter : temps d'attente par mètre de distance RÉELLE entre le
// centre actuel et le prochain centre déjà tiré au sort (pas le rayon — la
// distance réelle est souvent bien inférieure au pire cas théorique R×shrinkPct,
// donc le temps donné colle à ce qu'il faut vraiment parcourir ce palier-là).
// Calibré pour qu'un joueur à la vitesse supposée du niveau (marche/marche
// rapide/course) ait le temps de parcourir cette distance avec une marge de
// sécurité ×1.5 au-dessus du minimum théorique (ligne droite parfaite) :
// intervalMsPerMeter = 1.5 × 1000 / vitesse_m_s.
// L'intervalle réel ajoute aussi BASELINE_MS (zone.js, 20s partagé entre les
// niveaux) — un temps de réaction/logistique incompressible qui ne diminue
// pas avec la distance, sans quoi les paliers de fin de partie (distance très
// courte) deviennent trop rapides pour être gérables.
// previewLeadRatio : fraction de l'intervalle courant pendant laquelle le
// cercle pointillé (prochaine zone) devient visible.
export const DIFFICULTY = {
  easy:   { shrinkPct: 0.50, intervalMsPerMeter: 1800, previewLeadRatio: 1 / 2, distanceM: 500,  label: 'Facile'     },
  medium: { shrinkPct: 0.30, intervalMsPerMeter: 1080, previewLeadRatio: 1 / 2, distanceM: 1000, label: 'Moyen'      },
  hard:   { shrinkPct: 0.20, intervalMsPerMeter: 600,  previewLeadRatio: 1 / 2, distanceM: 2000, label: 'Difficile'  },
};

export const FINAL_RADIUS_M = 20;
export const GPS_LOSS_THRESHOLD_MS = 30000;

export function resetState() {
  clearTimeout(state.zone.timerId);
  clearInterval(state.zone.countdownId);
  if (state.gpsWatchId !== null) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
  }
  state.phase = 'setup';
  state.playerPos = null;
  state.targetPos = null;
  state.pathCandidates = [];
  state.zone.center = null;
  state.zone.radiusMeters = 0;
  state.zone.nextCenter = null;
  state.zone.nextRadiusMeters = null;
  state.zone.nextShrinkAt = null;
  state.zone.currentIntervalMs = null;
  state.zone.timerId = null;
  state.zone.countdownId = null;
  state.startTime = null;
  state.startPos = null;
  state.totalDistanceM = 0;
  state.positionHistory = [];
  state.gpsWatchId = null;
  state.lastGpsUpdate = null;
}

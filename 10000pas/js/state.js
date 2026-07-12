export const state = {
  phase: 'setup', // 'setup' | 'loading' | 'playing' | 'victory' | 'loss'
  difficulty: 'medium',
  desiredDistanceKm: null,
  playerPos: null,     // { lat, lng, accuracy }
  targetPos: null,     // { lat, lng } — jamais affiché sur la carte
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
// intervalMsPerMeter : temps d'attente par mètre de rayon courant — recalculé
// à chaque palier (radiusMeters × intervalMsPerMeter), donc le rythme
// s'accélère naturellement à mesure que le cercle rétrécit. Calibré pour
// qu'un joueur à la vitesse supposée du niveau (marche/marche rapide/course)
// ait le temps de parcourir la distance pire cas d'un palier (rayon × shrinkPct),
// avec une marge de sécurité ×1.5 au-dessus du minimum théorique (ligne
// droite parfaite, sans imprécision GPS ni temps de réaction) :
// intervalMsPerMeter = 1.5 × 1000 × shrinkPct / vitesse_m_s.
// previewLeadRatio : fraction de l'intervalle courant pendant laquelle le
// cercle pointillé (prochaine zone) devient visible.
export const DIFFICULTY = {
  easy:   { shrinkPct: 0.50, intervalMsPerMeter: 900, previewLeadRatio: 1 / 3, distanceM: 500,  label: 'Facile'     },
  medium: { shrinkPct: 0.30, intervalMsPerMeter: 324, previewLeadRatio: 1 / 3, distanceM: 1000, label: 'Moyen'      },
  hard:   { shrinkPct: 0.20, intervalMsPerMeter: 120, previewLeadRatio: 1 / 3, distanceM: 2000, label: 'Difficile'  },
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

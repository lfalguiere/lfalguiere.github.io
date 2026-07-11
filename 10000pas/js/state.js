export const state = {
  phase: 'setup', // 'setup' | 'loading' | 'playing' | 'victory' | 'loss'
  difficulty: 'medium',
  desiredDistanceKm: 2,
  playerPos: null,     // { lat, lng, accuracy }
  targetPos: null,     // { lat, lng } — jamais affiché sur la carte
  zone: {
    center: null,         // { lat, lng }
    radiusMeters: 0,
    initialCenter: null,  // centre du cercle de départ (ne change jamais)
    initialRadius: 0,     // rayon du cercle de départ (ne change jamais)
    nextShrinkAt: null,
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

// speedKmh : vitesse cible du joueur à ce niveau.
// La réduction absolue par palier = speedKmh × intervalMs/3600000 mètres,
// ce qui donne ~250 m/palier pour tous les niveaux — effort constant tout au long.
// La difficulté joue sur la fréquence des paliers et la vitesse requise.
export const DIFFICULTY = {
  easy:   { intervalMs: 300000, speedKmh: 3,  label: 'Facile'     },
  medium: { intervalMs: 180000, speedKmh: 5,  label: 'Moyen'      },
  hard:   { intervalMs:  90000, speedKmh: 10, label: 'Difficile'  },
};

export const FINAL_RADIUS_M = 20;
export const GPS_LOSS_THRESHOLD_MS = 30000;

export function resetState() {
  clearInterval(state.zone.timerId);
  clearInterval(state.zone.countdownId);
  if (state.gpsWatchId !== null) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
  }
  state.phase = 'setup';
  state.playerPos = null;
  state.targetPos = null;
  state.zone.center = null;
  state.zone.radiusMeters = 0;
  state.zone.initialCenter = null;
  state.zone.initialRadius = 0;
  state.zone.nextShrinkAt = null;
  state.zone.timerId = null;
  state.zone.countdownId = null;
  state.startTime = null;
  state.startPos = null;
  state.totalDistanceM = 0;
  state.positionHistory = [];
  state.gpsWatchId = null;
  state.lastGpsUpdate = null;
}

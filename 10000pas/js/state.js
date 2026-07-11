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
// La réduction absolue par palier = speedKmh × intervalMs/3600000 mètres —
// effort constant à chaque palier pour un niveau donné. Facile a des paliers
// plus courts et donc plus petits (~50 m) que Moyen/Difficile (~250 m),
// pour des retours plus fréquents sans changer le rythme de marche requis.
export const DIFFICULTY = {
  easy:   { intervalMs: 60000,  speedKmh: 3,  distanceM: 500,  label: 'Facile'     },
  medium: { intervalMs: 180000, speedKmh: 5,  distanceM: 1000, label: 'Moyen'      },
  hard:   { intervalMs:  90000, speedKmh: 10, distanceM: 2000, label: 'Difficile'  },
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
  state.zone.nextCenter = null;
  state.zone.nextRadiusMeters = null;
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

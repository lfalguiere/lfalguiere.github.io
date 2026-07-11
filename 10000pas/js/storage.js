const KEY = 'zone-runner-history';

export function saveResult(result) {
  const history = loadHistory();
  history.unshift(result);
  if (history.length > 50) history.pop();
  try {
    localStorage.setItem(KEY, JSON.stringify(history));
  } catch {/* storage full */}
}

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

export function getStats() {
  const history = loadHistory();
  if (history.length === 0) return null;
  const wins = history.filter(h => h.won).length;
  const maxDist = Math.max(...history.map(h => h.distanceKm));
  const totalTime = history.reduce((acc, h) => acc + h.durationSecs, 0);
  return {
    total: history.length,
    wins,
    winRate: Math.round((wins / history.length) * 100),
    maxDistKm: maxDist,
    totalTimeSecs: totalTime,
  };
}

const OVERPASS_CACHE_KEY = 'zone-runner-overpass-cache';
const OVERPASS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const OVERPASS_CACHE_MAX_ENTRIES = 30;

function overpassCacheKeyFor(lat, lng, radiusM) {
  const grid = 0.0045; // ~500 m
  const gridLat = (Math.round(lat / grid) * grid).toFixed(4);
  const gridLng = (Math.round(lng / grid) * grid).toFixed(4);
  const radiusBucket = Math.round(radiusM / 100); // rayons désormais petits : 500/1000/2000 m
  return `${gridLat},${gridLng}@${radiusBucket}`;
}

export function getCachedCandidates(lat, lng, radiusM) {
  try {
    const cache = JSON.parse(localStorage.getItem(OVERPASS_CACHE_KEY)) ?? {};
    const entry = cache[overpassCacheKeyFor(lat, lng, radiusM)];
    if (!entry || Date.now() - entry.cachedAt > OVERPASS_CACHE_TTL_MS) return null;
    return entry.candidates;
  } catch {
    return null;
  }
}

export function saveCandidatesToCache(lat, lng, radiusM, candidates) {
  try {
    const cache = JSON.parse(localStorage.getItem(OVERPASS_CACHE_KEY)) ?? {};
    cache[overpassCacheKeyFor(lat, lng, radiusM)] = { candidates, cachedAt: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > OVERPASS_CACHE_MAX_ENTRIES) {
      keys
        .sort((a, b) => cache[a].cachedAt - cache[b].cachedAt)
        .slice(0, keys.length - OVERPASS_CACHE_MAX_ENTRIES)
        .forEach(k => delete cache[k]);
    }
    localStorage.setItem(OVERPASS_CACHE_KEY, JSON.stringify(cache));
  } catch {/* storage plein ou désactivé */}
}

import { haversineDistance } from './geo.js';
import { getCachedCandidates, saveCandidatesToCache } from './storage.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const QUERY_TIMEOUT_S = 15;              // [timeout:N] côté serveur
const QUERY_CLIENT_TIMEOUT_MS = 18000;   // AbortSignal côté client (> timeout serveur)
const FALLBACK_TIMEOUT_S = 8;
const FALLBACK_CLIENT_TIMEOUT_MS = 10000;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 8000;
const NAMED_POI_MIN_COUNT = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseRetryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

async function queryOverpass(ql, timeoutMs) {
  let lastError = null;
  for (let i = 0; i < ENDPOINTS.length; i++) {
    try {
      const res = await fetch(ENDPOINTS[i], {
        method: 'POST',
        body: 'data=' + encodeURIComponent(ql),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();

      if (res.status === 429 || res.status === 504) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('Retry-After')) ?? BASE_BACKOFF_MS;
        lastError = Object.assign(new Error(`overpass_${res.status}`), { rateLimited: true, retryAfterMs });
        if (i < ENDPOINTS.length - 1) await sleep(Math.min(retryAfterMs, MAX_BACKOFF_MS));
        continue;
      }
      lastError = new Error(`overpass_${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Tous les serveurs Overpass sont inaccessibles');
}

function buildQuery(lat, lng, radiusM, simpleMode = false) {
  if (simpleMode) {
    return `[out:json][timeout:${QUERY_TIMEOUT_S}];
(
  way["highway"](around:${Math.round(radiusM)},${lat},${lng});
);
node(w);
out body;`;
  }
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];
(
  way["highway"~"^(footway|path|pedestrian|residential|living_street|service|track|unclassified|tertiary|secondary)$"](around:${Math.round(radiusM)},${lat},${lng});
  way["leisure"~"^(park|garden|common|recreation_ground)$"](around:${Math.round(radiusM)},${lat},${lng});
);
node(w);
(
  ._;
  node["amenity"~"^(place_of_worship|townhall|school)$"]["name"](around:${Math.round(radiusM)},${lat},${lng});
  node["historic"~"^(monument|memorial|castle|ruins)$"]["name"](around:${Math.round(radiusM)},${lat},${lng});
  node["tourism"~"^(attraction|viewpoint|museum|artwork)$"]["name"](around:${Math.round(radiusM)},${lat},${lng});
);
out body;`;
}

function isNotablePOI(tags) {
  if (!tags || !tags.name) return false;
  if (/^(place_of_worship|townhall|school)$/.test(tags.amenity || '')) return true;
  if (/^(monument|memorial|castle|ruins)$/.test(tags.historic || '')) return true;
  if (/^(attraction|viewpoint|museum|artwork)$/.test(tags.tourism || '')) return true;
  return false;
}

function filterCandidates(nodes, centerLat, centerLng, radiusM) {
  return nodes.filter(n => {
    const d = haversineDistance(centerLat, centerLng, n.lat, n.lon);
    return d >= radiusM * 0.4 && d <= radiusM * 0.92;
  });
}

function pickRandom(candidates) {
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const name = pick.tags?.name;
  return { lat: pick.lat, lng: pick.lon, ...(name ? { name } : {}) };
}

function backoffFor(err, attemptIndex) {
  if (err?.rateLimited) return Math.min(err.retryAfterMs, MAX_BACKOFF_MS);
  return Math.min(BASE_BACKOFF_MS * 2 ** attemptIndex, MAX_BACKOFF_MS);
}

export async function findTargetPoint(centerLat, centerLng, radiusM, onProgress = () => {}) {
  const cached = getCachedCandidates(centerLat, centerLng, radiusM);
  if (cached) {
    const candidates = filterCandidates(
      cached.map(c => ({ lat: c.lat, lon: c.lng, tags: c.tags })), centerLat, centerLng, radiusM
    );
    if (candidates.length > 0) {
      onProgress({ phase: 'cache' });
      const namedPOIs = candidates.filter(c => isNotablePOI(c.tags));
      const pool = namedPOIs.length >= NAMED_POI_MIN_COUNT ? namedPOIs : candidates;
      return pickRandom(pool);
    }
  }

  const attempts = [
    { simple: false, label: 1 },
    { simple: true, label: 2 },
  ];

  for (const { simple, label } of attempts) {
    onProgress({ attempt: label, totalAttempts: 3 });
    try {
      const data = await queryOverpass(buildQuery(centerLat, centerLng, radiusM, simple), QUERY_CLIENT_TIMEOUT_MS);
      const nodes = data.elements.filter(e => e.type === 'node');
      const candidates = filterCandidates(nodes, centerLat, centerLng, radiusM);
      if (candidates.length > 0) {
        saveCandidatesToCache(centerLat, centerLng, radiusM, candidates.map(c => ({ lat: c.lat, lng: c.lon, tags: c.tags })));
        const namedPOIs = candidates.filter(c => isNotablePOI(c.tags));
        const pool = namedPOIs.length >= NAMED_POI_MIN_COUNT ? namedPOIs : candidates;
        return pickRandom(pool);
      }
    } catch (err) {
      await sleep(backoffFor(err, label - 1));
    }
  }

  // Tentative 3 : point aléatoire + snap sur le nœud le plus proche
  onProgress({ attempt: 3, totalAttempts: 3 });
  const angle = Math.random() * 2 * Math.PI;
  const dist = radiusM * (0.4 + Math.random() * 0.5);
  const fallbackLat = centerLat + (dist * Math.sin(angle)) / 111320;
  const fallbackLng = centerLng + (dist * Math.cos(angle)) / (111320 * Math.cos(centerLat * Math.PI / 180));
  try {
    const snapQuery = `[out:json][timeout:${FALLBACK_TIMEOUT_S}];node(around:300,${fallbackLat},${fallbackLng});out body 1;`;
    const data = await queryOverpass(snapQuery, FALLBACK_CLIENT_TIMEOUT_MS);
    const nodes = data.elements.filter(e => e.type === 'node');
    if (nodes.length > 0) {
      return { lat: nodes[0].lat, lng: nodes[0].lon };
    }
  } catch {/* abandon */}

  return null;
}

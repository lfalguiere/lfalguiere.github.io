import { haversineDistance } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function queryOverpass(ql) {
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(ql),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      continue;
    }
  }
  throw new Error('Tous les serveurs Overpass sont inaccessibles');
}

function buildQuery(lat, lng, radiusM, simpleMode = false) {
  if (simpleMode) {
    return `[out:json][timeout:25];
(
  way["highway"](around:${Math.round(radiusM)},${lat},${lng});
);
node(w);
out body;`;
  }
  return `[out:json][timeout:25];
(
  way["highway"~"^(footway|path|pedestrian|residential|living_street|service|track|unclassified|tertiary|secondary)$"](around:${Math.round(radiusM)},${lat},${lng});
  way["leisure"~"^(park|garden|common|recreation_ground)$"](around:${Math.round(radiusM)},${lat},${lng});
);
node(w);
out body;`;
}

function filterCandidates(nodes, centerLat, centerLng, radiusM) {
  return nodes.filter(n => {
    const d = haversineDistance(centerLat, centerLng, n.lat, n.lon);
    return d >= radiusM * 0.4 && d <= radiusM * 0.92;
  });
}

export async function findTargetPoint(centerLat, centerLng, radiusM) {
  // Tentative 1 : requête complète
  try {
    const data = await queryOverpass(buildQuery(centerLat, centerLng, radiusM));
    const nodes = data.elements.filter(e => e.type === 'node');
    const candidates = filterCandidates(nodes, centerLat, centerLng, radiusM);
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return { lat: pick.lat, lng: pick.lon };
    }
  } catch {/* fallback */}

  // Tentative 2 : rayon élargi de 30 %
  const widerRadius = radiusM * 1.3;
  try {
    const data = await queryOverpass(buildQuery(centerLat, centerLng, widerRadius));
    const nodes = data.elements.filter(e => e.type === 'node');
    const candidates = filterCandidates(nodes, centerLat, centerLng, widerRadius);
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return { lat: pick.lat, lng: pick.lon };
    }
  } catch {/* fallback */}

  // Tentative 3 : mode simplifié (highway seul)
  try {
    const data = await queryOverpass(buildQuery(centerLat, centerLng, radiusM, true));
    const nodes = data.elements.filter(e => e.type === 'node');
    const candidates = filterCandidates(nodes, centerLat, centerLng, radiusM);
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return { lat: pick.lat, lng: pick.lon };
    }
  } catch {/* fallback */}

  // Tentative 4 : nœud quelconque dans 200 m au hasard
  const angle = Math.random() * 2 * Math.PI;
  const dist = radiusM * (0.4 + Math.random() * 0.5);
  const fallbackLat = centerLat + (dist * Math.sin(angle)) / 111320;
  const fallbackLng = centerLng + (dist * Math.cos(angle)) / (111320 * Math.cos(centerLat * Math.PI / 180));
  try {
    const snapQuery = `[out:json][timeout:10];node(around:300,${fallbackLat},${fallbackLng});out body 1;`;
    const data = await queryOverpass(snapQuery);
    const nodes = data.elements.filter(e => e.type === 'node');
    if (nodes.length > 0) {
      return { lat: nodes[0].lat, lng: nodes[0].lon };
    }
  } catch {/* abandon */}

  return null;
}

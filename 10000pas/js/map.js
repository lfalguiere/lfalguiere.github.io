let leafletMap = null;
let playerMarker = null;
let zoneCircle = null;
let zoneMask = null;
let previewCircle = null;
let trailPolyline = null;
let animFrame = null;
let resultMap = null;

// Rayon (généreux mais borné) de l'anneau extérieur du masque, relatif au
// cercle affiché — PAS le globe entier : à très fort zoom (cercle final
// ~20 m), un anneau couvrant tout le globe produit des coordonnées écran
// énormes qui cassent le rendu SVG (écran noir). Une marge large mais finie
// couvre largement tout zoom/pan raisonnable sans ce risque.
function maskOuterRadius(radiusM) {
  return Math.max(radiusM * 200, 5000);
}

// Génère les points d'un cercle géographique (approximation sphérique),
// utilisés comme anneau intérieur (trou) du polygone-masque.
function circleRingPoints(lat, lng, radiusM, numPoints = 72) {
  const R = 6371000;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lng * Math.PI / 180;
  const δ = radiusM / R;
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const θ = (i / numPoints) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    points.push([φ2 * 180 / Math.PI, ((λ2 * 180 / Math.PI) + 540) % 360 - 180]);
  }
  return points;
}

export function initMap(containerId) {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    playerMarker = null;
    zoneCircle = null;
    zoneMask = null;
    previewCircle = null;
    trailPolyline = null;
  }
  if (resultMap) {
    resultMap.remove();
    resultMap = null;
  }

  leafletMap = L.map(containerId, {
    zoomControl: false,
    attributionControl: true,
    zoomSnap: 0,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(leafletMap);

  L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);
}

export function invalidateMapSize() {
  if (leafletMap) leafletMap.invalidateSize();
}

export function updatePlayerPosition(lat, lng) {
  if (!leafletMap) return;
  if (!playerMarker) {
    playerMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#ffffff',
      weight: 2,
      fillColor: '#2196F3',
      fillOpacity: 1,
      pane: 'markerPane',
    }).addTo(leafletMap);
  } else {
    playerMarker.setLatLng([lat, lng]);
  }
}

function updateMaskRing(lat, lng, radiusM) {
  if (zoneMask) {
    zoneMask.setLatLngs([
      circleRingPoints(lat, lng, maskOuterRadius(radiusM), 32),
      circleRingPoints(lat, lng, radiusM),
    ]);
  }
}

export function updateZoneCircle(lat, lng, radiusM, animate = true) {
  if (!leafletMap) return;

  if (!zoneCircle) {
    zoneCircle = L.circle([lat, lng], {
      radius: radiusM,
      color: '#ef5350',
      weight: 2,
      fillOpacity: 0,
      interactive: false,
    }).addTo(leafletMap);
    zoneMask = L.polygon([circleRingPoints(lat, lng, maskOuterRadius(radiusM), 32), circleRingPoints(lat, lng, radiusM)], {
      stroke: false,
      fillColor: '#ef5350',
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(leafletMap);
    return;
  }

  if (!animate) {
    zoneCircle.setLatLng([lat, lng]);
    zoneCircle.setRadius(radiusM);
    updateMaskRing(lat, lng, radiusM);
    return;
  }

  // Animation douce du rétrécissement
  if (animFrame) cancelAnimationFrame(animFrame);
  const startLat = zoneCircle.getLatLng().lat;
  const startLng = zoneCircle.getLatLng().lng;
  const startR = zoneCircle.getRadius();
  const duration = 2500;
  const startTime = performance.now();

  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const curLat = startLat + (lat - startLat) * ease;
    const curLng = startLng + (lng - startLng) * ease;
    const curR = startR + (radiusM - startR) * ease;
    zoneCircle.setLatLng([curLat, curLng]);
    zoneCircle.setRadius(curR);
    updateMaskRing(curLat, curLng, curR);
    if (t < 1) {
      animFrame = requestAnimationFrame(step);
    }
  }
  animFrame = requestAnimationFrame(step);
}

export function updatePreviewCircle(lat, lng, radiusM) {
  if (!leafletMap) return;
  if (!previewCircle) {
    previewCircle = L.circle([lat, lng], {
      radius: radiusM,
      color: '#2196F3',
      weight: 2,
      dashArray: '6, 6',
      fillOpacity: 0,
      interactive: false,
    }).addTo(leafletMap);
    return;
  }
  previewCircle.setLatLng([lat, lng]);
  previewCircle.setRadius(radiusM);
}

export function hidePreviewCircle() {
  if (previewCircle && leafletMap) {
    leafletMap.removeLayer(previewCircle);
  }
  previewCircle = null;
}

const ZONE_VIEW_PADDING_FACTOR = 2.3; // marge homogène pour fitMapToZone ET zoomToZone

export function fitMapToZone(lat, lng, radiusM) {
  if (!leafletMap) return;
  leafletMap.fitBounds(
    L.latLng(lat, lng).toBounds(radiusM * ZONE_VIEW_PADDING_FACTOR),
    { animate: false }
  );
}

// Appelé après chaque rétrécissement — zoom animé avec un léger délai
// pour ne pas interférer visuellement avec l'animation du cercle.
export function zoomToZone(lat, lng, radiusM) {
  if (!leafletMap) return;
  setTimeout(() => {
    leafletMap.flyToBounds(
      L.latLng(lat, lng).toBounds(radiusM * ZONE_VIEW_PADDING_FACTOR),
      { duration: 1.2, easeLinearity: 0.25 }
    );
  }, 600);
}

// Met à jour le tracé du parcours sur la carte de jeu.
export function updateTrail(positions) {
  if (!leafletMap || positions.length < 2) return;
  const latlngs = positions.map(p => [p.lat, p.lng]);
  if (!trailPolyline) {
    trailPolyline = L.polyline(latlngs, {
      color: '#2196F3',
      weight: 3,
      opacity: 0.7,
      lineJoin: 'round',
      interactive: false,
    }).addTo(leafletMap);
  } else {
    trailPolyline.setLatLngs(latlngs);
  }
}

// Affiche une carte récapitulative sur l'écran résultat avec le tracé du parcours
// et le dernier cercle de la zone (celui qui a déterminé la victoire/défaite).
export function renderResultMap(containerId, positions, circleCenter, circleRadius) {
  if (resultMap) {
    resultMap.remove();
    resultMap = null;
  }
  if (!positions || positions.length < 1) return;

  resultMap = L.map(containerId, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
    zoomSnap: 0,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(resultMap);

  // Dernier cercle de la zone (celui qui a déterminé la fin de partie).
  // Remplissage simple à l'intérieur (pas le masque monde-entier-avec-trou
  // utilisé sur la carte de jeu) : ce widget statique peut cadrer sur un
  // cercle très petit (rayon final ~20 m) donc un zoom très profond, où le
  // polygone couvrant tout le globe produirait des coordonnées écran
  // gigantesques et casserait le rendu (écran noir).
  L.circle([circleCenter.lat, circleCenter.lng], {
    radius: circleRadius,
    color: '#ef5350',
    weight: 1.5,
    fillColor: '#ef5350',
    fillOpacity: 0.12,
    interactive: false,
  }).addTo(resultMap);

  // Tracé du parcours (si au moins 2 points — sinon juste un marqueur unique,
  // ex. partie très courte où le joueur n'a pas encore assez bougé)
  const start = positions[0];
  const end = positions[positions.length - 1];
  let trailBounds;
  if (positions.length >= 2) {
    const latlngs = positions.map(p => [p.lat, p.lng]);
    const trail = L.polyline(latlngs, {
      color: '#2196F3',
      weight: 3,
      opacity: 0.85,
      lineJoin: 'round',
    }).addTo(resultMap);
    trailBounds = trail.getBounds();

    L.circleMarker([start.lat, start.lng], {
      radius: 6, color: '#fff', weight: 2, fillColor: '#4caf50', fillOpacity: 1,
    }).addTo(resultMap);
    L.circleMarker([end.lat, end.lng], {
      radius: 6, color: '#fff', weight: 2, fillColor: '#ef5350', fillOpacity: 1,
    }).addTo(resultMap);
  } else {
    L.circleMarker([start.lat, start.lng], {
      radius: 6, color: '#fff', weight: 2, fillColor: '#4caf50', fillOpacity: 1,
    }).addTo(resultMap);
    trailBounds = L.latLngBounds([[start.lat, start.lng]]);
  }

  // Zoom pour montrer à la fois tout le parcours ET le dernier cercle
  // (le cercle final est souvent bien plus petit que le trajet parcouru).
  const bounds = trailBounds.extend(
    L.latLng(circleCenter.lat, circleCenter.lng).toBounds(circleRadius * 2.2)
  );
  resultMap.fitBounds(bounds, { animate: false, padding: [16, 16] });
}

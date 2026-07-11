let leafletMap = null;
let playerMarker = null;
let zoneCircle = null;
let zoneMask = null;
let trailPolyline = null;
let animFrame = null;
let resultMap = null;

// Rectangle couvrant tout le globe, utilisé comme anneau extérieur du masque.
const WORLD_RING = [[-85, -180], [-85, 180], [85, 180], [85, -180]];

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
    trailPolyline = null;
  }
  if (resultMap) {
    resultMap.remove();
    resultMap = null;
  }

  leafletMap = L.map(containerId, {
    zoomControl: false,
    attributionControl: true,
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
  leafletMap.panTo([lat, lng], { animate: true, duration: 0.8 });
}

function updateMaskRing(lat, lng, radiusM) {
  if (zoneMask) {
    zoneMask.setLatLngs([WORLD_RING, circleRingPoints(lat, lng, radiusM)]);
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
    zoneMask = L.polygon([WORLD_RING, circleRingPoints(lat, lng, radiusM)], {
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

export function fitMapToZone(lat, lng, radiusM) {
  if (!leafletMap) return;
  leafletMap.fitBounds(
    L.latLng(lat, lng).toBounds(radiusM * 2.2),
    { animate: false }
  );
}

// Appelé après chaque rétrécissement — zoom animé avec un léger délai
// pour ne pas interférer visuellement avec l'animation du cercle.
export function zoomToZone(lat, lng, radiusM) {
  if (!leafletMap) return;
  setTimeout(() => {
    leafletMap.flyToBounds(
      L.latLng(lat, lng).toBounds(radiusM * 2.4),
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
// et le cercle de départ.
export function renderResultMap(containerId, positions, initialCenter, initialRadius) {
  if (resultMap) {
    resultMap.remove();
    resultMap = null;
  }
  if (!positions || positions.length < 2) return;

  resultMap = L.map(containerId, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(resultMap);

  // Cercle de départ (limite initiale de la zone)
  L.circle([initialCenter.lat, initialCenter.lng], {
    radius: initialRadius,
    color: '#ef5350',
    weight: 1.5,
    fillOpacity: 0,
    interactive: false,
  }).addTo(resultMap);
  L.polygon([WORLD_RING, circleRingPoints(initialCenter.lat, initialCenter.lng, initialRadius)], {
    stroke: false,
    fillColor: '#ef5350',
    fillOpacity: 0.18,
    interactive: false,
  }).addTo(resultMap);

  // Tracé du parcours
  const latlngs = positions.map(p => [p.lat, p.lng]);
  L.polyline(latlngs, {
    color: '#2196F3',
    weight: 3,
    opacity: 0.85,
    lineJoin: 'round',
  }).addTo(resultMap);

  // Marqueur de départ (vert) et d'arrivée (rouge)
  const start = positions[0];
  const end = positions[positions.length - 1];
  L.circleMarker([start.lat, start.lng], {
    radius: 6, color: '#fff', weight: 2, fillColor: '#4caf50', fillOpacity: 1,
  }).addTo(resultMap);
  L.circleMarker([end.lat, end.lng], {
    radius: 6, color: '#fff', weight: 2, fillColor: '#ef5350', fillOpacity: 1,
  }).addTo(resultMap);

  // Zoom pour montrer tout le parcours
  resultMap.fitBounds(
    L.latLng(initialCenter.lat, initialCenter.lng).toBounds(initialRadius * 2.2),
    { animate: false, padding: [16, 16] }
  );
}

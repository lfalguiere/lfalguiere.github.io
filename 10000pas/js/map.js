let leafletMap = null;
let playerMarker = null;
let zoneCircle = null;
let trailPolyline = null;
let animFrame = null;
let resultMap = null;

export function initMap(containerId) {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    playerMarker = null;
    zoneCircle = null;
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

export function updateZoneCircle(lat, lng, radiusM, animate = true) {
  if (!leafletMap) return;

  if (!zoneCircle) {
    zoneCircle = L.circle([lat, lng], {
      radius: radiusM,
      color: '#ef5350',
      weight: 2,
      fillColor: '#ef5350',
      fillOpacity: 0.07,
      interactive: false,
    }).addTo(leafletMap);
    return;
  }

  if (!animate) {
    zoneCircle.setLatLng([lat, lng]);
    zoneCircle.setRadius(radiusM);
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
    zoneCircle.setLatLng([
      startLat + (lat - startLat) * ease,
      startLng + (lng - startLng) * ease,
    ]);
    zoneCircle.setRadius(startR + (radiusM - startR) * ease);
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
    fillColor: '#ef5350',
    fillOpacity: 0.05,
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

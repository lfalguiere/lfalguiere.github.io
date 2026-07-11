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

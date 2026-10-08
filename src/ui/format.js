export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatDelay(seconds) {
  const sign = seconds > 0 ? "+" : seconds < 0 ? "−" : "";
  return `${sign}${Math.abs(seconds).toFixed(1)}s`;
}

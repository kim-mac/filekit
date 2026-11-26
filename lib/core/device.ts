export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(agent) ||
    (agent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

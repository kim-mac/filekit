const mib = 2 ** 20;

// One live stage per selection. Keep space for an export copy, codec
// allocations, and the bounded preview in addition to these bytes.
export function upscaleCacheBudget(mobile: boolean, deviceMemory?: number) {
  if (deviceMemory !== undefined && deviceMemory <= 2) return 16 * mib;
  if (mobile || (deviceMemory !== undefined && deviceMemory <= 4)) return 32 * mib;
  return 96 * mib;
}

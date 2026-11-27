export const memoryRecovery = 'This device ran out of memory. Close other tabs, then retry with a smaller image or use a desktop.';
export const workerRecovery = 'Image processing stopped. Close other tabs and try again, or use a smaller image.';

export function isMemoryError(error: unknown): boolean {
  let cause = error;
  const seen = new Set<unknown>();
  while (cause instanceof Error && !seen.has(cause)) {
    if (/out of memory|\boom\b|memory access out of bounds|allocation failed|could not allocate|array buffer allocation|invalid typed array length/i.test(cause.message)) return true;
    seen.add(cause);
    cause = cause.cause;
  }
  return false;
}

export function processingMessage(error: unknown, fallback = 'Image processing failed. Try again.') {
  if (isMemoryError(error)) return memoryRecovery;
  return error instanceof Error ? error.message : fallback;
}

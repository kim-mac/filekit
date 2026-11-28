export function assetResponse(
  manifestUrl: string, signal?: AbortSignal | null, expected?: { root: string; bytes: number; sha256: string },
  report?: (loaded: number, total: number, id: string, received: number) => void,
): Promise<Response>;

export function verifiedAsset(
  path: string, expected: { bytes: number; sha256: string }, report?: (loaded: number) => void,
): Promise<ArrayBuffer>;

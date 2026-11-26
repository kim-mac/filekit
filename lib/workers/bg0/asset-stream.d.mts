export function assetResponse(
  manifestUrl: string, signal?: AbortSignal | null, expected?: { root: string; bytes: number; sha256: string },
): Promise<Response>;

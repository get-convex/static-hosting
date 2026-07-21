// Windows limits the complete command line to roughly 32 KiB. Keep each JSON
// argument below 20 KiB so the Node executable, Convex flags, and paths still
// have comfortable headroom on every supported platform.
export const MAX_CONVEX_ARGUMENT_BYTES = 20 * 1024;

export function chunkBySerializedArgument<T>(
  items: T[],
  makeArgs: (chunk: T[]) => Record<string, unknown>,
  maxBytes = MAX_CONVEX_ARGUMENT_BYTES,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];

  for (const item of items) {
    const candidate = [...current, item];
    const candidateBytes = Buffer.byteLength(
      JSON.stringify(makeArgs(candidate)),
    );
    if (candidateBytes <= maxBytes) {
      current = candidate;
      continue;
    }

    if (current.length === 0) {
      throw new Error(
        `One upload record needs ${candidateBytes} bytes, which exceeds the safe Convex CLI argument limit of ${maxBytes} bytes. Shorten the asset path.`,
      );
    }

    chunks.push(current);
    current = [item];
    const singleBytes = Buffer.byteLength(JSON.stringify(makeArgs(current)));
    if (singleBytes > maxBytes) {
      throw new Error(
        `One upload record needs ${singleBytes} bytes, which exceeds the safe Convex CLI argument limit of ${maxBytes} bytes. Shorten the asset path.`,
      );
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

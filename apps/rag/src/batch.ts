/**
 * Split a flat array into fixed-size batches, each tagged with its global
 * start index. Used by the ingest pipeline to embed + insert document chunks
 * in bounded groups (a single all-chunks insert can exceed the Neon HTTP
 * request-size limit) while still deriving each row's `chunk_index` as
 * `start + offsetWithinSlice`.
 */
export function batchRows<T>(
  items: readonly T[],
  size: number,
): Array<{ start: number; slice: T[] }> {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("batch size must be a positive integer");
  }
  const batches: Array<{ start: number; slice: T[] }> = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push({ start: i, slice: items.slice(i, i + size) });
  }
  return batches;
}

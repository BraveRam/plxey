export interface ChunkOptions {
  size: number;
  overlap: number;
}

const SEPARATORS = ["\n\n", "\n", ".", "?", "!", ",", " ", ""];

export function splitText(text: string, opts: Partial<ChunkOptions> = {}): string[] {
  text = text.replace(/\0/g, "");
  const size = opts.size ?? 500;
  const overlap = opts.overlap ?? 50;

  function split(text: string, depth: number): string[] {
    if (!text || text.length <= size || depth >= SEPARATORS.length) {
      return text ? [text] : [];
    }

    const sep = SEPARATORS[depth]!;

    if (sep === "") {
      const chars = [...text];
      const result: string[] = [];
      for (let i = 0; i < chars.length; i += size) {
        result.push(chars.slice(i, i + size).join(""));
      }
      return result;
    }

    const parts = text.split(sep).filter(Boolean);
    if (parts.length <= 1) {
      return split(text, depth + 1);
    }

    const chunks: string[] = [];
    let current = "";
    for (const part of parts) {
      const candidate = current ? `${current}${sep}${part}` : part;
      if (candidate.length > size && current) {
        chunks.push(current);
        current = part;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);

    return chunks.flatMap((c) => (c.length > size ? split(c, depth + 1) : [c]));
  }

  const raw = split(text.trim(), 0);
  if (raw.length <= 1) return raw;

  const result: string[] = [raw[0]!];
  for (let i = 1; i < raw.length; i++) {
    const prev = result[result.length - 1]!;
    const tail = overlap > 0 ? prev.slice(-overlap) : "";
    result.push(tail + raw[i]!);
  }

  return result;
}

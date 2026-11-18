// What did the human change before sending? Sentence-level diff, enough to learn "they always cut this phrase".

export type EditDiff = { removed: string[]; added: string[]; origWords: number; finalWords: number };

const words = (s: string) => (s.match(/\S+/g) ?? []).length;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s$%]/g, "").trim();

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// null when nothing meaningful changed
export function diffEdit(original: string, final: string): EditDiff | null {
  if (norm(original) === norm(final)) return null;
  const a = splitSentences(original), b = splitSentences(final);
  const inB = new Set(b.map(norm)), inA = new Set(a.map(norm));
  return {
    removed: a.filter((s) => !inB.has(norm(s))),
    added: b.filter((s) => !inA.has(norm(s))),
    origWords: words(original),
    finalWords: words(final),
  };
}

// 3 to 5 word phrases from a sentence, lowercased, for "this phrase keeps getting deleted" counting.
export function phrases(sentence: string, minN = 3, maxN = 5): string[] {
  const w = norm(sentence).split(" ").filter(Boolean);
  const out: string[] = [];
  for (let n = minN; n <= maxN; n++) for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}

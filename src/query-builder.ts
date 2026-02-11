/**
 * English stop words to exclude from dynamic FTS5 queries.
 * Kept minimal — only words that add noise without signaling relevance.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "must", "it", "its", "this", "that", "these", "those", "i", "you",
  "he", "she", "we", "they", "me", "him", "her", "us", "them", "my",
  "your", "his", "our", "their", "what", "which", "who", "whom",
  "not", "no", "nor", "if", "then", "else", "when", "where", "how",
  "all", "each", "every", "both", "few", "more", "most", "other",
  "some", "such", "only", "own", "same", "so", "than", "too", "very",
  "just", "about", "above", "after", "before", "between", "into",
  "through", "during", "out", "up", "down", "over", "under", "also",
]);

const MIN_TERM_LENGTH = 3;
const MAX_TERMS = 40;

/**
 * Build an FTS5 OR query from free-text input.
 *
 * Extracts significant terms by:
 * 1. Lowercasing and splitting on non-alphanumeric boundaries
 * 2. Removing stop words and very short tokens
 * 3. Deduplicating
 * 4. Joining with OR (FTS5 defaults to AND for space-separated terms)
 *
 * Returns empty string if no significant terms remain.
 */
export function buildDynamicQuery(texts: readonly string[]): string {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const text of texts) {
    const words = text.toLowerCase().split(/[^a-z0-9]+/);
    for (const word of words) {
      if (
        word.length >= MIN_TERM_LENGTH &&
        !STOP_WORDS.has(word) &&
        !seen.has(word)
      ) {
        seen.add(word);
        terms.push(word);
      }
    }
  }

  return terms.slice(0, MAX_TERMS).join(" OR ");
}

/**
 * Smart matcher for categories and athletes in RingFlow.
 * Handles queries like "u14_30-35kg", "u14", "30", "14", "boys", "30-35", "john", etc.
 */
export function matchesCategorySearch(
  category:
    | {
        name?: string | null;
        age_bracket?: string | null;
        weight_class?: string | null;
        sex?: string | null;
        belt?: string | null;
      }
    | string
    | null
    | undefined,
  rawQuery: string
): boolean {
  if (!rawQuery || !rawQuery.trim()) return false;
  if (!category) return false;

  const q = rawQuery.trim().toLowerCase();
  const cleanQ = q.replace(/[^a-z0-9]/g, "");

  const fullText =
    typeof category === "string"
      ? category.toLowerCase()
      : [
          category.name || "",
          category.age_bracket || "",
          category.weight_class || "",
          category.sex || "",
          category.belt || "",
        ]
          .join(" ")
          .toLowerCase();

  const cleanFullText = fullText.replace(/[^a-z0-9]/g, "");

  // 1. Special case for male/female to prevent substring collision
  if (q === "male") {
    return /\bmale\b/i.test(fullText);
  }

  // 1. Direct contains in full text
  if (fullText.includes(q)) return true;

  // 2. Normalized comparison (ignores spaces, underscores, dashes, symbols)
  if (cleanQ.length >= 2 && cleanFullText.includes(cleanQ)) return true;

  // 3. Multi-word/token match: all separated terms in user query must appear
  const tokens = q.split(/[\s_\/,\-]+/).filter((t) => t.length > 0);
  if (tokens.length > 0) {
    const allTokensMatch = tokens.every((tok) => {
      const cleanTok = tok.replace(/[^a-z0-9]/g, "");
      return (
        fullText.includes(tok) ||
        (cleanTok.length > 0 && cleanFullText.includes(cleanTok))
      );
    });
    if (allTokensMatch) return true;
  }

  // 4. Number & sub-token matches: e.g. user typed "30" or "14" or "u14"
  const subTokens = q.match(/([0-9]+|[a-z]+)/gi) || [];
  if (subTokens.length > 0) {
    const significant = subTokens.filter((t) => /^[0-9]+$/.test(t) || t.length >= 2);
    if (significant.length > 0) {
      const allSignificantMatch = significant.every((t) => {
        const lower = t.toLowerCase();
        return cleanFullText.includes(lower);
      });
      if (allSignificantMatch) return true;
    }
  }

  return false;
}

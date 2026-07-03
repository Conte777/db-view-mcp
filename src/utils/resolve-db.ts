// Models often pass an inexact database id ("api" for "api_go", "API-GO"…).
// Resolve leniently instead of hard-failing: exact -> case-insensitive ->
// normalized (dashes/underscores stripped) -> unique abbreviation/superset match.
// Both fuzzy directions — input contains an id ("analytics_db" -> "analytics") and id
// contains input ("api" -> "api_go") — only match at token boundaries and require the
// matched id to be >= 3 chars, so a short input like "ch"/"pg" can't silently resolve to
// an unrelated longer id that merely contains it as a substring ("search", "gpg", …).
export class DbResolutionError extends Error {
  constructor(
    message: string,
    readonly code: "DB_NOT_FOUND" | "DB_AMBIGUOUS",
  ) {
    super(message);
    this.name = "DbResolutionError";
  }
}

function isTokenAlignedSubstring(tokens: string[], target: string): boolean {
  for (let start = 0; start < tokens.length; start++) {
    let acc = "";
    for (let end = start; end < tokens.length; end++) {
      acc += tokens[end];
      if (acc === target) return true;
      if (acc.length > target.length) break;
    }
  }
  return false;
}

export function resolveDbId(dbIds: string[], input: string): string {
  if (dbIds.includes(input)) return input;

  const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .split(/[-_\s]+/)
      .filter(Boolean);
  const lower = input.toLowerCase();
  const nInput = norm(input);
  const inputTokens = tokenize(input);

  for (const match of [
    dbIds.filter((id) => id.toLowerCase() === lower),
    dbIds.filter((id) => norm(id) === nInput),
    nInput.length >= 3
      ? dbIds.filter((id) => {
          if (norm(id).length < 3) return false;
          // id contains input (abbreviation) OR input contains id (superset) — both only at
          // token boundaries, never an arbitrary mid-token substring.
          return isTokenAlignedSubstring(tokenize(id), nInput) || isTokenAlignedSubstring(inputTokens, norm(id));
        })
      : [],
  ]) {
    if (match.length === 1) return match[0];
    if (match.length > 1) {
      throw new DbResolutionError(
        `Ambiguous database "${input}": matches ${match.join(", ")}. Valid IDs: ${dbIds.join(", ")}`,
        "DB_AMBIGUOUS",
      );
    }
  }

  throw new DbResolutionError(`Unknown database: "${input}". Valid IDs: ${dbIds.join(", ")}`, "DB_NOT_FOUND");
}

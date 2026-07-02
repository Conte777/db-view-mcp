// Models often pass an inexact database id ("api" for "api_go", "API-GO"…).
// Resolve leniently instead of hard-failing: exact -> case-insensitive ->
// normalized (dashes/underscores stripped) -> unique substring match.
export function resolveDbId(dbIds: string[], input: string): string {
  if (dbIds.includes(input)) return input;

  const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
  const lower = input.toLowerCase();
  const nInput = norm(input);

  for (const match of [
    dbIds.filter((id) => id.toLowerCase() === lower),
    dbIds.filter((id) => norm(id) === nInput),
    nInput ? dbIds.filter((id) => norm(id).includes(nInput) || nInput.includes(norm(id))) : [],
  ]) {
    if (match.length === 1) return match[0];
    if (match.length > 1) {
      throw new Error(`Ambiguous database "${input}": matches ${match.join(", ")}. Valid IDs: ${dbIds.join(", ")}`);
    }
  }

  throw new Error(`Unknown database: "${input}". Valid IDs: ${dbIds.join(", ")}`);
}

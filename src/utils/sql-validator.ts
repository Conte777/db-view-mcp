const WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "GRANT",
  "REVOKE",
  "REPLACE",
  "MERGE",
  "COPY",
  "CALL",
];

const WRITE_PATTERN = new RegExp(`\\b(${WRITE_KEYWORDS.join("|")})\\b`, "i");

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

function stripStringLiterals(sql: string): string {
  // Replace single-quoted strings (handling escaped quotes)
  let result = sql.replace(/'(?:[^'\\]|\\.)*'/g, "__STR__");
  // Replace double-quoted identifiers
  result = result.replace(/"(?:[^"\\]|\\.)*"/g, "__ID__");
  // Replace dollar-quoted strings (PostgreSQL): $$...$$, $tag$...$tag$
  result = result.replace(/\$([^$]*)\$[\s\S]*?\$\1\$/g, "__STR__");
  return result;
}

function stripComments(sql: string): string {
  // Remove block comments
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove line comments
  result = result.replace(/--[^\n]*/g, " ");
  return result;
}

function normalizeWhitespace(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export function validateReadonlySql(sql: string): ValidationResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valid: false, error: "Empty SQL statement" };
  }

  // Normalize: strip strings first, then comments, then whitespace
  const noStrings = stripStringLiterals(trimmed);
  const noComments = stripComments(noStrings);
  const normalized = normalizeWhitespace(noComments);

  // Check for multiple statements (after removing string literals)
  if (normalized.includes(";")) {
    const afterSemicolon = normalized.split(";").slice(1).join(";").trim();
    if (afterSemicolon.length > 0) {
      return {
        valid: false,
        error: "Multiple statements are not allowed in read-only mode",
      };
    }
  }

  // Check for write keywords anywhere in normalized SQL
  const match = normalized.match(WRITE_PATTERN);
  if (match) {
    return {
      valid: false,
      error: `Statement '${match[1].toUpperCase()}' is not allowed in read-only mode`,
    };
  }

  return { valid: true };
}

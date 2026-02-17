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
];

const WRITE_PATTERN = new RegExp(
  `^\\s*(${WRITE_KEYWORDS.join("|")})\\b`,
  "i"
);

const MULTI_STATEMENT_PATTERN = /;\s*\S/;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateReadonlySql(sql: string): ValidationResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valid: false, error: "Empty SQL statement" };
  }

  if (MULTI_STATEMENT_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: "Multiple statements are not allowed in read-only mode",
    };
  }

  if (WRITE_PATTERN.test(trimmed)) {
    const match = trimmed.match(/^\s*(\w+)/);
    return {
      valid: false,
      error: `Statement '${match?.[1]?.toUpperCase()}' is not allowed in read-only mode`,
    };
  }

  return { valid: true };
}

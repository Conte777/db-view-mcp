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

// Functions that pass the WRITE_KEYWORDS check but still let a read-only session escape the
// sandbox: PostgreSQL admin/superuser actions, filesystem/network access, cross-server links,
// DoS via pg_sleep, or ClickHouse table functions that reach outside the database. The validator
// doesn't know the dialect, so one combined list is used; the false-positive risk is a table or
// column literally named e.g. "url" invoked as a function call, which is acceptable.
const DENIED_FUNCTIONS = [
  // PostgreSQL
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_reload_conf",
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_ls_logdir",
  "pg_ls_waldir",
  "pg_ls_tmpdir",
  "pg_ls_archive_statusdir",
  "pg_stat_file",
  "pg_file_write",
  "pg_file_rename",
  "pg_file_unlink",
  "lo_import",
  "lo_export",
  "dblink",
  "dblink_exec",
  "dblink_connect",
  "dblink_connect_u",
  "dblink_send_query",
  "dblink_open",
  "dblink_fetch",
  "dblink_close",
  "pg_sleep",
  "pg_logical_emit_message",
  "pg_create_restore_point",
  "pg_switch_wal",
  "pg_promote",
  "set_config",
  // ClickHouse table functions
  "url",
  "file",
  "s3",
  "remote",
  "remoteSecure",
  "mysql",
  "postgresql",
  "jdbc",
  "odbc",
  "hdfs",
  "azureBlobStorage",
  "executable",
];

// Function CALLS only (name directly followed by "("), so column/table names like
// "file_uploads" or "my_url" are left alone. Matched case-insensitively.
const DENY_PATTERN = new RegExp(`\\b(${DENIED_FUNCTIONS.join("|")})\\s*\\(`, "i");

export interface ValidationResult {
  valid: boolean;
  error?: string;
  /**
   * Present when valid is true: the original SQL with comments and trailing semicolons removed.
   * String literals and quoted identifiers are left byte-for-byte intact — this is NOT the
   * __STR__ placeholder / unquoted-identifier text used internally for keyword matching, which
   * must never reach the database.
   */
  normalizedSql?: string;
}

export type SqlDialect = "postgresql" | "clickhouse";

function stripStringLiterals(sql: string): string {
  // Replace single-quoted strings (handling escaped quotes) — these are inert data.
  let result = sql.replace(/'(?:[^'\\]|\\.)*'/g, "__STR__");
  // Unwrap double-quoted identifiers to their inner text instead of blanking them: in
  // PostgreSQL/ClickHouse `"pg_terminate_backend"(1)` invokes the very same function as the
  // unquoted form, so a quoted name must still be seen by WRITE_PATTERN/DENY_PATTERN. Keeping
  // the content (checked as if unquoted) fails safe — the worst case is rejecting a read query
  // whose column/identifier happens to equal a write keyword or denied function name.
  result = result.replace(/"((?:[^"\\]|\\.)*)"/g, "$1");
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

/**
 * Comment stripping for SQL that will actually be sent to the database. Unlike
 * stripComments+stripStringLiterals (placeholder-based, only safe for keyword matching), this
 * tracks quote state in a single pass so string/identifier/dollar-quoted content is copied
 * verbatim — "--" or "/*" inside a literal is never mistaken for a comment.
 */
function stripCommentsPreserveStrings(sql: string): string {
  let result = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const c2 = i + 1 < n ? sql[i + 1] : "";

    if (c === "'" || c === '"') {
      const quote = c;
      result += c;
      i++;
      while (i < n) {
        if (sql[i] === "\\" && i + 1 < n) {
          result += sql[i] + sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          result += sql[i];
          i++;
          break;
        }
        result += sql[i];
        i++;
      }
      continue;
    }

    if (c === "$") {
      // Dollar-quoted string ($$...$$ or $tag$...$tag$): [^$]* naturally stops at the next "$".
      const opener = /^\$[^$]*\$/.exec(sql.slice(i));
      if (opener) {
        const delimiter = opener[0];
        const closeIdx = sql.indexOf(delimiter, i + delimiter.length);
        if (closeIdx !== -1) {
          result += sql.slice(i, closeIdx + delimiter.length);
          i = closeIdx + delimiter.length;
          continue;
        }
      }
      result += c;
      i++;
      continue;
    }

    if (c === "-" && c2 === "-") {
      let j = i;
      while (j < n && sql[j] !== "\n") j++;
      result += " ";
      i = j;
      continue;
    }

    if (c === "/" && c2 === "*") {
      const end = sql.indexOf("*/", i + 2);
      result += " ";
      i = end === -1 ? n : end + 2;
      continue;
    }

    result += c;
    i++;
  }

  return result;
}

function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/;+\s*$/, "").trim();
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

  // Check for dangerous function calls (admin/filesystem/network escapes) anywhere in normalized SQL
  const denyMatch = normalized.match(DENY_PATTERN);
  if (denyMatch) {
    return {
      valid: false,
      error: `Function '${denyMatch[1]}' is not allowed in read-only mode`,
    };
  }

  const normalizedSql = stripTrailingSemicolons(stripCommentsPreserveStrings(trimmed));

  return { valid: true, normalizedSql };
}

/**
 * Wraps a read-only query in a row-limited subselect. Also strips comments and trailing
 * semicolons (string-literal-aware, same as validateReadonlySql's normalizedSql) as a safety
 * net for callers still passing raw/un-normalized SQL — without this, something like
 * "SELECT 1; -- c" would comment out the wrapper's closing paren. The stripping is idempotent,
 * so passing an already-normalizedSql value is safe and a no-op.
 */
export function wrapReadonlyQuery(sql: string, limit: number, dialect: SqlDialect): string {
  const inner = stripTrailingSemicolons(stripCommentsPreserveStrings(sql.trim()));
  switch (dialect) {
    case "postgresql":
    case "clickhouse":
      return `SELECT * FROM (${inner}) AS _q LIMIT ${limit}`;
  }
}

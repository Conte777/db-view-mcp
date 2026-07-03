import { DbResolutionError } from "./resolve-db.js";

const MAX_CELL_CHARS = 10_000;
const MAX_PAYLOAD_CHARS = 1_000_000;
const BINARY_PREVIEW_BYTES = 16;

export interface SuccessResponse {
  success: true;
  rows?: Record<string, unknown>[];
  rowsTable?: string;
  count?: number;
  database?: string;
  data?: unknown;
  truncated?: boolean;
  returnedRows?: number;
  truncatedAt?: number;
}

// Opt-in pipe-table rendering for row payloads, set once at server startup from config.
let rowFormat: "json" | "table" = "json";

export function setRowFormat(format: "json" | "table"): void {
  rowFormat = format;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
}

export function formatSuccess(data: Omit<SuccessResponse, "success">) {
  // Rows can carry attacker-influenced cells (e.g. a write with RETURNING binary/text), so apply
  // the same per-cell and total-payload caps the read path uses. `data`/other fields are left as-is.
  const payload: SuccessResponse = data.rows
    ? { success: true, ...data, rows: data.rows.map(sanitizeRow) }
    : { success: true, ...data };
  return {
    content: [
      {
        type: "text" as const,
        text: serializeWithinCap(payload),
      },
    ],
  };
}

export function formatError(error: string, code?: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: false, error, code }),
      },
    ],
    isError: true as const,
  };
}

// Surfaces a caught error to the client, carrying DbResolutionError's DB_NOT_FOUND/DB_AMBIGUOUS
// code through to the response so clients can distinguish it from a generic failure.
export function formatCaughtError(err: unknown) {
  if (err instanceof DbResolutionError) {
    return formatError(err.message, err.code);
  }
  return formatError(String(err));
}

function sanitizeCell(value: unknown): unknown {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const hexPreview = Buffer.from(value).subarray(0, BINARY_PREVIEW_BYTES).toString("hex");
    return `<binary ${value.length} bytes: ${hexPreview}...>`;
  }
  if (typeof value === "string" && value.length > MAX_CELL_CHARS) {
    return `${value.slice(0, MAX_CELL_CHARS)}... [truncated, ${value.length} chars total]`;
  }
  return value;
}

function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    sanitized[key] = sanitizeCell(value);
  }
  return sanitized;
}

// Escapes chars that would break the one-cell-per-pipe/one-row-per-line invariant. Order matters:
// backslash must go first so it doesn't double-escape the backslashes introduced by later steps.
function escapeCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

// Renders a single cell value per the table convention, ahead of escaping. Runs after sanitizeCell,
// so Buffers/oversized strings already arrive as plain placeholder strings.
function cellRawText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") {
    if (value === "") return "";
    if (value === "NULL") return '"NULL"';
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  // JSON mode coerces NaN/Infinity to null via JSON.stringify; mirror that so toggling
  // rowFormat never changes what a cell means.
  if (typeof value === "number" && !Number.isFinite(value)) return "NULL";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

function renderCell(value: unknown): string {
  const escaped = escapeCell(cellRawText(value));
  // Quotes are escaped only in genuine string cells, so a string that happens to look like
  // the quoted-NULL marker or a serialized object stays distinguishable from the real thing.
  // Runs after escapeCell: the backslashes it introduces must not be doubled by it.
  if (typeof value === "string" && value !== "" && value !== "NULL") {
    return escaped.replace(/"/g, '\\"');
  }
  return escaped;
}

// Header = union of row keys in first-appearance order (rows from a single query are normally
// uniform; the union is just a safety net for heterogeneous shapes).
function buildTable(rows: Record<string, unknown>[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const lines = [columns.map(escapeCell).join("|")];
  for (const row of rows) {
    lines.push(columns.map((col) => renderCell(row[col])).join("|"));
  }
  return lines.join("\n");
}

// Builds the final payload for a given row slice: table mode swaps `rows` for a rendered
// `rowsTable` string (skipped for an empty slice, where there's nothing to tabulate).
function buildPayload(
  payload: SuccessResponse,
  rows: Record<string, unknown>[],
  extra?: Partial<SuccessResponse>,
): SuccessResponse {
  if (rowFormat === "table" && rows.length > 0) {
    const { rows: _omit, ...rest } = payload;
    return { ...rest, rowsTable: buildTable(rows), ...extra };
  }
  return { ...payload, rows, ...extra };
}

// Serializes the response, and if it blows the payload cap and carries rows, halves the row count
// until it fits (rows are typically similar in size, so this converges in a handful of iterations)
// while flagging the truncation. Callers pass rows already sanitized per-cell.
function serializeWithinCap(payload: SuccessResponse): string {
  const rows = payload.rows;
  let text = JSON.stringify(rows ? buildPayload(payload, rows) : payload);
  if (text.length <= MAX_PAYLOAD_CHARS || !rows) return text;
  let n = rows.length;
  while (text.length > MAX_PAYLOAD_CHARS && n > 0) {
    n = Math.floor(n / 2);
    text = JSON.stringify(buildPayload(payload, rows.slice(0, n), { truncated: true, returnedRows: n }));
  }
  return text;
}

export function formatRows(rows: Record<string, unknown>[], database: string) {
  const sanitized = rows.map(sanitizeRow);
  return {
    content: [
      {
        type: "text" as const,
        text: serializeWithinCap({ success: true, rows: sanitized, count: sanitized.length, database }),
      },
    ],
  };
}

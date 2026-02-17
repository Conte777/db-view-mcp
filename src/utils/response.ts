export interface SuccessResponse {
  success: true;
  rows?: Record<string, unknown>[];
  count?: number;
  database?: string;
  data?: unknown;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
}

export function formatSuccess(data: Omit<SuccessResponse, "success">) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: true, ...data }, null, 2),
      },
    ],
  };
}

export function formatError(error: string, code?: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: false, error, code }, null, 2),
      },
    ],
    isError: true as const,
  };
}

export function formatRows(rows: Record<string, unknown>[], database: string) {
  return formatSuccess({ rows, count: rows.length, database });
}

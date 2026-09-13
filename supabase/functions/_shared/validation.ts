export class InputError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "InputError";
    this.status = status;
    this.code = code;
  }
}

export async function readJsonObject(req: Request, maxBytes = 24_000): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new InputError("PAYLOAD_TOO_LARGE", "Request payload is too large.", 413);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new InputError("PAYLOAD_TOO_LARGE", "Request payload is too large.", 413);
  }
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new InputError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InputError("INVALID_PAYLOAD", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function textField(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; required?: boolean } = {},
): string {
  const text = typeof value === "string" ? value.trim() : "";
  const min = options.min ?? 0;
  const max = options.max ?? 500;
  if (options.required && !text) throw new InputError("VALIDATION_ERROR", `${label} is required.`);
  if (text.length < min) throw new InputError("VALIDATION_ERROR", `${label} must be at least ${min} characters.`);
  if (text.length > max) throw new InputError("VALIDATION_ERROR", `${label} must be ${max} characters or fewer.`);
  return text;
}

export function enumField<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const normalized = String(value || "") as T;
  if (!allowed.includes(normalized)) throw new InputError("VALIDATION_ERROR", `${label} is invalid.`);
  return normalized;
}

export function booleanField(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function integerField(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
): number {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new InputError("VALIDATION_ERROR", `${label} must be an integer.`);
  if (options.min != null && number < options.min) throw new InputError("VALIDATION_ERROR", `${label} is below the allowed minimum.`);
  if (options.max != null && number > options.max) throw new InputError("VALIDATION_ERROR", `${label} exceeds the allowed maximum.`);
  return number;
}

export function inputErrorResponse(error: unknown, jsonError: (status: number, code: string, message: string) => Response): Response | null {
  if (!(error instanceof InputError)) return null;
  return jsonError(error.status, error.code, error.message);
}


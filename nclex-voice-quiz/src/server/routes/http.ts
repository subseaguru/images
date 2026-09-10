/**
 * Shared helpers for the API routers: a typed HTTP error and small input validators that turn
 * bad input into a 400 with a clear message and a machine code.
 */
import type { Request } from "express";

export class HttpError extends Error {
  /** The message was written for the learner, so the error handler may forward it at any status. */
  readonly expose = true;

  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "bad_request",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string, code = "bad_request"): HttpError {
  return new HttpError(400, message, code);
}

export function notFound(message: string, code = "not_found"): HttpError {
  return new HttpError(404, message, code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parsed JSON body, or 400 when it is not an object. */
export function bodyObject(req: Request): Record<string, unknown> {
  if (!isRecord(req.body)) throw badRequest("Request body must be a JSON object.", "invalid_body");
  return req.body;
}

export function optionalString(value: unknown, field: string, maxLength = 100_000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`${field} must be a string.`, `invalid_${field}`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw badRequest(`${field} is too long (max ${maxLength} characters).`, `invalid_${field}`);
  return trimmed;
}

export function requiredString(value: unknown, field: string, maxLength?: number): string {
  const result = optionalString(value, field, maxLength);
  if (!result) throw badRequest(`${field} is required.`, `missing_${field}`);
  return result;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${field} must be true or false.`, `invalid_${field}`);
  return value;
}

export function optionalNumber(value: unknown, field: string, min?: number, max?: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw badRequest(`${field} must be a number.`, `invalid_${field}`);
  if (min !== undefined && value < min) throw badRequest(`${field} must be at least ${min}.`, `invalid_${field}`);
  if (max !== undefined && value > max) throw badRequest(`${field} must be at most ${max}.`, `invalid_${field}`);
  return value;
}

export function requiredNumber(value: unknown, field: string, min?: number, max?: number): number {
  if (value === undefined || value === null) throw badRequest(`${field} is required.`, `missing_${field}`);
  return optionalNumber(value, field, min, max) as number;
}

export function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(", ")}.`, `invalid_${field}`);
  }
  return value as T;
}

/** An optional array of enum members; a lone string is accepted as a one-element array. */
export function optionalEnumList<T extends string>(value: unknown, allowed: readonly T[], field: string): T[] | undefined {
  if (value === undefined || value === null) return undefined;
  const items = Array.isArray(value) ? value : [value];
  const out: T[] = [];
  for (const item of items) {
    const member = optionalEnum(item, allowed, field);
    if (member !== undefined && !out.includes(member)) out.push(member);
  }
  return out;
}

export function optionalStringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => requiredString(item, field));
}

/** Query parameters may repeat (`?a=1&a=2`); normalise to a flat list of strings. */
export function queryList(value: unknown): string[] {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.filter((item): item is string => typeof item === "string" && item !== "");
}

export function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

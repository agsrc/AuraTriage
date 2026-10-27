import type { ErrorCode } from "./contracts.js";

/** An error that maps directly onto an HTTP response. Messages are fixed text and never echo patient input. */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
  }
}

export const unauthorized = () => new ApiHttpError(401, "unauthorized", "Sign in to continue.");
export const forbidden = () =>
  new ApiHttpError(403, "forbidden", "You do not have access to this resource.");
export const notFound = (what: string) => new ApiHttpError(404, "not_found", `${what} not found.`);
export const conflict = (message: string) => new ApiHttpError(409, "conflict", message);
export const validationError = (message: string) =>
  new ApiHttpError(400, "validation_error", message);

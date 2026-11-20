// Errors thrown by services; the error handler turns them into { error: { code, message, details? } }.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Please sign in.") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have permission to do that.") => new AppError(403, "FORBIDDEN", message);
// Out-of-scope records are reported exactly like missing ones, so ids can't be probed.
export const notFound = (what = "Record") => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, "UNPROCESSABLE", message, details);

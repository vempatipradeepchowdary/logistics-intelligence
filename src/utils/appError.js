/** Operational error with a stable machine-readable code and HTTP status. */
export class AppError extends Error {
  constructor(code, message, status = 400, details = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Raised when a bulk database write fails; never swallowed. */
export class DataWriteError extends AppError {
  constructor(collection, cause) {
    const writeErrors = cause?.writeErrors ?? cause?.result?.writeErrors ?? [];
    const first = writeErrors[0]?.errmsg ?? writeErrors[0]?.err?.errmsg ?? cause?.message;
    super(
      cause?.code === 11000 ? 'DUPLICATE_KEY' : 'DATA_WRITE_FAILED',
      `Bulk write to "${collection}" failed: ${first}`,
      500,
      [{ collection, failedDocuments: writeErrors.length || null }],
    );
    this.cause = cause;
  }
}

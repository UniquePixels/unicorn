import type { ErrorMetadata } from './types.ts';

/** Maximum cause-chain depth before truncating serialized output. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Base application error with structured metadata.
 *
 * - `code`: machine-readable error code (e.g. "ERR_USER_NOT_FOUND")
 * - `statusCode`: HTTP status hint (e.g. 404)
 * - `metadata`: arbitrary key-value context
 * - `isOperational`: true = expected/handled; false = programmer bug
 * - `cause`: native Error cause chain (ES2022)
 */
export class AppError extends Error {
	public readonly code: string;
	public readonly statusCode: number;
	public readonly metadata: ErrorMetadata;
	public readonly isOperational: boolean;
	public readonly timestamp: string;

	public constructor(
		message: string,
		options: {
			code?: string;
			statusCode?: number;
			metadata?: ErrorMetadata;
			isOperational?: boolean;
			cause?: Error;
		} = {},
	) {
		super(message, { cause: options.cause });
		Object.setPrototypeOf(this, new.target.prototype);

		this.name = new.target.name;
		this.code = options.code ?? 'ERR_UNKNOWN';
		this.statusCode = options.statusCode ?? 500;
		this.metadata = options.metadata ?? {};
		this.isOperational = options.isOperational ?? true;
		this.timestamp = new Date().toISOString();

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, new.target);
		}
	}

	public toJSON(depth = 0): Record<string, unknown> {
		let cause: unknown = this.cause;
		if (this.cause instanceof Error) {
			if (depth >= MAX_CAUSE_DEPTH) {
				// Stack intentionally omitted to keep deeply-nested payloads small
				cause = {
					name: this.cause.name,
					message: this.cause.message,
					truncated: true,
				};
			} else if (this.cause instanceof AppError) {
				cause = this.cause.toJSON(depth + 1);
			} else {
				cause = {
					name: this.cause.name,
					message: this.cause.message,
					stack: this.cause.stack,
				};
			}
		}

		return {
			name: this.name,
			message: this.message,
			code: this.code,
			statusCode: this.statusCode,
			metadata: this.metadata,
			isOperational: this.isOperational,
			timestamp: this.timestamp,
			stack: this.stack,
			cause,
		};
	}
}

/** HTTP error with a required status code. Always operational. */
export class HttpError extends AppError {
	public constructor(
		message: string,
		statusCode: number,
		options: {
			code?: string;
			metadata?: ErrorMetadata;
			cause?: Error;
		} = {},
	) {
		if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
			throw new RangeError(
				`HttpError statusCode must be an integer between 100 and 599, got ${String(statusCode)}`,
			);
		}

		super(message, {
			...options,
			statusCode,
			isOperational: true,
		});
	}
}

/** Validation error with field-level detail. Always 400, always operational. */
export class ValidationError extends AppError {
	public readonly fields: Record<string, string[]>;

	public constructor(
		message: string,
		fields: Record<string, string[]>,
		options: { cause?: Error; metadata?: ErrorMetadata } = {},
	) {
		super(message, {
			code: 'ERR_VALIDATION',
			statusCode: 400,
			isOperational: true,
			metadata: { ...options.metadata, fields },
			...(options.cause && { cause: options.cause }),
		});
		this.fields = fields;
	}
}

/** Database error. Defaults to non-operational (statusCode 503). */
export class DatabaseError extends AppError {
	public constructor(
		message: string,
		options: {
			code?: string;
			metadata?: ErrorMetadata;
			cause?: Error;
			isOperational?: boolean;
		} = {},
	) {
		super(message, {
			code: options.code ?? 'ERR_DATABASE',
			statusCode: 503,
			isOperational: options.isOperational ?? false,
			...(options.metadata && { metadata: options.metadata }),
			...(options.cause && { cause: options.cause }),
		});
	}
}

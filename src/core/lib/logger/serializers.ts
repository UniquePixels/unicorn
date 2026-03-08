import { serializeError as serializeErrorLib } from 'serialize-error';
import { AppError } from './errors.ts';
import { censorSensitiveKeys } from './redaction.ts';
import type { SerializedError } from './types.ts';

/** Maximum recursion depth for error serialization. */
export const MAX_SERIALIZE_DEPTH = 5;

/** Stringifies a non-Error value for the serializer's `message` field. */
function stringifyNonError(value: unknown): string {
	if (value === null || value === undefined) {
		return 'Unknown error';
	}
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return 'Unknown error';
		}
	}
	return String(value);
}

/**
 * Comprehensive error serializer combining:
 * 1. serialize-error (handles circular refs, Maps, Sets, custom properties)
 * 2. AppError-aware extraction of code, statusCode, metadata, isOperational
 * 3. Recursive sensitive key redaction (tokens, passwords, API keys, headers, etc.)
 * 4. AggregateError handling for nested error arrays
 */
export function errorSerializer(
	err: unknown,
	depth = 0,
): SerializedError | Record<string, unknown> {
	if (!err || typeof err !== 'object' || !('message' in err)) {
		return {
			type: String(
				(err as { constructor?: { name?: string } })?.constructor?.name ??
					typeof err,
			),
			message: stringifyNonError(err),
			truncated: false,
		};
	}

	const error = err as Error;

	if (depth >= MAX_SERIALIZE_DEPTH) {
		return { type: error.name, message: error.message, truncated: true };
	}

	const result: Record<string, unknown> = {
		...(serializeErrorLib(error) as Record<string, unknown>),
		type: error.name,
		message: error.message,
		stack: error.stack,
	};

	// AppError-specific structured fields
	if (error instanceof AppError) {
		result['code'] = error.code;
		result['statusCode'] = error.statusCode;
		result['metadata'] = error.metadata;
		result['isOperational'] = error.isOperational;
		result['timestamp'] = error.timestamp;
	}

	// AggregateError handling
	if (error instanceof AggregateError && error.errors.length > 0) {
		result['errors'] = error.errors.map((nested) =>
			nested instanceof Error ? errorSerializer(nested, depth + 1) : nested,
		);
	}

	// Recursive cause with depth tracking
	if (error.cause instanceof Error) {
		result['cause'] = errorSerializer(error.cause, depth + 1);
	}

	return censorSensitiveKeys(result);
}

/** Default pino serializers — both `err` and `error` keys use the error serializer. */
export const defaultSerializers = {
	err: errorSerializer,
	error: errorSerializer,
};

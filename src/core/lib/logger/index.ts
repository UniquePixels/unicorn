export { registerDebugSource } from './debug-channels.ts';

export {
	AppError,
	DatabaseError,
	HttpError,
	ValidationError,
} from './errors.ts';
export { createLogger } from './logger.ts';
export {
	buildRedactPaths,
	CENSOR,
	censorSensitiveKeys,
	SENSITIVE_KEYS,
} from './redaction.ts';
export type { SentryLogLevel, SentryPinoOptions } from './sentry.ts';
export { flushSentry, sentryPinoIntegration } from './sentry.ts';
export {
	defaultSerializers,
	errorSerializer,
	MAX_SERIALIZE_DEPTH,
} from './serializers.ts';

export type {
	DebugEmitter,
	DebugSourceOptions,
	Environment,
	ErrorMetadata,
	ExtendedLogger,
	LoggerConfig,
	LogLevel,
	SerializedError,
} from './types.ts';

/* coverage-ignore-file: type-only module, no runtime code */
import type { Logger, LoggerOptions } from 'pino';

/** Pino log levels. */
export type LogLevel =
	| 'trace'
	| 'debug'
	| 'info'
	| 'warn'
	| 'error'
	| 'fatal'
	| 'silent';

/** Runtime environment. */
export type Environment = 'development' | 'production' | 'test';

/** Options for {@link createLogger}. */
export interface LoggerConfig {
	/** Override environment detection. Defaults to `Bun.env.NODE_ENV` or `"development"`. */
	environment?: Environment;

	/** Minimum log level. Defaults to `"trace"` in dev, `"info"` in prod. */
	level?: LogLevel;

	/** Service name attached to every log line. */
	serviceName?: string;

	/** Extra default bindings merged into every log line. */
	defaultContext?: Record<string, unknown>;

	/** Pino serializers override. Merged with default error serializer. */
	serializers?: LoggerOptions['serializers'];

	/** Disable pretty printing even in dev. */
	disablePretty?: boolean;

	/** Additional redact paths merged with defaults. See {@link buildRedactPaths}. */
	redactPaths?: string[];
}

/** Fully resolved logger configuration (all fields required). */
export interface ResolvedConfig
	extends Required<Omit<LoggerConfig, 'serializers' | 'redactPaths'>> {
	serializers: NonNullable<LoggerOptions['serializers']>;
	redactPaths: string[];
	isDev: boolean;
	isProd: boolean;
}

/** Options for registering an external library's debug events. */
export interface DebugSourceOptions {
	/** Human-readable name (e.g. "discord.js", "prisma"). */
	name: string;

	/** The EventEmitter-like object. */
	emitter: DebugEmitter;

	/** Map of emitter event names to pino log levels. */
	eventMap: Record<string, LogLevel>;

	/** Regex patterns replaced with `"[REDACTED]"` in string messages. */
	redactPatterns?: RegExp[];
}

/** Minimal EventEmitter interface for debug source registration. */
export interface DebugEmitter {
	on(event: string, listener: (...args: unknown[]) => void): unknown;
	off?(event: string, listener: (...args: unknown[]) => void): unknown;
	removeListener?(
		event: string,
		listener: (...args: unknown[]) => void,
	): unknown;
}

/** Arbitrary key-value metadata attached to errors. */
export interface ErrorMetadata {
	[key: string]: unknown;
}

/** Extended pino Logger with debug source registration and graceful shutdown. */
export interface ExtendedLogger extends Logger {
	/** Register an external library's debug/warn/error events. */
	registerDebugSource(options: DebugSourceOptions): () => void;

	/** Graceful shutdown: flush Sentry, close streams. */
	shutdown(): Promise<void>;
}

/** Serialized error shape written to log records. */
export interface SerializedError {
	type: string;
	message: string;
	stack?: string | undefined;
	cause?: unknown;
	errors?: unknown[];
	[key: string]: unknown;
}

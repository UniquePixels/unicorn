import process from 'node:process';
import type { Logger, LoggerOptions } from 'pino';
import pino from 'pino';
import { registerDebugSource } from './debug-channels.ts';
import { buildRedactPaths, CENSOR } from './redaction.ts';
import { flushSentry } from './sentry.ts';
import { defaultSerializers } from './serializers.ts';
import type {
	DebugSourceOptions,
	Environment,
	ExtendedLogger,
	LoggerConfig,
	ResolvedConfig,
} from './types.ts';

/** Guard against double-registering global exception handlers. */
let globalHandlersRegistered = false;

const ValidEnvironments = new Set(['development', 'production', 'test']);

/** Merges user-provided config with environment defaults. */
function resolveConfig(userConfig: LoggerConfig = {}): ResolvedConfig {
	const rawEnv = userConfig.environment ?? Bun.env.NODE_ENV;
	const environment: Environment =
		rawEnv && ValidEnvironments.has(rawEnv)
			? (rawEnv as Environment)
			: 'development';

	const isDev = environment === 'development';
	const isProd = environment === 'production';

	return {
		environment,
		level: userConfig.level ?? (isDev ? 'trace' : 'info'),
		serviceName: userConfig.serviceName ?? 'app',
		defaultContext: userConfig.defaultContext ?? {},
		serializers: { ...defaultSerializers, ...userConfig.serializers },
		disablePretty: userConfig.disablePretty ?? false,
		redactPaths: userConfig.redactPaths ?? [],
		isDev,
		isProd,
	};
}

/**
 * Creates a pino logger configured for the current environment.
 *
 * In development, uses `pino-pretty` for colorized output.
 * In production, outputs JSON to stdout. Sentry's `pinoIntegration` captures
 * logs via `diagnostics_channel` in parallel.
 *
 * Returns an {@link ExtendedLogger} with `registerDebugSource()` and `shutdown()`.
 */
export function createLogger(userConfig: LoggerConfig = {}): ExtendedLogger {
	const config = resolveConfig(userConfig);

	const redactPaths = buildRedactPaths(config.redactPaths);

	const pinoOptions: LoggerOptions = {
		level: config.level,
		serializers: config.serializers,
		redact: { paths: redactPaths, censor: CENSOR },
		base: {
			service: config.serviceName,
			env: config.environment,
			...config.defaultContext,
		},
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level(label: string) {
				return { level: label };
			},
		},
	};

	// In dev, use pino-pretty as a transport for colorized output
	if (config.isDev && !config.disablePretty) {
		pinoOptions.transport = {
			target: 'pino-pretty',
			options: {
				colorize: true,
				translateTime: 'SYS:HH:MM:ss.l',
				ignore: 'pid,hostname',
				errorProps: 'code,statusCode,metadata,isOperational,cause',
			},
		};
	}

	const baseLogger: Logger = pino(pinoOptions);

	// Log-only handlers for stdout visibility. These do NOT exit the process —
	// the consumer's Sentry preload script registers its own handlers that
	// flush events and terminate. Without Sentry, Node/Bun's default
	// uncaughtException behavior (print + exit) still applies.
	if (!globalHandlersRegistered) {
		globalHandlersRegistered = true;

		process.on('uncaughtException', (err: Error) => {
			baseLogger.fatal({ err }, 'Uncaught exception');
		});

		process.on('unhandledRejection', (reason: unknown) => {
			const err = reason instanceof Error ? reason : new Error(String(reason));
			baseLogger.fatal({ err }, 'Unhandled promise rejection');
		});
	}

	const extendedLogger = Object.assign(baseLogger, {
		registerDebugSource(options: DebugSourceOptions): () => void {
			return registerDebugSource(baseLogger, options);
		},

		async shutdown(): Promise<void> {
			try {
				await flushSentry(5000);
			} finally {
				baseLogger.flush();
				// Pino worker-thread transports (e.g. pino-pretty) have no reliable
				// flush callback — this delay is a best-effort wait for the transport
				// worker to drain its queue. Sufficient for normal shutdown; under
				// extreme load, some trailing logs may be lost.
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		},
	}) as ExtendedLogger;

	return extendedLogger;
}

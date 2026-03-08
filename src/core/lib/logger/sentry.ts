import * as Sentry from '@sentry/bun';
import type { LogLevel } from './types.ts';

/** Pino severity levels (excludes `silent` which disables all output). */
export type SentryLogLevel = Exclude<LogLevel, 'silent'>;

/** Options for configuring the Sentry–Pino integration. */
export interface SentryPinoOptions {
	/** Pino levels that become Sentry structured logs. Default: `["info", "warn", "error", "fatal"]` */
	logLevels?: SentryLogLevel[];

	/** Pino levels that create Sentry error events (Issues). Default: `["warn", "error", "fatal"]` */
	errorLevels?: SentryLogLevel[];

	/** Whether Sentry-captured errors are marked as handled. Default `true`. */
	errorsHandled?: boolean;
}

/**
 * Returns a configured `pinoIntegration` for use in your `Sentry.init()` preload script.
 *
 * @example
 * ```ts
 * import * as Sentry from '@sentry/bun';
 * import { sentryPinoIntegration } from '@/core/lib/logger';
 *
 * Sentry.init({
 *   dsn: Bun.env['sentryDSN'],
 *   enableLogs: true,
 *   integrations: [sentryPinoIntegration()],
 * });
 * ```
 */
export function sentryPinoIntegration(
	options: SentryPinoOptions = {},
): ReturnType<typeof Sentry.pinoIntegration> {
	return Sentry.pinoIntegration({
		log: {
			levels: options.logLevels ?? ['info', 'warn', 'error', 'fatal'],
		},
		error: {
			levels: options.errorLevels ?? ['warn', 'error', 'fatal'],
			handled: options.errorsHandled ?? true,
		},
	});
}

/**
 * Flush pending Sentry events before process exit.
 *
 * @param timeout - Maximum time in ms to wait for flush (default 5000).
 * @returns Whether all events were successfully flushed before the timeout.
 */
export function flushSentry(timeout = 5000): Promise<boolean> {
	return Sentry.flush(timeout);
}

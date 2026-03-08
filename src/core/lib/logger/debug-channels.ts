import process from 'node:process';
import * as Sentry from '@sentry/bun';
import type { Logger } from 'pino';
import type { DebugEmitter, DebugSourceOptions, LogLevel } from './types.ts';

interface ActiveRegistration {
	emitter: DebugEmitter;
	listeners: Map<string, (...args: unknown[]) => void>;
	/** True when the emitter has no removal API and listeners cannot be unregistered. */
	nonRemovable?: boolean;
}

const activeRegistrations = new Map<string, ActiveRegistration>();

/** Dispatches a single event argument to the appropriate pino log method. */
function dispatchEvent(
	childLogger: Logger,
	level: LogLevel,
	firstArg: unknown,
	secondArg: unknown,
	sourceName: string,
	eventName: string,
	redactPatterns: RegExp[],
): void {
	if (firstArg instanceof Error) {
		childLogger[level]({ err: firstArg }, firstArg.message);
	} else if (typeof firstArg === 'string') {
		const message = applyRedaction(firstArg, redactPatterns);
		childLogger[level](message);
	} else if (firstArg && typeof firstArg === 'object') {
		const rawMsg =
			typeof secondArg === 'string' ? secondArg : `${sourceName}:${eventName}`;
		const msg = applyRedaction(rawMsg, redactPatterns);
		childLogger[level](firstArg as Record<string, unknown>, msg);
	} else {
		const msg = applyRedaction(
			`${sourceName}:${eventName} ${String(firstArg)}`,
			redactPatterns,
		);
		childLogger[level](msg);
	}
}

/**
 * Register an external library's event emitter to route its events through pino.
 *
 * Generalizes the discord.js pattern:
 * ```ts
 * client.on('debug', (msg) => logger.debug({ source: 'discord.js' }, msg))
 * ```
 *
 * Handles three argument shapes:
 * - **Error objects** → logged with the `err` serializer key
 * - **Strings** → redaction applied, logged as message
 * - **Objects** → spread as pino context
 *
 * @returns Unsubscribe function that removes all listeners for this source.
 */
export function registerDebugSource(
	logger: Logger,
	options: DebugSourceOptions,
): () => void {
	const { name, emitter, eventMap, redactPatterns = [] } = options;
	const childLogger = logger.child({ source: name });
	const normalizedPatterns = redactPatterns.map((p) =>
		p.global ? p : new RegExp(p.source, `${p.flags}g`),
	);

	// Tear down previous registration for this name (skip if non-removable)
	const existing = activeRegistrations.get(name);
	if (existing?.nonRemovable) {
		return () => {
			/* noop — emitter has no removal API */
		};
	}
	unregisterDebugSource(name);

	const listeners = new Map<string, (...args: unknown[]) => void>();

	for (const [eventName, level] of Object.entries(eventMap)) {
		const listener = (...args: unknown[]) => {
			try {
				dispatchEvent(
					childLogger,
					level,
					args[0],
					args[1],
					name,
					eventName,
					normalizedPatterns,
				);
			} catch (err) {
				// Pino itself failed — capture via Sentry and write to stderr as fallback
				Sentry.captureException(err);
				process.stderr.write(`Failed to log debug event: ${String(err)}\n`);
			}
		};

		emitter.on(eventName, listener);
		listeners.set(eventName, listener);
	}

	activeRegistrations.set(name, { emitter, listeners });

	return () => unregisterDebugSource(name);
}

/** Tears down listeners for a previously registered debug source. */
function unregisterDebugSource(name: string): void {
	const registration = activeRegistrations.get(name);
	if (!registration) {
		return;
	}

	const { emitter, listeners } = registration;
	const removeMethod = emitter.off ?? emitter.removeListener;

	if (removeMethod) {
		for (const [eventName, listener] of listeners) {
			removeMethod.call(emitter, eventName, listener);
		}
		activeRegistrations.delete(name);
	} else {
		// Cannot remove listeners — mark as non-removable to prevent duplicate handlers
		registration.nonRemovable = true;
		process.stderr.write(
			`Warning: DebugEmitter "${name}" has no removal API; listeners cannot be unregistered\n`,
		);
	}
}

/** Replaces all matches of redaction patterns with `[REDACTED]`. */
function applyRedaction(message: string, patterns: RegExp[]): string {
	let result = message;
	for (const pattern of patterns) {
		result = result.replace(pattern, '[REDACTED]');
	}
	return result;
}

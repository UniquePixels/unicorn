import type { Client } from 'discord.js';
import { attempt } from '@/core/lib/attempt';
import type { ExtendedLogger } from '@/core/lib/logger';
import { stopAllScheduledJobs } from '@/core/sparks';

/**
 * Shared shutdown signal.
 * Passed to both the shutdown handler and the health check handler
 * so `/ready` can return 503 immediately when shutdown begins.
 */
export interface ShutdownSignal {
	shuttingDown: boolean;
}

/** Creates a new shutdown signal instance. */
export function createShutdownSignal(): ShutdownSignal {
	return { shuttingDown: false };
}

/**
 * Dependencies for the shutdown handler.
 *
 * Timer function overrides (`setTimeout`, `clearInterval`, `clearTimeout`) exist
 * for testability — Bun lacks first-class fake timer APIs, so dependency injection
 * lets tests capture timeout callbacks without monkey-patching globals.
 */
export interface ShutdownDeps {
	client: Client;
	logger: ExtendedLogger;
	cleanupIntervalId: Timer;
	shutdownSignal: ShutdownSignal;
	healthCheckServer?: { stop(): void };
	exit: (code: number) => never;
	timeoutMs?: number;
	/** @internal Test override — defaults to `globalThis.setTimeout` */
	setTimeout?: typeof globalThis.setTimeout;
	/** @internal Test override — defaults to `globalThis.clearInterval` */
	clearInterval?: typeof globalThis.clearInterval;
	/** @internal Test override — defaults to `globalThis.clearTimeout` */
	clearTimeout?: typeof globalThis.clearTimeout;
}

/** Runs a cleanup step, logging a warning on failure without throwing. */
async function safeCleanup(
	logger: ExtendedLogger,
	message: string,
	fn: () => void | Promise<void>,
): Promise<void> {
	const result = await attempt(fn);
	if (result.isErr()) {
		logger.warn({ err: result.error }, message);
	}
}

/**
 * Creates a shutdown handler that performs graceful cleanup.
 * Extracted for testability without needing to send real signals.
 */
export function createShutdownHandler(
	deps: ShutdownDeps,
): (signal: string) => Promise<void> {
	const {
		client,
		logger,
		cleanupIntervalId,
		shutdownSignal,
		healthCheckServer,
		exit,
		timeoutMs = 10_000,
	} = deps;

	const setTimeoutFn = deps.setTimeout ?? globalThis.setTimeout;
	const clearIntervalFn = deps.clearInterval ?? globalThis.clearInterval;
	const clearTimeoutFn = deps.clearTimeout ?? globalThis.clearTimeout;

	return async (signal: string): Promise<void> => {
		if (shutdownSignal.shuttingDown) {
			logger.warn({ signal }, 'Shutdown already in progress, ignoring');
			return;
		}
		shutdownSignal.shuttingDown = true;

		logger.info({ signal }, 'Received shutdown signal');

		// Force exit if graceful shutdown hangs
		const forceExitTimeout = setTimeoutFn(() => {
			logger.error('Graceful shutdown timed out, forcing exit');
			exit(1);
		}, timeoutMs);

		// Ensure the timeout doesn't keep the process alive if shutdown completes
		// Note: unref() may not exist on mocked timeouts, so we check first
		if (typeof forceExitTimeout === 'object' && 'unref' in forceExitTimeout) {
			forceExitTimeout.unref();
		}

		// Each step is wrapped individually so one failure doesn't skip the rest
		await safeCleanup(logger, 'Failed to clear cleanup interval', () =>
			clearIntervalFn(cleanupIntervalId),
		);
		if (healthCheckServer) {
			await safeCleanup(logger, 'Failed to stop health check server', () =>
				healthCheckServer.stop(),
			);
		}
		await safeCleanup(logger, 'Failed to stop scheduled jobs', () =>
			stopAllScheduledJobs(client),
		);
		await safeCleanup(logger, 'Failed to destroy Discord client', () =>
			client.destroy(),
		);

		logger.info('Shutdown complete');

		await safeCleanup(logger, 'Failed to flush logger/Sentry', () =>
			logger.shutdown(),
		);

		clearTimeoutFn(forceExitTimeout);
		exit(0);
	};
}

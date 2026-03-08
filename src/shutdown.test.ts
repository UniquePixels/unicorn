import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createMockClient } from '@/core/lib/test-helpers';
import {
	createShutdownHandler,
	createShutdownSignal,
	type ShutdownDeps,
} from './shutdown';

// ─── Test Helpers ────────────────────────────────────────────────

// Track intervals to clean up after each test (prevents resource leaks)
const testIntervals: Timer[] = [];

afterEach(() => {
	for (const id of testIntervals) {
		clearInterval(id);
	}
	testIntervals.length = 0;
});

function createMockDeps(overrides: Partial<ShutdownDeps> = {}): ShutdownDeps {
	const client = overrides.client ?? createMockClient();
	const intervalId =
		overrides.cleanupIntervalId ?? setInterval(() => {}, 999_999);
	testIntervals.push(intervalId);

	const deps: ShutdownDeps = {
		client,
		logger:
			overrides.logger ?? (client.logger as unknown as ShutdownDeps['logger']),
		cleanupIntervalId: intervalId,
		shutdownSignal: overrides.shutdownSignal ?? createShutdownSignal(),
		exit:
			overrides.exit ??
			(mock(() => undefined) as unknown as (code: number) => never),
	};

	if (overrides.healthCheckServer !== undefined) {
		deps.healthCheckServer = overrides.healthCheckServer;
	}
	if (overrides.timeoutMs !== undefined) {
		deps.timeoutMs = overrides.timeoutMs;
	}
	if (overrides.setTimeout !== undefined) {
		deps.setTimeout = overrides.setTimeout;
	}
	if (overrides.clearInterval !== undefined) {
		deps.clearInterval = overrides.clearInterval;
	}
	if (overrides.clearTimeout !== undefined) {
		deps.clearTimeout = overrides.clearTimeout;
	}

	return deps;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('createShutdownHandler', () => {
	test('destroys Discord client', async () => {
		const client = createMockClient();
		const deps = createMockDeps({ client });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(client.destroy).toHaveBeenCalledTimes(1);
	});

	test('calls exit with code 0', async () => {
		const deps = createMockDeps();
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(deps.exit).toHaveBeenCalledWith(0);
	});

	test('stops health check server when provided', async () => {
		const healthCheckServer = { stop: mock(() => {}) };
		const deps = createMockDeps({ healthCheckServer });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(healthCheckServer.stop).toHaveBeenCalledTimes(1);
	});

	test('force exits when shutdown timeout expires', async () => {
		const exit = mock(() => undefined) as unknown as (code: number) => never;
		const client = createMockClient();

		// Mock setTimeout to capture the timeout callback
		let timeoutCallback: (() => void) | undefined;
		const setTimeoutMock = mock((fn: () => void, _ms: number) => {
			timeoutCallback = fn;
			// biome-ignore lint/suspicious/noExplicitAny: mock timer return value not used by SUT
			return {} as any;
		}) as unknown as typeof setTimeout;

		const deps = createMockDeps({
			client,
			exit,
			timeoutMs: 10_000,
			setTimeout: setTimeoutMock,
		});
		const shutdown = createShutdownHandler(deps);
		await shutdown('SIGTERM');

		// Simulate the timeout firing
		expect(timeoutCallback).toBeDefined();
		expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 10_000);
		(timeoutCallback as () => void)();

		expect(exit).toHaveBeenCalledWith(1);
		expect(client.logger.error).toHaveBeenCalledWith(
			'Graceful shutdown timed out, forcing exit',
		);
	});

	test('logs shutdown signal', async () => {
		const client = createMockClient();
		const deps = createMockDeps({ client });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGINT');

		expect(client.logger.info).toHaveBeenCalledWith(
			{ signal: 'SIGINT' },
			'Received shutdown signal',
		);
	});

	test('logs warning when health check server stop fails', async () => {
		const error = new Error('stop failed');
		const healthCheckServer = {
			stop: mock(() => {
				throw error;
			}),
		};
		const client = createMockClient();
		const deps = createMockDeps({ client, healthCheckServer });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(client.logger.warn).toHaveBeenCalledWith(
			{ err: error },
			'Failed to stop health check server',
		);
		expect(deps.exit).toHaveBeenCalledWith(0);
	});

	test('logs warning when scheduled jobs stop fails', async () => {
		const client = createMockClient();
		const error = new Error('stop jobs failed');
		// Mock a scheduled job that throws when stopped
		const job = {
			stop: mock(() => {
				throw error;
			}),
		};
		// biome-ignore lint/suspicious/noExplicitAny: partial CronJob mock — only stop() is exercised
		client.scheduledJobs.set('test-job', job as any);

		const deps = createMockDeps({ client });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(client.logger.warn).toHaveBeenCalledWith(
			{ err: error },
			'Failed to stop scheduled jobs',
		);
		expect(deps.exit).toHaveBeenCalledWith(0);
	});

	test('logs warning when client destroy fails', async () => {
		const client = createMockClient();
		const error = new Error('destroy failed');
		client.destroy = mock(() => {
			throw error;
		});

		const deps = createMockDeps({ client });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(client.logger.warn).toHaveBeenCalledWith(
			{ err: error },
			'Failed to destroy Discord client',
		);
		expect(deps.exit).toHaveBeenCalledWith(0);
	});

	test('calls logger.shutdown() for flush', async () => {
		const client = createMockClient();
		const deps = createMockDeps({ client });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(client.logger.shutdown).toHaveBeenCalledTimes(1);
	});

	test('logs warning when logger shutdown fails', async () => {
		const client = createMockClient();
		const error = new Error('flush failed');
		client.logger.shutdown = mock(() => {
			throw error;
		});
		const deps = createMockDeps({ client });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(client.logger.warn).toHaveBeenCalledWith(
			{ err: error },
			'Failed to flush logger/Sentry',
		);
		expect(deps.exit).toHaveBeenCalledWith(0);
	});

	test('logs warning when clearInterval fails', async () => {
		const client = createMockClient();
		const error = new Error('clearInterval failed');
		const mockIntervalId = setInterval(() => {}, 999_999);
		testIntervals.push(mockIntervalId);

		// Mock clearInterval to throw
		const clearIntervalMock = mock(() => {
			throw error;
		}) as unknown as typeof clearInterval;

		const deps = createMockDeps({
			client,
			cleanupIntervalId: mockIntervalId,
			clearInterval: clearIntervalMock,
		});
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');

		expect(client.logger.warn).toHaveBeenCalledWith(
			{ err: error },
			'Failed to clear cleanup interval',
		);
		expect(deps.exit).toHaveBeenCalledWith(0);
	});

	test('sets shuttingDown flag on shutdown signal', async () => {
		const shutdownSignal = createShutdownSignal();
		const deps = createMockDeps({ shutdownSignal });
		const shutdown = createShutdownHandler(deps);

		expect(shutdownSignal.shuttingDown).toBe(false);
		await shutdown('SIGTERM');
		expect(shutdownSignal.shuttingDown).toBe(true);
	});

	test('ignores duplicate shutdown signals (reentrancy guard)', async () => {
		const shutdownSignal = createShutdownSignal();
		const client = createMockClient();
		const deps = createMockDeps({ client, shutdownSignal });
		const shutdown = createShutdownHandler(deps);

		await shutdown('SIGTERM');
		await shutdown('SIGINT');

		// exit only called once (first shutdown)
		expect(deps.exit).toHaveBeenCalledTimes(1);
		expect(client.logger.warn).toHaveBeenCalledWith(
			{ signal: 'SIGINT' },
			'Shutdown already in progress, ignoring',
		);
	});
});

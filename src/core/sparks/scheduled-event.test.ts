import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { CronJob } from 'cron';
import type { Client } from 'discord.js';
import { assertDefined, createMockClient } from '@/core/lib/test-helpers';
import {
	defineScheduledEvent,
	type ScheduledContext,
	stopAllScheduledJobs,
} from './scheduled-event';

// ─── Test Helpers ────────────────────────────────────────────────

function createMockContext(
	client: Client,
	overrides: Partial<ScheduledContext> = {},
): ScheduledContext {
	return {
		client,
		job: { stop: mock(() => {}) } as unknown as CronJob,
		fireDate: new Date('2025-01-01T00:00:00Z'),
		...overrides,
	};
}

/** Spy on CronJob.from to capture the onTick callback. Restores automatically via afterEach. */
let activeCronSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
	activeCronSpy?.mockRestore();
	activeCronSpy = undefined;
});

function spyCronFrom() {
	let onTick: (() => Promise<void>) | undefined;
	activeCronSpy = spyOn(CronJob, 'from').mockImplementation(((params: {
		onTick: () => Promise<void>;
	}) => {
		onTick = params.onTick;
		return {
			stop: mock(() => {}),
			nextDate: () => ({ toISO: () => '2025-01-01T00:00:00.000Z' }),
		} as unknown as CronJob;
	}) as unknown as typeof CronJob.from);
	return { getOnTick: () => onTick };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('defineScheduledEvent', () => {
	test('creates spark with correct type', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.type).toBe('scheduled-event');
	});

	test('sets id from options', () => {
		const spark = defineScheduledEvent({
			id: 'daily-cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.id).toBe('daily-cleanup');
	});

	test('stores single schedule string', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.schedule).toBe('0 0 * * *');
	});

	test('stores array of schedules', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: ['0 9 * * 1-5', '0 17 * * 1-5'],
			action: async () => {},
		});

		expect(spark.schedule).toEqual(['0 9 * * 1-5', '0 17 * * 1-5']);
	});

	test('throws on invalid cron expression at define-time', () => {
		expect(() =>
			defineScheduledEvent({
				id: 'bad-cron',
				schedule: 'not-a-cron',
				action: async () => {},
			}),
		).toThrow(
			'Invalid cron expression "not-a-cron" in scheduled event "bad-cron"',
		);
	});

	test('defaults timezone to UTC', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.timezone).toBe('UTC');
	});

	test('preserves custom timezone', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			timezone: 'America/New_York',
			action: async () => {},
		});

		expect(spark.timezone).toBe('America/New_York');
	});

	test('defaults guards to empty array', () => {
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action: async () => {},
		});

		expect(spark.guards).toEqual([]);
	});

	test('preserves provided guards', () => {
		const guard = mock(
			(input: ScheduledContext) =>
				({ ok: true as const, value: input }) as const,
		);
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			guards: [guard],
			action: async () => {},
		});

		expect(spark.guards).toHaveLength(1);
		expect(spark.guards[0]).toBe(guard);
	});

	test('stores action reference', () => {
		const action = mock(async () => {});
		const spark = defineScheduledEvent({
			id: 'cleanup',
			schedule: '0 0 * * *',
			action,
		});

		expect(spark.action).toBe(action);
	});

	describe('execute', () => {
		test('calls action when no guards are defined', async () => {
			const action = mock(async () => {});
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action,
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			const result = await spark.execute(ctx);

			expect(result.ok).toBe(true);
			expect(action).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledWith(ctx);
		});

		test('runs guards and calls action on success', async () => {
			const guard = mock(
				(input: ScheduledContext) =>
					({ ok: true as const, value: input }) as const,
			);
			const action = mock(async () => {});
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				guards: [guard],
				action,
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			const result = await spark.execute(ctx);

			expect(result.ok).toBe(true);
			expect(guard).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledTimes(1);
		});

		test('returns guard failure and does NOT call action', async () => {
			const guard = mock(() => ({
				ok: false as const,
				reason: 'Not allowed',
			}));
			const action = mock(async () => {});
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				guards: [guard],
				action,
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			const result = await spark.execute(ctx);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Not allowed');
			}
			expect(action).not.toHaveBeenCalled();
		});

		test('logs warn on guard failure (silent mode)', async () => {
			const guard = mock(() => ({
				ok: false as const,
				reason: 'Maintenance mode',
			}));
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				guards: [guard],
				action: async () => {},
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			await spark.execute(ctx);

			expect(client.logger.warn).toHaveBeenCalledWith(
				{ context: 'scheduled:cleanup', reason: 'Maintenance mode' },
				'Guard check failed',
			);
		});

		test('logs error when action throws', async () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: () => Promise.reject(new Error('action broke')),
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			await spark.execute(ctx);

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ scheduled: 'cleanup' }),
				'Scheduled event action failed',
			);
		});

		test('returns ok result even when action throws', async () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: () => Promise.reject(new Error('boom')),
			});

			const client = createMockClient();
			const ctx = createMockContext(client);
			const result = await spark.execute(ctx);

			expect(result.ok).toBe(true);
		});
	});

	describe('register', () => {
		test('creates CronJob for single schedule and stores in scheduledJobs', () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.scheduledJobs.has('cleanup:0 0 * * *')).toBe(true);
			const job = client.scheduledJobs.get('cleanup:0 0 * * *');
			expect(job).toBeInstanceOf(CronJob);
		});

		test('onTick callback calls execute and logs debug', async () => {
			const cron = spyCronFrom();

			const action = mock(async () => {});
			const spark = defineScheduledEvent({
				id: 'tick-test',
				schedule: '* * * * * *',
				action,
			});

			const client = createMockClient();
			spark.register(client);

			const onTick = cron.getOnTick();
			assertDefined(onTick);
			await onTick();

			spark.stop(client);

			expect(action).toHaveBeenCalled();
			expect(client.logger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ scheduled: 'tick-test' }),
				'Scheduled event tick',
			);
		});

		test('onTick callback logs error when execute rejects unexpectedly', async () => {
			const cron = spyCronFrom();

			const spark = defineScheduledEvent({
				id: 'kaboom-test',
				schedule: '* * * * * *',
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			// Sabotage execute to simulate an unexpected rejection
			spark.execute = () => Promise.reject(new Error('unexpected kaboom'));

			const onTick = cron.getOnTick();
			assertDefined(onTick);
			await onTick();
			spark.stop(client);

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ scheduled: 'kaboom-test' }),
				'Scheduled event handler failed unexpectedly',
			);
		});

		test('onTick callback handles guard exception via processGuards', async () => {
			const cron = spyCronFrom();

			const throwingGuard = mock(() => {
				throw new Error('guard exploded');
			});
			const spark = defineScheduledEvent({
				id: 'err-test',
				schedule: '* * * * * *',
				guards: [throwingGuard],
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			const onTick = cron.getOnTick();
			assertDefined(onTick);
			await onTick();

			spark.stop(client);

			// processGuards catches the guard exception and logs it
			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					context: 'scheduled:err-test',
				}),
				'Guard exception',
			);
		});

		test('creates multiple CronJobs for array schedule', () => {
			const spark = defineScheduledEvent({
				id: 'health',
				schedule: ['0 9 * * 1-5', '0 17 * * 1-5'],
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.scheduledJobs.has('health:0 9 * * 1-5')).toBe(true);
			expect(client.scheduledJobs.has('health:0 17 * * 1-5')).toBe(true);
			expect(client.scheduledJobs.size).toBe(2);
		});
	});

	describe('stop', () => {
		test('stops jobs and removes from scheduledJobs', () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.scheduledJobs.size).toBe(1);
			spark.stop(client);

			expect(client.scheduledJobs.size).toBe(0);
		});

		test('stops all jobs for array schedule', () => {
			const spark = defineScheduledEvent({
				id: 'health',
				schedule: ['0 9 * * 1-5', '0 17 * * 1-5'],
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.scheduledJobs.size).toBe(2);
			spark.stop(client);

			expect(client.scheduledJobs.size).toBe(0);
		});

		test('handles gracefully when jobs do not exist', () => {
			const spark = defineScheduledEvent({
				id: 'cleanup',
				schedule: '0 0 * * *',
				action: async () => {},
			});

			const client = createMockClient();
			// Don't register — stop should not throw
			spark.stop(client);

			expect(client.scheduledJobs.size).toBe(0);
		});
	});
});

describe('stopAllScheduledJobs', () => {
	test('stops all jobs in scheduledJobs collection', () => {
		const client = createMockClient();

		// Register two sparks
		const spark1 = defineScheduledEvent({
			id: 'job1',
			schedule: '0 0 * * *',
			action: async () => {},
		});
		const spark2 = defineScheduledEvent({
			id: 'job2',
			schedule: '0 12 * * *',
			action: async () => {},
		});
		spark1.register(client);
		spark2.register(client);

		expect(client.scheduledJobs.size).toBe(2);

		stopAllScheduledJobs(client);

		expect(client.scheduledJobs.size).toBe(0);
	});

	test('handles empty collection without errors', () => {
		const client = createMockClient();

		// Should not throw
		stopAllScheduledJobs(client);

		expect(client.scheduledJobs.size).toBe(0);
	});
});

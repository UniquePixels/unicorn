import { describe, expect, mock, test } from 'bun:test';
import { type ClientEvents, Events } from 'discord.js';
import type { Guard } from '@/core/guards';
import { createMockClient } from '@/core/lib/test-helpers';
import { defineGatewayEvent } from './gateway-event';

// ─── Test Helpers ────────────────────────────────────────────────

type MessageCreateArg = ClientEvents[typeof Events.MessageCreate][0];
type MessageUpdateArgs = ClientEvents[typeof Events.MessageUpdate];

/** Creates a mock MessageCreate event argument. */
function createMockMessage(): MessageCreateArg {
	return { content: 'hello' } as unknown as MessageCreateArg;
}

/** Creates a mock MessageUpdate event args tuple (oldMessage, newMessage). */
function createMockMessageUpdateArgs(): MessageUpdateArgs {
	return [
		{ content: 'old', id: '1' } as unknown as MessageUpdateArgs[0],
		{ content: 'new', id: '1' } as unknown as MessageUpdateArgs[1],
	];
}

// ─── Tests ───────────────────────────────────────────────────────

describe('defineGatewayEvent', () => {
	test('creates spark with correct type', () => {
		const spark = defineGatewayEvent({
			event: Events.MessageCreate,
			action: async () => {},
		});

		expect(spark.type).toBe('gateway-event');
	});

	test('sets event name from options', () => {
		const spark = defineGatewayEvent({
			event: Events.MessageCreate,
			action: async () => {},
		});

		expect(spark.event).toBe(Events.MessageCreate);
	});

	test('defaults once to false', () => {
		const spark = defineGatewayEvent({
			event: Events.MessageCreate,
			action: async () => {},
		});

		expect(spark.once).toBe(false);
	});

	test('sets once to true when specified', () => {
		const spark = defineGatewayEvent({
			event: Events.ClientReady,
			once: true,
			action: async () => {},
		});

		expect(spark.once).toBe(true);
	});

	test('defaults guards to empty array', () => {
		const spark = defineGatewayEvent({
			event: Events.MessageCreate,
			action: async () => {},
		});

		expect(spark.guards).toEqual([]);
	});

	test('preserves provided guards', () => {
		const guard = mock(
			(input: MessageCreateArg) =>
				({ ok: true as const, value: input }) as const,
		) as Guard<MessageCreateArg, MessageCreateArg>;
		const spark = defineGatewayEvent({
			event: Events.MessageCreate,
			guards: [guard],
			action: async () => {},
		});

		expect(spark.guards).toHaveLength(1);
		expect(spark.guards[0]).toBe(guard);
	});

	test('stores action reference', () => {
		const action = mock(async () => {});
		const spark = defineGatewayEvent({
			event: Events.MessageCreate,
			action,
		});

		expect(spark.action).toBe(action);
	});

	describe('execute', () => {
		test('calls action when no guards are defined', async () => {
			const action = mock(async () => {});
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				action,
			});

			const client = createMockClient();
			const msg = createMockMessage();
			const result = await spark.execute([msg], client);

			expect(result.ok).toBe(true);
			expect(action).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledWith(msg, client);
		});

		test('runs guards and calls action on success', async () => {
			const guard = mock(
				(input: MessageCreateArg) =>
					({ ok: true as const, value: input }) as const,
			) as Guard<MessageCreateArg, MessageCreateArg>;
			const action = mock(async () => {});
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				guards: [guard],
				action,
			});

			const client = createMockClient();
			const result = await spark.execute([createMockMessage()], client);

			expect(result.ok).toBe(true);
			expect(guard).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledTimes(1);
		});

		test('returns guard failure and does NOT call action', async () => {
			const guard = mock(
				() => ({ ok: false as const, reason: 'Bot message' }) as const,
			) as Guard<MessageCreateArg, MessageCreateArg>;
			const action = mock(async () => {});
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				guards: [guard],
				action,
			});

			const client = createMockClient();
			const result = await spark.execute([createMockMessage()], client);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Bot message');
			}
			expect(action).not.toHaveBeenCalled();
		});

		test('logs warn on guard failure (silent mode)', async () => {
			const guard = mock(
				() => ({ ok: false as const, reason: 'Not in guild' }) as const,
			) as Guard<MessageCreateArg, MessageCreateArg>;
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				guards: [guard],
				action: async () => {},
			});

			const client = createMockClient();
			await spark.execute([createMockMessage()], client);

			expect(client.logger.warn).toHaveBeenCalledWith(
				{
					context: `gateway:${Events.MessageCreate}`,
					reason: 'Not in guild',
				},
				'Guard check failed',
			);
		});

		test('logs error when action throws', async () => {
			// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
			const throwingAction = async () => {
				throw new Error('action broke');
			};
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				action: throwingAction,
			});

			const client = createMockClient();
			await spark.execute([createMockMessage()], client);

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ event: Events.MessageCreate }),
				'Gateway event action failed',
			);
		});

		test('returns ok result even when action throws', async () => {
			// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
			const throwingAction2 = async () => {
				throw new Error('boom');
			};
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				action: throwingAction2,
			});

			const client = createMockClient();
			const result = await spark.execute([createMockMessage()], client);

			expect(result.ok).toBe(true);
		});

		test('short-circuits on first guard failure', async () => {
			const guard1 = mock(
				() =>
					({
						ok: false as const,
						reason: 'First failed',
					}) as const,
			) as Guard<MessageCreateArg, MessageCreateArg>;
			const guard2 = mock(
				(input: MessageCreateArg) =>
					({ ok: true as const, value: input }) as const,
			) as Guard<MessageCreateArg, MessageCreateArg>;
			const action = mock(async () => {});
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				guards: [guard1, guard2],
				action,
			});

			const client = createMockClient();
			await spark.execute([createMockMessage()], client);

			expect(guard1).toHaveBeenCalledTimes(1);
			expect(guard2).not.toHaveBeenCalled();
			expect(action).not.toHaveBeenCalled();
		});

		test('handles async guards', async () => {
			const guard = mock(
				async (input: MessageCreateArg) =>
					({ ok: true as const, value: input }) as const,
			) as Guard<MessageCreateArg, MessageCreateArg>;
			const action = mock(async () => {});
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				guards: [guard],
				action,
			});

			const client = createMockClient();
			const result = await spark.execute([createMockMessage()], client);

			expect(result.ok).toBe(true);
			expect(action).toHaveBeenCalledTimes(1);
		});
	});

	describe('multi-argument events', () => {
		test('passes remaining event args between guarded arg and client', async () => {
			const action = mock(async () => {});
			const spark = defineGatewayEvent({
				event: Events.MessageUpdate,
				action,
			});

			const client = createMockClient();
			const [oldMsg, newMsg] = createMockMessageUpdateArgs();
			const result = await spark.execute([oldMsg, newMsg], client);

			expect(result.ok).toBe(true);
			expect(action).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledWith(oldMsg, newMsg, client);
		});

		test('passes guarded first arg with remaining args on guard success', async () => {
			const narrowed = {
				content: 'old',
				id: '1',
				guild: {},
			} as unknown as MessageUpdateArgs[0];
			const guard = mock(
				() => ({ ok: true as const, value: narrowed }) as const,
			) as Guard<MessageUpdateArgs[0], MessageUpdateArgs[0]>;
			const action = mock(async () => {});
			const spark = defineGatewayEvent({
				event: Events.MessageUpdate,
				guards: [guard],
				action,
			});

			const client = createMockClient();
			const [oldMsg, newMsg] = createMockMessageUpdateArgs();
			const result = await spark.execute([oldMsg, newMsg], client);

			expect(result.ok).toBe(true);
			expect(guard).toHaveBeenCalledTimes(1);
			expect(action).toHaveBeenCalledWith(narrowed, newMsg, client);
		});
	});

	describe('register', () => {
		test('calls client.on for recurring events', () => {
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				once: false,
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.on).toHaveBeenCalledTimes(1);
			expect(client.once).not.toHaveBeenCalled();
			expect(client.on).toHaveBeenCalledWith(
				Events.MessageCreate,
				expect.any(Function),
			);
		});

		test('calls client.once for one-time events', () => {
			const spark = defineGatewayEvent({
				event: Events.ClientReady,
				once: true,
				action: async () => {},
			});

			const client = createMockClient();
			spark.register(client);

			expect(client.once).toHaveBeenCalledTimes(1);
			expect(client.on).not.toHaveBeenCalled();
			expect(client.once).toHaveBeenCalledWith(
				Events.ClientReady,
				expect.any(Function),
			);
		});

		test('registered handler catches errors from execute', async () => {
			// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
			const throwingHandler = async () => {
				throw new Error('handler error');
			};
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				action: throwingHandler,
			});

			const onMock = mock((..._args: unknown[]) => {});
			const client = createMockClient({ on: onMock });
			spark.register(client);

			// Get the registered handler
			const handler = onMock.mock.calls[0]?.[1] as (
				...args: unknown[]
			) => Promise<void>;

			// Call the handler — should not throw
			await handler({ content: 'hello' });

			// The error should have been logged via execute's action error handling
			expect(client.logger.error).toHaveBeenCalled();
		});

		test('logs error when execute itself rejects unexpectedly', async () => {
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				action: async () => {},
			});

			const onMock = mock((..._args: unknown[]) => {});
			const client = createMockClient({ on: onMock });
			spark.register(client);

			// Sabotage execute to simulate an unexpected rejection
			// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
			const sabotaged = async () => {
				throw new Error('unexpected kaboom');
			};
			spark.execute = sabotaged as typeof spark.execute;

			const handler = onMock.mock.calls[0]?.[1] as (
				...args: unknown[]
			) => Promise<void>;
			await handler({ content: 'hello' });

			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ event: Events.MessageCreate }),
				'Gateway event handler failed unexpectedly',
			);
		});

		test('guard exception is caught by processGuards and logged', async () => {
			// A guard that throws is now caught by processGuards inside execute(),
			// not by the outer handler catch.
			const throwingGuard = mock(() => {
				throw new Error('guard exploded');
			}) as Guard<MessageCreateArg, MessageCreateArg>;
			const spark = defineGatewayEvent({
				event: Events.MessageCreate,
				guards: [throwingGuard],
				action: async () => {},
			});

			const client = createMockClient();
			const result = await spark.execute([createMockMessage()], client);

			// processGuards catches the exception and returns failure
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('An internal error occurred.');
			}

			// Error is logged by processGuards
			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					context: `gateway:${Events.MessageCreate}`,
				}),
				'Guard exception',
			);
		});
	});
});

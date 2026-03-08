import { describe, expect, mock, test } from 'bun:test';
import { AppError } from '@/core/lib/logger';
import {
	createMockClient,
	createMockComponentInteraction,
} from '@/core/lib/test-helpers';
import {
	type AnyComponentInteraction,
	type BaseComponentSpark,
	defineComponent,
	findComponentSpark,
	parseComponentId,
} from './component';

// ─── Test Helpers ────────────────────────────────────────────────

/** Cast a defineComponent result to the base type used by lookup collections. */
function asBase(spark: { key: string }): BaseComponentSpark {
	return spark as unknown as BaseComponentSpark;
}

/** Create empty lookup collections and a shorthand find function. */
function createLookupContext() {
	const components = new Map<string, BaseComponentSpark>();
	const find = (customId: string) => findComponentSpark(components, customId);
	return { components, find };
}

// ─── parseComponentId ────────────────────────────────────────────

describe('parseComponentId', () => {
	test('exact string returns exact descriptor', () => {
		const result = parseComponentId('confirm-action');

		expect(result.type).toBe('exact');
		expect(result.key).toBe('confirm-action');
	});

	test('parameterized single param returns correct descriptor', () => {
		const result = parseComponentId('{ban-:userId}');

		expect(result.type).toBe('parameterized');
		expect(result.key).toBe('ban-');
		if (result.type === 'parameterized') {
			expect(result.params).toEqual(['userId']);
			expect(result.regex.source).toBe('^ban-(?<userId>[^-]+)$');
		}
	});

	test('parameterized multi-param returns correct descriptor', () => {
		const result = parseComponentId('{ticket-:action-:ticketId}');

		expect(result.type).toBe('parameterized');
		expect(result.key).toBe('ticket-');
		if (result.type === 'parameterized') {
			expect(result.params).toEqual(['action', 'ticketId']);
			expect(result.regex.source).toBe(
				'^ticket-(?<action>[^-]+)-(?<ticketId>[^-]+)$',
			);
		}
	});

	test('throws AppError on malformed pattern with no param markers', () => {
		expect(() => parseComponentId('{ban-}')).toThrow(AppError);
	});

	test('throws AppError on unclosed brace', () => {
		expect(() => parseComponentId('{ban-:userId')).toThrow(AppError);
	});

	test('throws AppError when param appears at start with no prefix', () => {
		expect(() => parseComponentId('{:userId}')).toThrow(AppError);
	});

	test('throws AppError when prefix does not end with dash', () => {
		expect(() => parseComponentId('{banUser:id}')).toThrow(AppError);
	});

	test('parameterized regex matches expected strings and extracts groups', () => {
		const result = parseComponentId('{ban-:userId}');
		if (result.type !== 'parameterized') {
			throw new Error('Expected parameterized');
		}

		const match = result.regex.exec('ban-123456');
		expect(match).not.toBeNull();
		expect(match?.groups).toEqual({ userId: '123456' });
	});

	test('parameterized regex does not match strings missing segments', () => {
		const result = parseComponentId('{ticket-:action-:ticketId}');
		if (result.type !== 'parameterized') {
			throw new Error('Expected parameterized');
		}

		expect(result.regex.test('ticket-close')).toBe(false);
		expect(result.regex.test('ticket-')).toBe(false);
	});
});

// ─── defineComponent ─────────────────────────────────────────────

describe('defineComponent', () => {
	test('creates spark with exact string ID', () => {
		const spark = defineComponent({
			id: 'my-button',
			action: async () => {},
		});

		expect(spark.type).toBe('component');
		expect(spark.id).toBe('my-button');
		expect(spark.key).toBe('my-button');
		expect(spark.parsed.type).toBe('exact');
	});

	test('creates spark with parameterized ID', () => {
		const spark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});

		expect(spark.type).toBe('component');
		expect(spark.id).toBe('{ban-:userId}');
		expect(spark.key).toBe('ban-');
		expect(spark.parsed.type).toBe('parameterized');
		if (spark.parsed.type === 'parameterized') {
			expect(spark.parsed.params).toEqual(['userId']);
		}
	});

	test('defaults guards to empty array', () => {
		const spark = defineComponent({
			id: 'test',
			action: async () => {},
		});

		expect(spark.guards).toEqual([]);
	});

	test('preserves provided guards', () => {
		const mockGuard = (input: AnyComponentInteraction) => ({
			ok: true as const,
			value: input,
		});
		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [mockGuard],
			action: async () => {},
		});

		expect(spark.guards).toHaveLength(1);
	});
});

// ─── ComponentSpark.execute ──────────────────────────────────────

describe('ComponentSpark.execute', () => {
	test('executes action with empty params when exact match', async () => {
		const actionMock = mock(
			async (_i: AnyComponentInteraction, _p: Record<string, string>) => {},
		);
		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			action: actionMock,
		});

		const interaction = createMockComponentInteraction('test');

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(true);
		expect(actionMock).toHaveBeenCalledWith(interaction, {});
	});

	test('executes action with extracted params when parameterized', async () => {
		const actionMock = mock(
			async (_i: AnyComponentInteraction, _p: Record<string, string>) => {},
		);
		const spark = defineComponent<AnyComponentInteraction>({
			id: '{ban-:userId}',
			action: actionMock,
		});

		const interaction = createMockComponentInteraction('ban-123456');

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(true);
		expect(actionMock).toHaveBeenCalledWith(interaction, {
			userId: '123456',
		});
	});

	test('runs guards before action', async () => {
		const calls: string[] = [];

		const guard = (input: AnyComponentInteraction) => {
			calls.push('guard');
			return { ok: true as const, value: input };
		};

		// biome-ignore lint/suspicious/useAwait: async required to match action type signature
		const actionFn = async () => {
			calls.push('action');
		};
		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [guard],
			action: actionFn,
		});

		const interaction = createMockComponentInteraction('test');

		await spark.execute(interaction);

		expect(calls).toEqual(['guard', 'action']);
	});

	test('does not run action when guard fails', async () => {
		const actionMock = mock(async () => {});

		const failingGuard = () => ({
			ok: false as const,
			reason: 'Guard failed',
		});

		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [failingGuard],
			action: actionMock,
		});

		const interaction = createMockComponentInteraction('test');

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(false);
		expect(actionMock).not.toHaveBeenCalled();
	});

	test('returns guard failure reason', async () => {
		const failingGuard = () => ({
			ok: false as const,
			reason: 'Permission denied',
		});

		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [failingGuard],
			action: async () => {},
		});

		const interaction = createMockComponentInteraction('test');

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(false);
		expect((result as { ok: false; reason: string }).reason).toBe(
			'Permission denied',
		);
	});

	test('logs error when action throws', async () => {
		// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
		const throwingAction = async () => {
			throw new Error('Action error');
		};
		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			action: throwingAction,
		});

		const client = createMockClient();
		const interaction = createMockComponentInteraction('test', { client });

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('An internal error occurred.');
		}
		expect(client.logger.error).toHaveBeenCalled();
	});

	test('logs warning when parameterized regex fails to extract params', async () => {
		const spark = defineComponent<AnyComponentInteraction>({
			id: '{ban-:userId}',
			action: async () => {},
		});

		const client = createMockClient();
		// Create interaction with customId that won't match the regex
		// but simulate being routed to this spark anyway
		const interaction = createMockComponentInteraction('ban-', { client });

		await spark.execute(interaction);

		expect(client.logger.warn).toHaveBeenCalledWith(
			{ component: 'ban-', customId: 'ban-' },
			'Parameterized component matched but regex failed to extract params',
		);
	});

	test('logs info when guard fails', async () => {
		const failingGuard = () => ({
			ok: false as const,
			reason: 'Test failure',
		});

		const spark = defineComponent<AnyComponentInteraction>({
			id: 'test',
			guards: [failingGuard],
			action: async () => {},
		});

		const client = createMockClient();
		const interaction = createMockComponentInteraction('test', { client });

		await spark.execute(interaction);

		expect(client.logger.info).toHaveBeenCalledWith(
			{ context: 'component:test', reason: 'Test failure' },
			'Guard check failed',
		);
	});
});

// ─── ComponentSpark.register ─────────────────────────────────────

describe('ComponentSpark.register', () => {
	test('exact match stored in components Map by full ID', () => {
		const spark = defineComponent({
			id: 'register-test',
			action: async () => {},
		});

		const client = createMockClient();
		spark.register(client);

		expect(client.components.has('register-test')).toBe(true);
		expect(client.components.get('register-test')).toBe(spark);
	});

	test('parameterized stored in components Map by routeKey', () => {
		const spark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});

		const client = createMockClient();
		spark.register(client);

		expect(client.components.has('ban-')).toBe(true);
		expect(client.components.get('ban-')).toBe(spark);
	});

	test('throws AppError when exact id conflicts with existing exact', () => {
		const client = createMockClient();
		const spark1 = defineComponent({ id: 'confirm', action: async () => {} });
		const spark2 = defineComponent({ id: 'confirm', action: async () => {} });

		spark1.register(client);
		expect(() => spark2.register(client)).toThrow(AppError);
	});

	test('throws AppError when parameterized routeKey conflicts with existing', () => {
		const client = createMockClient();
		const spark1 = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});
		const spark2 = defineComponent({
			id: '{ban-:targetId}',
			action: async () => {},
		});

		spark1.register(client);
		expect(() => spark2.register(client)).toThrow(AppError);
	});

	test('throws AppError when parameterized routeKey collides with exact id', () => {
		const client = createMockClient();
		const exactSpark = defineComponent({
			id: 'ban-',
			action: async () => {},
		});
		const paramSpark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});

		exactSpark.register(client);
		expect(() => paramSpark.register(client)).toThrow(AppError);
	});

	test('throws AppError when exact id collides with existing parameterized routeKey', () => {
		const client = createMockClient();
		const paramSpark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});
		const exactSpark = defineComponent({
			id: 'ban-',
			action: async () => {},
		});

		paramSpark.register(client);
		expect(() => exactSpark.register(client)).toThrow(AppError);
	});

	test('includes conflict details in error metadata', () => {
		const client = createMockClient();
		const spark1 = defineComponent({ id: 'confirm', action: async () => {} });
		const spark2 = defineComponent({ id: 'confirm', action: async () => {} });

		spark1.register(client);
		try {
			spark2.register(client);
			expect.unreachable('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).message).toContain('confirm');
		}
	});

	test('logs registration with correct type', () => {
		const client = createMockClient();

		const exactSpark = defineComponent({
			id: 'exact-btn',
			action: async () => {},
		});
		exactSpark.register(client);

		expect(client.logger.debug).toHaveBeenCalledWith(
			{ component: 'exact-btn', type: 'exact' },
			'Registered component',
		);

		const paramSpark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});
		paramSpark.register(client);

		expect(client.logger.debug).toHaveBeenCalledWith(
			{ component: 'ban-', type: 'parameterized' },
			'Registered component',
		);
	});
});

// ─── findComponentSpark ──────────────────────────────────────────

describe('findComponentSpark', () => {
	test('finds spark by exact match', () => {
		const { components, find } = createLookupContext();
		const spark = defineComponent({
			id: 'exact-match',
			action: async () => {},
		});
		components.set('exact-match', asBase(spark));

		expect(find('exact-match')).toBe(spark);
	});

	test('returns undefined when no match found', () => {
		const { find } = createLookupContext();

		expect(find('nonexistent')).toBeUndefined();
	});

	test('prefers exact match over parameterized when both could match', () => {
		const { components, find } = createLookupContext();

		const exactSpark = defineComponent({
			id: 'ban-123',
			action: async () => {},
		});
		const paramSpark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});

		components.set('ban-123', asBase(exactSpark));
		components.set('ban-', asBase(paramSpark));

		expect(find('ban-123')).toBe(exactSpark);
	});

	test('finds parameterized spark by prefix walk', () => {
		const { components, find } = createLookupContext();

		const spark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});
		components.set('ban-', asBase(spark));

		expect(find('ban-123456789012345678')).toBe(spark);
	});

	test('finds multi-segment parameterized spark', () => {
		const { components, find } = createLookupContext();

		const spark = defineComponent({
			id: '{ticket-close-:id}',
			action: async () => {},
		});
		components.set('ticket-close-', asBase(spark));

		expect(find('ticket-close-789')).toBe(spark);
	});

	test('does not match when regex does not match (wrong segment count)', () => {
		const { components, find } = createLookupContext();

		const spark = defineComponent({
			id: '{ticket-:action-:ticketId}',
			action: async () => {},
		});
		components.set('ticket-', asBase(spark));

		// Only one segment after 'ticket-', but pattern expects two
		expect(find('ticket-close')).toBeUndefined();
	});

	test('handles empty components map', () => {
		const { find } = createLookupContext();

		expect(find('anything')).toBeUndefined();
	});

	test('does not match parameterized when customId has no dashes', () => {
		const { components, find } = createLookupContext();

		const spark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});
		components.set('ban-', asBase(spark));

		expect(find('ban123456789')).toBeUndefined();
	});

	test('returns parameterized spark from exact lookup when customId equals map key', () => {
		const { components, find } = createLookupContext();

		const spark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});
		// Manually store under a customId that the regex will match
		components.set('ban-999', asBase(spark));

		expect(find('ban-999')).toBe(spark);
	});

	test('skips parameterized candidate from exact lookup when regex does not match', () => {
		const { components, find } = createLookupContext();

		const spark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});
		// Store under a key that won't match the regex (has extra dash segment)
		components.set('ban-1-2', asBase(spark));

		expect(find('ban-1-2')).toBeUndefined();
	});

	test('logs debug when parameterized match is found and logger provided', () => {
		const components = new Map<string, BaseComponentSpark>();
		const logger = createMockClient().logger;

		const spark = defineComponent({
			id: '{ban-:userId}',
			action: async () => {},
		});
		components.set('ban-', asBase(spark));

		findComponentSpark(components, 'ban-123456', logger);

		expect(logger.debug).toHaveBeenCalledWith(
			{ component: 'ban-', customId: 'ban-123456' },
			'Component matched via parameterized routing',
		);
	});
});

// ─── Edge Cases ──────────────────────────────────────────────────

describe('edge cases', () => {
	test('handles Unicode in customId', () => {
		const spark = defineComponent({
			id: 'button-\u2713-confirm',
			action: async () => {},
		});

		expect(spark.parsed.type).toBe('exact');
		expect(spark.key).toBe('button-\u2713-confirm');
	});

	test('handles very long customId (100 chars)', () => {
		const longId = 'a'.repeat(100);
		const spark = defineComponent({
			id: longId,
			action: async () => {},
		});

		expect(spark.parsed.type).toBe('exact');
		expect(spark.key).toBe(longId);
	});

	test('calling parseComponentId twice resets global regex state', () => {
		const r1 = parseComponentId('{a-:x}');
		const r2 = parseComponentId('{b-:y}');

		expect(r1.type).toBe('parameterized');
		expect(r2.type).toBe('parameterized');
		if (r1.type === 'parameterized' && r2.type === 'parameterized') {
			expect(r1.params).toEqual(['x']);
			expect(r2.params).toEqual(['y']);
		}
	});

	test('parameterized regex escapes special regex characters in static prefix', () => {
		const result = parseComponentId('{action.type-:id}');

		expect(result.type).toBe('parameterized');
		if (result.type === 'parameterized') {
			// The dot should be escaped, not a wildcard
			expect(result.regex.test('action.type-123')).toBe(true);
			expect(result.regex.test('actionXtype-123')).toBe(false);
		}
	});

	test('handles special characters like : in exact IDs (no braces = exact)', () => {
		const spark = defineComponent({
			id: 'button:action:123',
			action: async () => {},
		});

		expect(spark.parsed.type).toBe('exact');
		expect(spark.key).toBe('button:action:123');
	});
});

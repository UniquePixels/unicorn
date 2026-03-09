import { describe, expect, mock, test } from 'bun:test';
import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	Client,
	CommandInteraction,
} from 'discord.js';
import { AppError } from '@/core/lib/logger';
import {
	assertDefined,
	createMockClient,
	createMockCommand,
} from '@/core/lib/test-helpers';
import { hasAutocomplete } from './command';
import { defineCommandGroup } from './command-group';

/** Build mock getSubcommand/getSubcommandGroup options. */
function createMockSubcommandOptions(
	subcommand: string | null,
	group: string | null,
) {
	return {
		getSubcommand: mock((required?: boolean) => {
			if (subcommand === null && required !== false) {
				throw new Error('No subcommand');
			}
			return subcommand;
		}),
		getSubcommandGroup: mock((required?: boolean) => {
			if (group === null && required !== false) {
				throw new Error('No subcommand group');
			}
			return group;
		}),
	};
}

function createMockInteraction(
	subcommand: string | null,
	group: string | null = null,
	mockClient?: Client,
): ChatInputCommandInteraction {
	return {
		commandName: 'test',
		options: createMockSubcommandOptions(subcommand, group),
		user: { id: '123456789012345678' },
		replied: false,
		deferred: false,
		reply: mock(async () => {}),
		isChatInputCommand: () => true,
		client: mockClient ?? createMockClient(),
	} as unknown as ChatInputCommandInteraction;
}

function createMockAutocompleteInteraction(
	subcommand: string | null,
	group: string | null = null,
	mockClient?: Client,
): AutocompleteInteraction {
	return {
		commandName: 'test',
		options: {
			...createMockSubcommandOptions(subcommand, group),
			getFocused: mock(() => ''),
		},
		respond: mock(async () => {}),
		client: mockClient ?? createMockClient(),
	} as unknown as AutocompleteInteraction;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('defineCommandGroup', () => {
	test('creates spark with correct type and id', () => {
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: async () => {} },
			},
		});

		expect(spark.type).toBe('command');
		expect(spark.id).toBe('manage');
	});

	test('stores the command builder', () => {
		const builder = createMockCommand('manage');
		const spark = defineCommandGroup({
			command: builder,
			subcommands: {
				list: { action: async () => {} },
			},
		});

		expect(spark.command).toBe(builder);
	});

	test('defaults guards to empty array', () => {
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: async () => {} },
			},
		});

		expect(spark.guards).toEqual([]);
	});

	test('preserves provided guards', () => {
		const guard = (input: ChatInputCommandInteraction) => ({
			ok: true as const,
			value: input,
		});

		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			guards: [guard],
			subcommands: {
				list: { action: async () => {} },
			},
		});

		expect(spark.guards).toHaveLength(1);
	});
});

describe('CommandGroupSpark.execute', () => {
	describe('subcommand routing', () => {
		test('routes to the correct subcommand', async () => {
			const listAction = mock(async () => {});
			const addAction = mock(async () => {});

			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					list: { action: listAction },
					add: { action: addAction },
				},
			});

			const interaction = createMockInteraction('list');

			await spark.execute(interaction);

			expect(listAction).toHaveBeenCalledWith(interaction);
			expect(addAction).not.toHaveBeenCalled();
		});

		test('routes to the correct group + subcommand', async () => {
			const addAction = mock(async () => {});
			const removeAction = mock(async () => {});

			const spark = defineCommandGroup({
				command: createMockCommand('settings'),
				groups: {
					roles: {
						add: { action: addAction },
						remove: { action: removeAction },
					},
				},
			});

			const interaction = createMockInteraction('add', 'roles');

			await spark.execute(interaction);

			expect(addAction).toHaveBeenCalledWith(interaction);
			expect(removeAction).not.toHaveBeenCalled();
		});

		test('prefers group handler when group is present', async () => {
			const directAdd = mock(async () => {});
			const groupedAdd = mock(async () => {});

			const spark = defineCommandGroup({
				command: createMockCommand('cmd'),
				subcommands: {
					add: { action: directAdd },
				},
				groups: {
					items: {
						add: { action: groupedAdd },
					},
				},
			});

			const interaction = createMockInteraction('add', 'items');

			await spark.execute(interaction);

			expect(groupedAdd).toHaveBeenCalled();
			expect(directAdd).not.toHaveBeenCalled();
		});

		test('returns failure when subcommand has no handler', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					list: { action: async () => {} },
				},
			});

			const interaction = createMockInteraction('unknown');

			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('This subcommand is not available.');
			}
		});

		test('returns failure when group has no handler for subcommand', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('settings'),
				groups: {
					roles: {
						add: { action: async () => {} },
					},
				},
			});

			const interaction = createMockInteraction('delete', 'roles');

			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
		});

		test('returns failure when group itself does not exist', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('settings'),
				groups: {
					roles: {
						add: { action: async () => {} },
					},
				},
			});

			const interaction = createMockInteraction('add', 'channels');

			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
		});

		test('warns when no handler matches', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					list: { action: async () => {} },
				},
			});

			const client = createMockClient();
			const interaction = createMockInteraction('missing', null, client);

			await spark.execute(interaction);

			expect(client.logger.warn).toHaveBeenCalledWith(
				{
					command: 'manage',
					subcommand: 'missing',
					group: null,
				},
				'No handler for subcommand',
			);
		});
	});

	describe('top-level guards', () => {
		test('runs top-level guards before subcommand action', async () => {
			const calls: string[] = [];

			const guard = (input: ChatInputCommandInteraction) => {
				calls.push('guard');
				return { ok: true as const, value: input };
			};

			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				guards: [guard],
				subcommands: {
					list: {
						action: () => {
							calls.push('action');
						},
					},
				},
			});

			const interaction = createMockInteraction('list');

			await spark.execute(interaction);

			expect(calls).toEqual(['guard', 'action']);
		});

		test('does not execute subcommand when top-level guard fails', async () => {
			const actionMock = mock(async () => {});

			const failingGuard = () => ({
				ok: false as const,
				reason: 'Not in guild',
			});

			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				guards: [failingGuard],
				subcommands: {
					list: { action: actionMock },
				},
			});

			const interaction = createMockInteraction('list');

			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Not in guild');
			}
			expect(actionMock).not.toHaveBeenCalled();
		});

		test('logs info when top-level guard fails', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				guards: [() => ({ ok: false as const, reason: 'Test failure' })],
				subcommands: {
					list: { action: async () => {} },
				},
			});

			const client = createMockClient();
			const interaction = createMockInteraction('list', null, client);

			await spark.execute(interaction);

			expect(client.logger.info).toHaveBeenCalledWith(
				{ context: 'command:manage', reason: 'Test failure' },
				'Guard check failed',
			);
		});
	});

	describe('subcommand guards', () => {
		test('runs subcommand guards after top-level guards', async () => {
			const calls: string[] = [];

			const topGuard = (input: ChatInputCommandInteraction) => {
				calls.push('top-guard');
				return { ok: true as const, value: input };
			};

			const subGuard = (input: ChatInputCommandInteraction) => {
				calls.push('sub-guard');
				return { ok: true as const, value: input };
			};

			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				guards: [topGuard],
				subcommands: {
					add: {
						guards: [subGuard],
						action: () => {
							calls.push('action');
						},
					},
				},
			});

			const interaction = createMockInteraction('add');

			await spark.execute(interaction);

			expect(calls).toEqual(['top-guard', 'sub-guard', 'action']);
		});

		test('does not execute action when subcommand guard fails', async () => {
			const actionMock = mock(async () => {});

			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					add: {
						guards: [
							() => ({
								ok: false as const,
								reason: 'Missing permissions',
							}),
						],
						action: actionMock,
					},
				},
			});

			const interaction = createMockInteraction('add');

			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe('Missing permissions');
			}
			expect(actionMock).not.toHaveBeenCalled();
		});

		test('logs info when subcommand guard fails', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					add: {
						guards: [
							() => ({
								ok: false as const,
								reason: 'No perms',
							}),
						],
						action: async () => {},
					},
				},
			});

			const client = createMockClient();
			const interaction = createMockInteraction('add', null, client);

			await spark.execute(interaction);

			expect(client.logger.info).toHaveBeenCalledWith(
				{ context: 'command:manage add', reason: 'No perms' },
				'Guard check failed',
			);
		});

		test('skips subcommand guard step when no guards defined', async () => {
			const actionMock = mock(async () => {});

			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					list: { action: actionMock },
				},
			});

			const interaction = createMockInteraction('list');

			const result = await spark.execute(interaction);

			expect(result.ok).toBe(true);
			expect(actionMock).toHaveBeenCalled();
		});
	});

	describe('guard exception handling', () => {
		test('logs error when top-level guard throws an exception', async () => {
			const throwingGuard = () => {
				throw new Error('Guard exploded');
			};
			const actionMock = mock(async () => {});

			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				guards: [throwingGuard],
				subcommands: {
					list: { action: actionMock },
				},
			});

			const client = createMockClient();
			const interaction = createMockInteraction('list', null, client);

			const result = await spark.execute(interaction);

			expect(result.ok).toBe(false);
			expect(actionMock).not.toHaveBeenCalled();
			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ context: 'command:manage' }),
				'Guard exception',
			);
		});
	});

	describe('error handling', () => {
		test('logs error when subcommand action throws', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					add: {
						action:
							// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
							async () => {
								throw new Error('DB connection failed');
							},
					},
				},
			});

			const client = createMockClient();
			const interaction = createMockInteraction('add', null, client);

			const result = await spark.execute(interaction);

			// Guards passed so result is ok — error is logged, not thrown
			expect(result.ok).toBe(true);
			expect(client.logger.error).toHaveBeenCalled();
		});

		test('includes route key in error log for direct subcommand', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					add: {
						action:
							// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
							async () => {
								throw new Error('fail');
							},
					},
				},
			});

			const client = createMockClient();
			const interaction = createMockInteraction('add', null, client);

			await spark.execute(interaction);

			expect(client.logger.error).toHaveBeenCalledTimes(1);
			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ command: 'manage add' }),
				expect.any(String),
			);
		});

		test('includes route key in error log for grouped subcommand', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('settings'),
				groups: {
					roles: {
						add: {
							action:
								// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
								async () => {
									throw new Error('fail');
								},
						},
					},
				},
			});

			const client = createMockClient();
			const interaction = createMockInteraction('add', 'roles', client);

			await spark.execute(interaction);

			expect(client.logger.error).toHaveBeenCalledTimes(1);
			expect(client.logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ command: 'settings roles add' }),
				expect.any(String),
			);
		});
	});
});

describe('CommandGroupSpark.register', () => {
	test('adds spark to client.commands collection', () => {
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: async () => {} },
			},
		});

		const client = createMockClient();
		spark.register(client);

		expect(client.commands.has('manage')).toBe(true);
		expect(client.commands.get('manage')).toBe(spark);
	});

	test('skips duplicate command group and logs error', () => {
		const spark1 = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: async () => {} },
			},
		});
		const spark2 = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				add: { action: async () => {} },
			},
		});

		const client = createMockClient();
		spark1.register(client);
		spark2.register(client);

		expect(client.commands.get('manage')).toBe(spark1);
		expect(client.logger.error).toHaveBeenCalledWith(
			{ command: 'manage', existingId: 'manage' },
			'Command name collision — skipping duplicate',
		);
	});

	test('logs debug with subcommand and group info', () => {
		const spark = defineCommandGroup({
			command: createMockCommand('settings'),
			subcommands: {
				view: { action: async () => {} },
			},
			groups: {
				roles: {
					add: { action: async () => {} },
				},
			},
		});

		const client = createMockClient();
		spark.register(client);

		expect(client.logger.debug).toHaveBeenCalledWith(
			{
				command: 'settings',
				subcommands: ['view'],
				groups: ['roles'],
			},
			'Registered command group',
		);
	});
});

describe('CommandGroupSpark autocomplete', () => {
	test('hasAutocomplete returns true when a subcommand has autocomplete', () => {
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				search: {
					autocomplete: async () => {},
					action: async () => {},
				},
				list: { action: async () => {} },
			},
		});

		expect(hasAutocomplete(spark)).toBe(true);
	});

	test('hasAutocomplete returns false when no subcommand has autocomplete', () => {
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: async () => {} },
			},
		});

		expect(hasAutocomplete(spark)).toBe(false);
	});

	test('hasAutocomplete returns true when grouped subcommand has autocomplete', () => {
		const spark = defineCommandGroup({
			command: createMockCommand('settings'),
			groups: {
				roles: {
					add: {
						autocomplete: async () => {},
						action: async () => {},
					},
				},
			},
		});

		expect(hasAutocomplete(spark)).toBe(true);
	});

	test('autocomplete property routes to correct subcommand handler', async () => {
		const searchAC = mock(async () => {});

		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				search: {
					autocomplete: searchAC,
					action: async () => {},
				},
				list: { action: async () => {} },
			},
		});

		const interaction = createMockAutocompleteInteraction('search');

		// Call the autocomplete property directly (not executeAutocomplete)
		assertDefined(spark.autocomplete);
		await spark.autocomplete(interaction);

		expect(searchAC).toHaveBeenCalledWith(interaction);
	});

	test('autocomplete property routes to correct grouped subcommand', async () => {
		const addAC = mock(async () => {});

		const spark = defineCommandGroup({
			command: createMockCommand('settings'),
			groups: {
				roles: {
					add: {
						autocomplete: addAC,
						action: async () => {},
					},
				},
			},
		});

		const interaction = createMockAutocompleteInteraction('add', 'roles');

		assertDefined(spark.autocomplete);
		await spark.autocomplete(interaction);

		expect(addAC).toHaveBeenCalledWith(interaction);
	});

	test('autocomplete property is a no-op when subcommand has no autocomplete', async () => {
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				search: {
					autocomplete: async () => {},
					action: async () => {},
				},
				list: { action: async () => {} },
			},
		});

		const interaction = createMockAutocompleteInteraction('list');

		// Should not throw — handler has no autocomplete so it's skipped
		assertDefined(spark.autocomplete);
		await spark.autocomplete(interaction);
	});

	describe('executeAutocomplete', () => {
		test('routes autocomplete to the correct subcommand handler', async () => {
			const searchAC = mock(async () => {});

			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					search: {
						autocomplete: searchAC,
						action: async () => {},
					},
					list: { action: async () => {} },
				},
			});

			const interaction = createMockAutocompleteInteraction('search');

			assertDefined(spark.executeAutocomplete);
			await spark.executeAutocomplete(interaction);

			expect(searchAC).toHaveBeenCalledWith(interaction);
		});

		test('routes autocomplete to the correct grouped subcommand', async () => {
			const addAC = mock(async () => {});

			const spark = defineCommandGroup({
				command: createMockCommand('settings'),
				groups: {
					roles: {
						add: {
							autocomplete: addAC,
							action: async () => {},
						},
					},
				},
			});

			const interaction = createMockAutocompleteInteraction('add', 'roles');

			assertDefined(spark.executeAutocomplete);
			await spark.executeAutocomplete(interaction);

			expect(addAC).toHaveBeenCalledWith(interaction);
		});

		test('handles subcommand without autocomplete gracefully', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					search: {
						autocomplete: async () => {},
						action: async () => {},
					},
					list: { action: async () => {} },
				},
			});

			const client = createMockClient();
			const interaction = createMockAutocompleteInteraction(
				'list',
				null,
				client,
			);

			// Should not throw
			assertDefined(spark.executeAutocomplete);
			await spark.executeAutocomplete(interaction);

			expect(client.logger.debug).toHaveBeenCalledWith(
				{ command: 'manage', subcommand: 'list', group: null },
				'No autocomplete handler for subcommand',
			);
		});

		test('logs warning when autocomplete handler throws', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					search: {
						autocomplete:
							// biome-ignore lint/suspicious/useAwait: async required to test Promise rejection path
							async () => {
								throw new Error('API timeout');
							},
						action: async () => {},
					},
				},
			});

			const client = createMockClient();
			const interaction = createMockAutocompleteInteraction(
				'search',
				null,
				client,
			);

			assertDefined(spark.executeAutocomplete);
			await spark.executeAutocomplete(interaction);

			expect(client.logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({
					command: 'manage',
					subcommand: 'search',
				}),
				'Subcommand autocomplete failed',
			);
		});

		test('handles unknown subcommand in autocomplete gracefully', async () => {
			const spark = defineCommandGroup({
				command: createMockCommand('manage'),
				subcommands: {
					search: {
						autocomplete: async () => {},
						action: async () => {},
					},
				},
			});

			const interaction = createMockAutocompleteInteraction('nonexistent');

			// Should not throw
			assertDefined(spark.executeAutocomplete);
			await spark.executeAutocomplete(interaction);
		});
	});
});

describe('runtime type guard', () => {
	test('rejects non-ChatInput interactions', async () => {
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: async () => {} },
			},
		});

		const interaction = {
			commandName: 'manage',
			user: { id: '123456789012345678' },
			replied: false,
			deferred: false,
			reply: mock(async () => {}),
			isChatInputCommand: () => false,
			client: createMockClient(),
		} as unknown as CommandInteraction;

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('Command groups only support slash commands.');
		}
	});
});

describe('edge cases', () => {
	test('throws AppError when no subcommands or groups are provided', () => {
		expect.assertions(4);

		try {
			defineCommandGroup({ command: createMockCommand('empty') });
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			const appErr = error as AppError;
			expect(appErr.code).toBe('ERR_COMMAND_GROUP_EMPTY');
			expect(appErr.isOperational).toBe(false);
			expect(appErr.metadata['command']).toBe('empty');
		}
	});

	test('returns failure when both subcommand and group are null', async () => {
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: async () => {} },
			},
		});

		const interaction = createMockInteraction(null, null);

		const result = await spark.execute(interaction);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('This subcommand is not available.');
		}
	});

	test('multiple subcommands each get correct calls', async () => {
		const actions = {
			a: mock(async () => {}),
			b: mock(async () => {}),
			c: mock(async () => {}),
		};

		const spark = defineCommandGroup({
			command: createMockCommand('multi'),
			subcommands: {
				a: { action: actions.a },
				b: { action: actions.b },
				c: { action: actions.c },
			},
		});

		await spark.execute(createMockInteraction('b'));

		expect(actions.a).not.toHaveBeenCalled();
		expect(actions.b).toHaveBeenCalledTimes(1);
		expect(actions.c).not.toHaveBeenCalled();

		await spark.execute(createMockInteraction('a'));

		expect(actions.a).toHaveBeenCalledTimes(1);
		expect(actions.b).toHaveBeenCalledTimes(1);
		expect(actions.c).not.toHaveBeenCalled();
	});

	test('mixed subcommands and groups route independently', async () => {
		const directList = mock(async () => {});
		const groupedAdd = mock(async () => {});

		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: directList },
			},
			groups: {
				items: {
					add: { action: groupedAdd },
				},
			},
		});

		await spark.execute(createMockInteraction('list'));
		expect(directList).toHaveBeenCalled();
		expect(groupedAdd).not.toHaveBeenCalled();

		await spark.execute(createMockInteraction('add', 'items'));
		expect(groupedAdd).toHaveBeenCalled();
	});

	test('spark.action is a noop (routing handled by execute)', () => {
		const listAction = mock(async () => {});
		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			subcommands: {
				list: { action: listAction },
			},
		});

		// action exists for interface compliance but does nothing
		expect(() => spark.action({} as ChatInputCommandInteraction)).not.toThrow();

		expect(listAction).not.toHaveBeenCalled();
	});

	test('async guards work correctly', async () => {
		const asyncGuard = async (input: ChatInputCommandInteraction) => {
			await Promise.resolve();
			return { ok: true as const, value: input };
		};

		const actionMock = mock(async () => {});

		const spark = defineCommandGroup({
			command: createMockCommand('manage'),
			guards: [asyncGuard],
			subcommands: {
				list: { action: actionMock },
			},
		});

		const interaction = createMockInteraction('list');

		await spark.execute(interaction);

		expect(actionMock).toHaveBeenCalled();
	});
});

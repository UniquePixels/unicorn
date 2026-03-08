import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@/core/lib/logger';
import { createMockClient } from '@/core/lib/test-helpers';
import { loadSparks } from './loader';

describe('loadSparks', () => {
	const testDir = join(import.meta.dir, '__test_sparks__');

	beforeEach(() => {
		// Create test directory
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directory
		rmSync(testDir, { recursive: true, force: true });
	});

	test('registers the built-in interaction router automatically', async () => {
		const client = createMockClient();

		await loadSparks(client, testDir);

		// The interaction router registers an InteractionCreate listener
		expect(client.logger.debug).toHaveBeenCalledWith(
			'Registered built-in interaction router',
		);
	});

	// Detection is based on the spark's declarative `event` field, not the imperative register() call.
	test('warns when user spark duplicates InteractionCreate listener', async () => {
		const client = createMockClient();

		const duplicateCode = `
			export const myRouter = {
				type: 'gateway-event',
				event: 'interactionCreate',
				once: false,
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.on('interactionCreate', () => {}),
			};
		`;
		writeFileSync(join(testDir, 'duplicate-router.ts'), duplicateCode);

		await loadSparks(client, testDir);

		expect(client.logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ export: 'myRouter' }),
			'User spark registers an InteractionCreate listener — the framework already handles interaction routing automatically',
		);
	});

	test('loads command sparks from directory', async () => {
		const client = createMockClient();

		// Create a valid command spark file
		const sparkCode = `
			import { SlashCommandBuilder } from 'discord.js';
			export const testCommand = {
				type: 'command',
				id: 'test',
				command: new SlashCommandBuilder().setName('test').setDescription('Test'),
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.commands.set('test', testCommand),
			};
		`;
		writeFileSync(join(testDir, 'test-command.ts'), sparkCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(1);
		expect(result.commands).toBe(1);
	});

	test('handles empty directory gracefully', async () => {
		const client = createMockClient();

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(0);
		expect(result.commands).toBe(0);
		expect(result.components).toBe(0);
		expect(result.events).toBe(0);
		expect(result.scheduled).toBe(0);
	});

	test('ignores files without sparks (misc functions)', async () => {
		const client = createMockClient();

		// Create a file with misc utility functions, no sparks
		const utilsCode = `
			export function add(a: number, b: number): number {
				return a + b;
			}

			export function multiply(a: number, b: number): number {
				return a * b;
			}

			export const PI = 3.14159;
		`;
		writeFileSync(join(testDir, 'utils.ts'), utilsCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(0);
	});

	test('ignores files with only type exports', async () => {
		const client = createMockClient();

		// Create a file with only type definitions
		const typesCode = `
			export type UserId = string;
			export interface UserData {
				id: UserId;
				name: string;
			}
			export const enum Status {
				Active = 'active',
				Inactive = 'inactive',
			}
		`;
		writeFileSync(join(testDir, 'types.ts'), typesCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(0);
	});

	test('ignores files with non-spark objects that have type property', async () => {
		const client = createMockClient();

		// Create a file with objects that have 'type' but aren't valid sparks
		const mixedCode = `
			export const config = {
				type: 'config',
				value: 42,
			};

			export const event = {
				type: 'custom-event',
				handler: () => {},
			};

			export const invalidSpark = {
				type: 'command',
				// Missing 'register' function
				name: 'invalid',
			};
		`;
		writeFileSync(join(testDir, 'not-sparks.ts'), mixedCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(0);
	});

	test('ignores test files by default', async () => {
		const client = createMockClient();

		// Create a test file
		const testCode = `
			import { describe, test, expect } from 'bun:test';
			describe('test', () => {
				test('should pass', () => {
					expect(true).toBe(true);
				});
			});
		`;
		writeFileSync(join(testDir, 'some.test.ts'), testCode);

		// Also create a spec file
		writeFileSync(join(testDir, 'another.spec.ts'), testCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(0);
	});

	test('ignores __tests__ directories by default', async () => {
		const client = createMockClient();

		// Create __tests__ subdirectory
		const testsDir = join(testDir, '__tests__');
		mkdirSync(testsDir, { recursive: true });

		// Create a file inside __tests__
		const testCode = `export const test = { type: 'command' };`;
		writeFileSync(join(testsDir, 'unit.ts'), testCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(0);
	});

	test('handles files with syntax errors gracefully', async () => {
		const client = createMockClient();

		// Create a file with intentional syntax error
		const badCode = `
			export const broken = {
				this is not valid javascript
			};
		`;
		writeFileSync(join(testDir, 'broken.ts'), badCode);

		// Should throw with context about which file failed
		await expect(loadSparks(client, testDir)).rejects.toThrow(
			/Failed to load spark from.*broken\.ts/,
		);
	});

	test('handles files with runtime errors during import', async () => {
		const client = createMockClient();

		// Create a file that throws during import
		const throwingCode = `
			throw new Error('Import-time error');
			export const spark = { type: 'command' };
		`;
		writeFileSync(join(testDir, 'throwing.ts'), throwingCode);

		let caughtError: unknown;
		try {
			await loadSparks(client, testDir);
			expect.unreachable('Expected loadSparks to throw');
		} catch (error) {
			caughtError = error;
		}

		expect(caughtError).toBeInstanceOf(AppError);
		const appErr = caughtError as AppError;
		expect(appErr.message).toMatch(/Failed to load spark.*throwing\.ts/);
		expect(appErr.code).toBe('ERR_SPARK_LOAD');
		expect(appErr.isOperational).toBe(false);
		expect(appErr.cause).toBeInstanceOf(Error);
	});

	test('processes nested directories recursively', async () => {
		const client = createMockClient();

		// Create nested structure
		const subDir = join(testDir, 'commands', 'admin');
		mkdirSync(subDir, { recursive: true });

		// Create a valid spark in nested directory
		const sparkCode = `
			import { SlashCommandBuilder } from 'discord.js';
			export const nestedCommand = {
				type: 'command',
				id: 'nested',
				command: new SlashCommandBuilder().setName('nested').setDescription('Nested'),
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.commands.set('nested', nestedCommand),
			};
		`;
		writeFileSync(join(subDir, 'admin-command.ts'), sparkCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(1);
		expect(result.commands).toBe(1);
	});

	test('loads multiple sparks from single file', async () => {
		const client = createMockClient();

		// Create a file with multiple spark exports
		const multiSparkCode = `
			import { SlashCommandBuilder } from 'discord.js';

			export const command1 = {
				type: 'command',
				id: 'cmd1',
				command: new SlashCommandBuilder().setName('cmd1').setDescription('First'),
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.commands.set('cmd1', command1),
			};

			export const command2 = {
				type: 'command',
				id: 'cmd2',
				command: new SlashCommandBuilder().setName('cmd2').setDescription('Second'),
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.commands.set('cmd2', command2),
			};
		`;
		writeFileSync(join(testDir, 'multi-commands.ts'), multiSparkCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(2);
		expect(result.commands).toBe(2);
	});

	test('handles mixed file with sparks and non-sparks', async () => {
		const client = createMockClient();

		// Create a file with both sparks and utility functions
		const mixedCode = `
			import { SlashCommandBuilder } from 'discord.js';

			// Utility function - should be ignored
			export function formatDate(date: Date): string {
				return date.toISOString();
			}

			// Valid spark
			export const helpCommand = {
				type: 'command',
				id: 'help',
				command: new SlashCommandBuilder().setName('help').setDescription('Help'),
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.commands.set('help', helpCommand),
			};

			// Another utility
			export const CONSTANTS = { MAX_RETRIES: 3 };
		`;
		writeFileSync(join(testDir, 'mixed.ts'), mixedCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(1);
		expect(result.commands).toBe(1);
	});

	test('ignores files with no runtime exports', async () => {
		const client = createMockClient();

		writeFileSync(join(testDir, 'empty.ts'), '');
		writeFileSync(
			join(testDir, 'comments-only.ts'),
			'// This file is intentionally empty\n/* block comment */',
		);
		writeFileSync(
			join(testDir, 'default-only.ts'),
			`const helper = { name: 'helper' };\nexport default helper;`,
		);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(0);
	});

	test('respects custom extensions option', async () => {
		const client = createMockClient();

		// Create .js file
		const jsCode = `
			export const jsExport = { type: 'not-a-spark' };
		`;
		writeFileSync(join(testDir, 'file.js'), jsCode);

		// Create .mjs file (not in default extensions)
		const mjsCode = `
			export const mjsExport = { type: 'not-a-spark' };
		`;
		writeFileSync(join(testDir, 'file.mjs'), mjsCode);

		// Load with custom extensions - only .js, not .mjs
		const result = await loadSparks(client, testDir, {
			extensions: ['.js'],
		});

		// The .js file will be loaded but has no sparks
		// The .mjs file should be completely ignored
		expect(result.total).toBe(0);
	});

	test('respects custom exclude patterns', async () => {
		const client = createMockClient();

		// Create a file that matches custom exclude pattern
		const excludeCode = `
			import { SlashCommandBuilder } from 'discord.js';
			export const ignoredCommand = {
				type: 'command',
				id: 'ignored',
				command: new SlashCommandBuilder().setName('ignored').setDescription('Ignored'),
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.commands.set('ignored', ignoredCommand),
			};
		`;
		writeFileSync(join(testDir, 'example.generated.ts'), excludeCode);

		const result = await loadSparks(client, testDir, {
			exclude: [/\.generated\.[tj]s$/],
		});

		expect(result.total).toBe(0);
	});

	test('throws descriptive error for files with circular imports that cause TDZ errors', async () => {
		const client = createMockClient();

		// Create two files that import each other (causes TDZ violation)
		const fileACode = `
			import { b } from './file-b';
			export const a = { name: 'a', ref: b };
		`;
		const fileBCode = `
			import { a } from './file-a';
			export const b = { name: 'b', ref: a };
		`;
		writeFileSync(join(testDir, 'file-a.ts'), fileACode);
		writeFileSync(join(testDir, 'file-b.ts'), fileBCode);

		// Circular imports that cause TDZ violations will throw with context
		await expect(loadSparks(client, testDir)).rejects.toThrow(
			/Failed to load spark from/,
		);
	});

	test('loads all spark types correctly', async () => {
		const client = createMockClient();

		// Create files for each spark type
		const commandCode = `
			import { SlashCommandBuilder } from 'discord.js';
			export const cmd = {
				type: 'command',
				id: 'cmd',
				command: new SlashCommandBuilder().setName('cmd').setDescription('Cmd'),
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.commands.set('cmd', cmd),
			};
		`;

		const componentCode = `
			export const btn = {
				type: 'component',
				id: 'btn',
				key: 'btn',
				guards: [],
				action: async () => {},
				matches: () => true,
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.components.set('btn', btn),
			};
		`;

		const eventCode = `
			export const evt = {
				type: 'gateway-event',
				event: 'messageCreate',
				once: false,
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				register: (client) => client.on('messageCreate', () => {}),
			};
		`;

		const scheduledCode = `
			export const sched = {
				type: 'scheduled-event',
				id: 'sched',
				schedule: '* * * * *',
				timezone: 'UTC',
				guards: [],
				action: async () => {},
				execute: async () => ({ ok: true, value: {} }),
				stop: () => {},
				register: (client) => {},
			};
		`;

		writeFileSync(join(testDir, 'command.ts'), commandCode);
		writeFileSync(join(testDir, 'component.ts'), componentCode);
		writeFileSync(join(testDir, 'event.ts'), eventCode);
		writeFileSync(join(testDir, 'scheduled.ts'), scheduledCode);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(4);
		expect(result.commands).toBe(1);
		expect(result.components).toBe(1);
		expect(result.events).toBe(1);
		expect(result.scheduled).toBe(1);
	});

	test('ignores files with non-spark exports', async () => {
		const client = createMockClient();

		const code = `
			export const nullValue = null;
			export const undefinedValue = undefined;
			export const emptyObject = {};
			export const stringVal = 'hello';
			export const numberVal = 42;
			export const boolVal = true;
			export function regularFunction() {}
			export const arrowFunction = () => {};
			export const emptyArray = [];
			export const objectArray = [{ type: 'command' }];
		`;
		writeFileSync(join(testDir, 'non-sparks.ts'), code);

		const result = await loadSparks(client, testDir);

		expect(result.total).toBe(0);
	});
});

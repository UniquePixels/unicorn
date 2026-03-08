import { relative } from 'node:path';
import process from 'node:process';
import type { Client } from 'discord.js';
import type { SparkType } from '@/core/guards';
import { AppError } from '@/core/lib/logger';
import type { CommandSpark } from './command';
import type { ComponentSpark } from './component';
import type { GatewayEventSpark } from './gateway-event';
import { interactionRouter } from './interaction-router';
import type { ScheduledEventSpark } from './scheduled-event';

/**
 * All spark types.
 */
export type AnySpark =
	| CommandSpark
	| ComponentSpark
	| GatewayEventSpark
	| ScheduledEventSpark;

/**
 * Result of loading sparks from a directory.
 */
export interface LoadSparksResult {
	/** Total number of sparks loaded */
	total: number;
	/** Number of command sparks loaded */
	commands: number;
	/** Number of component sparks loaded */
	components: number;
	/** Number of gateway event sparks loaded */
	events: number;
	/** Number of scheduled sparks loaded */
	scheduled: number;
}

/**
 * Options for the spark loader.
 */
export interface LoadSparksOptions {
	/** File extensions to consider as spark files */
	extensions?: string[];
	/** Patterns to exclude (e.g., test files) */
	exclude?: RegExp[];
}

const DEFAULT_OPTIONS: Required<LoadSparksOptions> = {
	extensions: ['.ts', '.js'],
	exclude: [/\.test\.[tj]s$/, /\.spec\.[tj]s$/, /__tests__/],
};

/**
 * Valid spark type values.
 */
const SPARK_TYPES: Set<SparkType> = new Set<SparkType>([
	'command',
	'component',
	'gateway-event',
	'scheduled-event',
]);

/**
 * Type guard to check if a value is a spark instance.
 *
 * Validates that the value has a recognized spark type and a register function.
 * Used internally during spark loading to filter exports.
 *
 * @param value - The value to check
 * @returns True if the value is a valid spark instance
 */
function isSpark(value: unknown): value is AnySpark {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		typeof (value as { type: unknown }).type === 'string' &&
		SPARK_TYPES.has((value as { type: SparkType }).type) &&
		'register' in value &&
		typeof (value as { register: unknown }).register === 'function'
	);
}

/**
 * Recursively finds all files in a directory using async Bun.glob().
 *
 * Builds a glob pattern from the specified extensions and scans the directory,
 * filtering out files matching exclude patterns. More performant than
 * synchronous fs operations for large directories.
 *
 * @param dir - The directory to scan
 * @param options - Loader options with extensions and exclude patterns
 * @returns Array of absolute file paths
 */
async function findFiles(
	dir: string,
	options: Required<LoadSparksOptions>,
): Promise<string[]> {
	// Build glob pattern from extensions (e.g., "**/*.{ts,js}")
	const extPattern =
		options.extensions.length === 1
			? `**/*${options.extensions[0]}`
			: `**/*.{${options.extensions.map((e) => e.slice(1)).join(',')}}`;

	const glob = new Bun.Glob(extPattern);
	const files: string[] = [];

	for await (const file of glob.scan({ cwd: dir, absolute: true })) {
		const isExcluded = options.exclude.some((pattern) => pattern.test(file));
		if (!isExcluded) {
			files.push(file);
		}
	}

	return files;
}

/**
 * Gets a unique identifier for a spark (for logging purposes).
 *
 * Extracts the appropriate ID field based on spark type:
 * - Commands: `id`
 * - Components: `key`
 * - Gateway events: `event` (stringified)
 * - Scheduled events: `id`
 *
 * @param spark - The spark instance
 * @returns A string identifier for logging
 */
function getSparkId(spark: AnySpark): string {
	switch (spark.type) {
		case 'command':
			return spark.id;
		case 'component':
			return spark.key;
		case 'gateway-event':
			return String(spark.event);
		case 'scheduled-event':
			return spark.id;
	}
}

/**
 * Warns if a spark duplicates the built-in interaction router.
 */
function warnIfDuplicateInteractionRouter(
	spark: AnySpark,
	relativePath: string,
	exportName: string,
	client: Client,
): void {
	if (spark.type === 'gateway-event' && spark.event === 'interactionCreate') {
		client.logger.warn(
			{ file: relativePath, export: exportName },
			'User spark registers an InteractionCreate listener — the framework already handles interaction routing automatically',
		);
	}
}

/**
 * Loads and registers all sparks from a directory.
 *
 * This function:
 * 1. Recursively finds all TypeScript/JavaScript files in the directory
 * 2. Imports each file
 * 3. Finds all exported spark instances (created via defineCommand, defineComponent, etc.)
 * 4. Calls register(client) on each spark
 *
 * **THROWS** on any error during loading - startup errors should terminate the application.
 *
 * @param client - The Discord client to register sparks with
 * @param directory - The directory to scan for spark files
 * @param options - Optional configuration
 * @returns Summary of loaded sparks
 *
 * @throws Error if any spark fails to load or register
 *
 * @example
 * ```ts
 * const result = await loadSparks(client, './src/sparks');
 * logger.info(`Loaded ${result.total} sparks`);
 * ```
 */
export async function loadSparks(
	client: Client,
	directory: string,
	options: LoadSparksOptions = {},
): Promise<LoadSparksResult> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const result: LoadSparksResult = {
		total: 0,
		commands: 0,
		components: 0,
		events: 0,
		scheduled: 0,
	};

	// Register the built-in interaction router before user sparks
	interactionRouter.register(client);
	client.logger.debug('Registered built-in interaction router');

	// Find all spark files
	const files = await findFiles(directory, opts);

	client.logger.debug(
		{ directory, fileCount: files.length },
		'Found spark files',
	);

	// Import and process each file
	for (const filePath of files) {
		const relativePath = relative(process.cwd(), filePath);

		try {
			// Dynamic import
			// biome-ignore lint/performance/noAwaitInLoops: sequential loading ensures deterministic registration order
			const module = (await import(filePath)) as Record<string, unknown>;

			// Find all exported spark instances
			for (const [exportName, exportValue] of Object.entries(module)) {
				if (isSpark(exportValue)) {
					const spark = exportValue;

					warnIfDuplicateInteractionRouter(
						spark,
						relativePath,
						exportName,
						client,
					);

					// Register the spark
					spark.register(client);
					result.total++;

					// Track type for logging
					switch (spark.type) {
						case 'command':
							result.commands++;
							break;
						case 'component':
							result.components++;
							break;
						case 'gateway-event':
							result.events++;
							break;
						case 'scheduled-event':
							result.scheduled++;
							break;
					}

					client.logger.debug(
						{
							spark: getSparkId(spark),
							type: spark.type,
							file: relativePath,
							export: exportName,
						},
						'Loaded spark',
					);
				}
			}
		} catch (error) {
			// Re-throw with context - startup errors should terminate
			throw new AppError(`Failed to load spark from ${relativePath}`, {
				code: 'ERR_SPARK_LOAD',
				metadata: { file: relativePath },
				isOperational: false,
				cause: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}

	client.logger.info(
		{
			total: result.total,
			commands: result.commands,
			components: result.components,
			events: result.events,
			scheduled: result.scheduled,
		},
		'Sparks loaded',
	);

	return result;
}

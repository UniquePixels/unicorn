// coverage-ignore-file — entry-point wiring; all called functions are independently tested
import { join } from 'node:path';
import process from 'node:process';
import { Client } from 'discord.js';
import { initializeClient } from '@/core/client';
import { parseConfig } from '@/core/configuration';
import { createLogger, type ExtendedLogger } from '@/core/lib/logger';
import {
	type LoadSparksResult,
	loadSparks,
	registerCommands,
} from '@/core/sparks';
import {
	cleanupRateLimits,
	getRateLimitStoreSize,
	RATE_LIMIT_CRITICAL_THRESHOLD,
	RATE_LIMIT_WARN_THRESHOLD,
} from '@/guards/built-in';
import { appConfig } from './config.ts';
import { createHealthCheckHandler } from './health-check';
import { createShutdownHandler, createShutdownSignal } from './shutdown';

/**
 * Main entry point for the Unicorn Discord bot.
 *
 * Startup sequence:
 * 1. Create logger
 * 2. Parse and validate configuration
 * 3. Initialize Discord.js Client with intents and partials
 * 4. Attach logger, config, and collections to client
 * 5. Load all sparks from src/sparks directory
 * 6. Register slash commands with Discord API
 * 7. Login to Discord
 *
 * Error handling:
 * - Startup errors (config, loading, registration) THROW and terminate the process
 * - Runtime errors (event handlers, commands) are logged but don't terminate
 *
 * @throws Error if startup fails at any step
 */

const logger: ExtendedLogger = createLogger();

logger.info('Starting Unicorn...');

// Parse and validate configuration
// THROWS on validation failure - app cannot function without valid config
const config = parseConfig(appConfig);
logger.debug('Configuration parsed successfully');
logger.debug({ config }, 'Effective configuration:');

// Create Discord.js Client with configured intents and partials
const discordClient: Client = new Client({
	intents: config.discord.intents,
	partials: config.discord.enabledPartials,
	presence: {
		status: config.discord.defaultPresence.status,
		activities: config.discord.defaultPresence.activities,
	},
	enforceNonce: config.discord.enforceNonce,
});

// Initialize client - attaches logger, config, and collections
const client = initializeClient(discordClient, logger, config);

// Register Discord.js debug/warn/error events through the logger with token redaction
logger.registerDebugSource({
	name: 'discord.js',
	emitter: client,
	eventMap: { debug: 'debug', warn: 'warn', error: 'error' },
	redactPatterns: [
		/Bot\s+[\w+/=-]+\.[\w+/=-]+\.[\w+/=-]+/g,
		/[\w+/=-]{20,}\.[\w+/=-]{4,}\.[\w+/=-]{20,}/g,
	],
});

// Log shard lifecycle events (discord.js handles reconnection automatically)
client.on('shardDisconnect', (event, shardId) => {
	logger.warn(
		{ shardId, code: event.code, reason: event.reason },
		'Shard disconnected',
	);
});
client.on('shardReconnecting', (shardId) => {
	logger.info({ shardId }, 'Shard reconnecting');
});
client.on('shardResume', (shardId, replayedEvents) => {
	logger.info({ shardId, replayedEvents }, 'Shard resumed');
});
client.on('shardReady', (shardId, unavailableGuilds) => {
	logger.info(
		{ shardId, unavailableGuilds: unavailableGuilds?.size ?? 0 },
		'Shard ready',
	);
});
client.on('shardError', (error, shardId) => {
	logger.error({ err: error, shardId }, 'Shard error');
});

// Load all sparks from the sparks directory
// THROWS on load failure - app cannot function with broken sparks
const sparksDir: string = join(import.meta.dir, 'sparks');
const loadResult: LoadSparksResult = await loadSparks(client, sparksDir);

logger.info({ sparks: loadResult.total }, 'Sparks loaded successfully');

// Register commands with Discord API
// THROWS on registration failure — users can't use commands without registration
await registerCommands(client);

// Set up periodic rate limit cleanup (every 5 minutes)
const CLEANUP_INTERVAL_MS: number = 5 * 60 * 1000;
const cleanupIntervalId: Timer = setInterval(() => {
	const cleared = cleanupRateLimits();
	if (cleared > 0) {
		logger.debug({ cleared }, 'Cleaned up rate limit entries');
	}

	const storeSize = getRateLimitStoreSize();
	if (storeSize >= RATE_LIMIT_CRITICAL_THRESHOLD) {
		logger.error({ storeSize }, 'Rate limit store near capacity');
	} else if (storeSize >= RATE_LIMIT_WARN_THRESHOLD) {
		logger.warn({ storeSize }, 'Rate limit store growing large');
	}
}, CLEANUP_INTERVAL_MS);

// Shared shutdown signal — used by shutdown handler and health check
const shutdownSignal = createShutdownSignal();

// Health check server reference (set later if enabled)
let healthCheckServer: ReturnType<typeof Bun.serve> | undefined;

// Start health check server if port is configured
if (config.healthCheckPort) {
	healthCheckServer = Bun.serve({
		port: config.healthCheckPort,
		fetch: createHealthCheckHandler(client, shutdownSignal),
	});

	logger.info({ port: config.healthCheckPort }, 'Health check server started');
}

// Set up graceful shutdown (after health check server is initialized)
const shutdown = createShutdownHandler({
	client,
	logger,
	cleanupIntervalId,
	shutdownSignal,
	...(healthCheckServer && { healthCheckServer }),
	exit: process.exit,
});

process.on('SIGINT', () => {
	shutdown('SIGINT').catch(() => process.exit(1));
});
process.on('SIGTERM', () => {
	shutdown('SIGTERM').catch(() => process.exit(1));
});

// Login to Discord
// THROWS on login failure - app cannot function without connection
logger.info('Connecting to Discord...');
await client.login(config.discord.apiToken);

import type { Client } from 'discord.js';
import type { ShutdownSignal } from './shutdown';

/** Security headers applied to all health check responses. */
const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Cache-Control': 'no-store',
};

/**
 * Creates the fetch handler for the health check server.
 * Extracted for testability without starting an actual server.
 *
 * @param client - Discord client for readiness checks
 * @param shutdownSignal - Shared signal; when set, `/ready` returns 503 immediately
 */
export function createHealthCheckHandler(
	client: Client,
	shutdownSignal?: ShutdownSignal,
): (req: Request) => Response {
	return (req: Request): Response => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			return new Response('Method Not Allowed', {
				status: 405,
				headers: {
					...SECURITY_HEADERS,
					// biome-ignore lint/style/useNamingConvention: Allow is a standard HTTP header name (RFC 9110)
					Allow: 'GET, HEAD',
				},
			});
		}

		const url = new URL(req.url);

		// Liveness probe - is the process running?
		if (url.pathname === '/health' || url.pathname === '/healthz') {
			return new Response('OK', { status: 200, headers: SECURITY_HEADERS });
		}

		// Readiness probe - is the bot connected to Discord?
		if (url.pathname === '/ready' || url.pathname === '/readyz') {
			if (shutdownSignal?.shuttingDown) {
				return new Response('Shutting Down', {
					status: 503,
					headers: SECURITY_HEADERS,
				});
			}
			const isReady = client.isReady();
			return new Response(isReady ? 'Ready' : 'Not Ready', {
				status: isReady ? 200 : 503,
				headers: SECURITY_HEADERS,
			});
		}

		return new Response('Not Found', {
			status: 404,
			headers: SECURITY_HEADERS,
		});
	};
}

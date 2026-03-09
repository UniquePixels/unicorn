import type { Client } from 'discord.js';
import type { ShutdownSignal } from './shutdown';

/** Security headers applied to all health check responses. */
const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Cache-Control': 'no-store',
};

/** Creates a response with security headers. */
function respond(
	body: string,
	status: number,
	extra?: Record<string, string>,
): Response {
	return new Response(body, {
		status,
		headers: extra ? { ...SECURITY_HEADERS, ...extra } : SECURITY_HEADERS,
	});
}

/** Handles liveness probe (`/health`, `/healthz`). */
function handleLiveness(): Response {
	return respond('OK', 200);
}

/** Handles readiness probe (`/ready`, `/readyz`). */
function handleReadiness(
	client: Client,
	shutdownSignal?: ShutdownSignal,
): Response {
	if (shutdownSignal?.shuttingDown) {
		return respond('Shutting Down', 503);
	}
	const isReady = client.isReady();
	return respond(isReady ? 'Ready' : 'Not Ready', isReady ? 200 : 503);
}

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
			return respond('Method Not Allowed', 405, {
				// biome-ignore lint/style/useNamingConvention: Allow is a standard HTTP header name (RFC 9110)
				Allow: 'GET, HEAD',
			});
		}

		const { pathname } = new URL(req.url);

		if (pathname === '/health' || pathname === '/healthz') {
			return handleLiveness();
		}

		if (pathname === '/ready' || pathname === '/readyz') {
			return handleReadiness(client, shutdownSignal);
		}

		return respond('Not Found', 404);
	};
}

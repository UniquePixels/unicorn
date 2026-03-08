import { describe, expect, test } from 'bun:test';
import { createMockClient } from '@/core/lib/test-helpers';
import { createHealthCheckHandler } from './health-check';
import { createShutdownSignal } from './shutdown';

// ─── Test Helpers ────────────────────────────────────────────────

function makeRequest(path: string): Request {
	return new Request(`http://localhost${path}`);
}

function expectSecurityHeaders(response: Response): void {
	expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(response.headers.get('Cache-Control')).toBe('no-store');
}

// ─── Tests ───────────────────────────────────────────────────────

describe('createHealthCheckHandler', () => {
	test.each([
		'/health',
		'/healthz',
	])('%s returns 200 (liveness probe)', async (path) => {
		const client = createMockClient();
		const handler = createHealthCheckHandler(client);

		const response = handler(makeRequest(path));

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
	});

	test.each([
		'/ready',
		'/readyz',
	])('%s returns 200 when client is ready', async (path) => {
		const client = createMockClient({ isReady: true });
		const handler = createHealthCheckHandler(client);

		const response = handler(makeRequest(path));

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('Ready');
	});

	test.each([
		'/ready',
		'/readyz',
	])('%s returns 503 when client is not ready', async (path) => {
		const client = createMockClient({ isReady: false });
		const handler = createHealthCheckHandler(client);

		const response = handler(makeRequest(path));

		expect(response.status).toBe(503);
		expect(await response.text()).toBe('Not Ready');
	});

	test('HEAD requests are accepted like GET', () => {
		const client = createMockClient();
		const handler = createHealthCheckHandler(client);

		const response = handler(
			new Request('http://localhost/health', { method: 'HEAD' }),
		);

		expect(response.status).toBe(200);
	});

	test.each([
		'POST',
		'PUT',
		'DELETE',
		'PATCH',
	])('%s requests return 405 Method Not Allowed', async (method) => {
		const client = createMockClient();
		const handler = createHealthCheckHandler(client);

		const response = handler(
			new Request('http://localhost/health', { method }),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('GET, HEAD');
		expect(await response.text()).toBe('Method Not Allowed');
	});

	test('unknown paths return 404', async () => {
		const client = createMockClient();
		const handler = createHealthCheckHandler(client);

		const response = handler(makeRequest('/unknown'));

		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	test.each([
		'/health',
		'/ready',
		'/unknown',
	])('%s includes security headers', (path) => {
		const client = createMockClient({ isReady: true });
		const handler = createHealthCheckHandler(client);

		const response = handler(makeRequest(path));

		expectSecurityHeaders(response);
	});

	test('405 response includes security headers', () => {
		const client = createMockClient();
		const handler = createHealthCheckHandler(client);

		const response = handler(
			new Request('http://localhost/health', { method: 'POST' }),
		);

		expectSecurityHeaders(response);
	});

	test.each([
		'/ready',
		'/readyz',
	])('%s returns 503 when shutting down', async (path) => {
		const client = createMockClient({ isReady: true });
		const shutdownSignal = createShutdownSignal();
		shutdownSignal.shuttingDown = true;
		const handler = createHealthCheckHandler(client, shutdownSignal);

		const response = handler(makeRequest(path));

		expect(response.status).toBe(503);
		expect(await response.text()).toBe('Shutting Down');
		expectSecurityHeaders(response);
	});

	test('/health still returns 200 when shutting down', async () => {
		const client = createMockClient();
		const shutdownSignal = createShutdownSignal();
		shutdownSignal.shuttingDown = true;
		const handler = createHealthCheckHandler(client, shutdownSignal);

		const response = handler(makeRequest('/health'));

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
	});
});

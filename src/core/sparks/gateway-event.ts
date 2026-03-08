import type { Client, ClientEvents, Events } from 'discord.js';
import type { Guard, GuardResult, NarrowedBy } from '@/core/guards';
import { processGuards, resolveGuards } from '@/core/guards';
import { attempt } from '@/core/lib/attempt';

/**
 * Extracts the first argument type from a ClientEvents tuple.
 */
type EventArg<E extends keyof ClientEvents> = ClientEvents[E][0];

/** Drops the first element from a tuple type. */
type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : [];

/**
 * Action function for gateway events.
 * Receives the guarded first arg, any remaining event args, then client.
 */
export type GatewayEventAction<
	E extends keyof ClientEvents,
	TGuarded extends EventArg<E> = EventArg<E>,
> = (
	...args: [TGuarded, ...Tail<ClientEvents[E]>, Client]
) => void | Promise<void>;

/**
 * Options for defining a gateway event spark.
 */
export interface GatewayEventOptions<
	E extends keyof ClientEvents,
	TGuarded extends EventArg<E> = EventArg<E>,
> {
	/** The Discord gateway event to listen for */
	event: E;
	/** Whether this event should only fire once (e.g., ClientReady) */
	once?: boolean;
	/** Guards to run before the action (optional) */
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	guards?: readonly Guard<any, any>[];
	/** The action to run when the event fires */
	action: GatewayEventAction<E, TGuarded>;
}

/**
 * A gateway event spark instance.
 */
export interface GatewayEventSpark<
	E extends keyof ClientEvents = keyof ClientEvents,
	TGuarded extends EventArg<E> = EventArg<E>,
> {
	readonly type: 'gateway-event';
	readonly event: E;
	readonly once: boolean;
	// biome-ignore lint/suspicious/noExplicitAny: Guard chains have heterogeneous input/output types; type safety is enforced by runGuards at runtime
	readonly guards: readonly Guard<any, any>[];
	readonly action: GatewayEventAction<E, TGuarded>;

	/** Execute the event handler (runs guards then action) */
	execute(
		eventArgs: ClientEvents[E],
		client: Client,
	): Promise<GuardResult<TGuarded>>;

	/** Register this spark with the client */
	register(client: Client): void;
}

/**
 * Creates a gateway event spark.
 *
 * @example
 * ```ts
 * // One-time ready event
 * export const ready = defineGatewayEvent({
 *   event: Events.ClientReady,
 *   once: true,
 *   action: (readyClient, client) => {
 *     client.logger.info(`Logged in as ${readyClient.user.tag}`);
 *   },
 * });
 *
 * // Recurring message event with guards
 * export const messageLog = defineGatewayEvent({
 *   event: Events.MessageCreate,
 *   guards: [messageInGuild, notBot],
 *   action: (message, client) => {
 *     client.logger.debug(`${message.author.tag}: ${message.content}`);
 *   },
 * });
 * ```
 */
/**
 * Overload: when guards are provided, auto-narrow the action parameter type.
 */
export function defineGatewayEvent<
	E extends keyof ClientEvents,
	// biome-ignore lint/suspicious/noExplicitAny: Guard<any, any> required for const tuple inference
	const Guards extends readonly Guard<any, any>[],
>(
	options: GatewayEventOptions<E, NarrowedBy<EventArg<E>, Guards>> & {
		guards: Guards;
	},
): GatewayEventSpark<E, NarrowedBy<EventArg<E>, Guards>>;

/**
 * Overload: without guards or with explicit TGuarded — backward compatible.
 */
export function defineGatewayEvent<
	E extends keyof ClientEvents,
	TGuarded extends EventArg<E> = EventArg<E>,
>(options: GatewayEventOptions<E, TGuarded>): GatewayEventSpark<E, TGuarded>;

export function defineGatewayEvent<
	E extends keyof ClientEvents,
	TGuarded extends EventArg<E> = EventArg<E>,
>(options: GatewayEventOptions<E, TGuarded>): GatewayEventSpark<E, TGuarded> {
	const { event, once = false, action } = options;
	const guards = resolveGuards(options.guards ?? [], 'gateway-event');

	return {
		type: 'gateway-event',
		event,
		once,
		guards,
		action,

		async execute(
			eventArgs: ClientEvents[E],
			client: Client,
		): Promise<GuardResult<TGuarded>> {
			// Run guards on the first event arg with centralized error handling
			const guardResult = await processGuards(
				guards,
				eventArgs[0],
				client.logger,
				`gateway:${String(event)}`,
				{ silent: true },
			);

			if (!guardResult.ok) {
				return guardResult as GuardResult<TGuarded>;
			}

			// Execute action with guarded first arg, remaining event args, then client
			const actionResult = await attempt(
				// @ts-expect-error: TS cannot verify [TGuarded, ...Tail<ClientEvents[E]>, Client] spread from generic tuple
				() => action(guardResult.value, ...eventArgs.slice(1), client),
			);

			if (actionResult.isErr()) {
				client.logger.error(
					{ err: actionResult.error, event },
					'Gateway event action failed',
				);
			}

			return guardResult as GuardResult<TGuarded>;
		},

		register(client: Client): void {
			const handler = async (...args: ClientEvents[E]) => {
				try {
					await this.execute(args, client);
				} catch (error) {
					client.logger.error(
						{ err: error, event },
						'Gateway event handler failed unexpectedly',
					);
				}
			};

			if (once) {
				client.once(event, handler);
			} else {
				client.on(event, handler);
			}

			client.logger.debug({ event, once }, 'Registered gateway event');
		},
	};
}

/**
 * Type alias for the ClientReady event argument.
 */
export type ReadyClient = ClientEvents[typeof Events.ClientReady][0];

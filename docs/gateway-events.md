# Gateway Events

Gateway events in Unicorn are built using the Spark system. Every event listener is a `GatewayEventSpark` created with `defineGatewayEvent()` and auto-registered through the loader.

## Basic Usage

Use `defineGatewayEvent` to listen for any Discord.js gateway event:

```ts
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';

export const ready = defineGatewayEvent({
  event: Events.ClientReady,
  once: true,
  action: (readyClient, client) => {
    client.logger.info(
      { user: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
      'Bot is ready',
    );
  },
});
```

The `action` receives the first argument of the event and the `Client` instance. The client parameter is kept for gateway events because some events pass arguments that don't have a `.client` property — `debug` and `warn` emit a `string`, while `error` emits an `Error` object.

## Event Types

The `event` field accepts any `keyof ClientEvents` value. In practice, use the `Events` enum from discord.js for type safety and readability:

```ts
import { Events } from 'discord.js';

// Events.ClientReady      -> 'ready'
// Events.MessageCreate     -> 'messageCreate'
// Events.GuildMemberAdd    -> 'guildMemberAdd'
// Events.InteractionCreate -> 'interactionCreate'
```

The action's first parameter is automatically typed to match the event. For example, `Events.MessageCreate` gives you a `Message`, while `Events.GuildMemberAdd` gives you a `GuildMember`.

## Once vs Recurring

### One-shot events

Set `once: true` for events that should only fire a single time. The most common example is `ClientReady`:

```ts
export const ready = defineGatewayEvent({
  event: Events.ClientReady,
  once: true,
  action: (readyClient, client) => {
    client.logger.info(`Logged in as ${readyClient.user.tag}`);
  },
});
```

Under the hood, `once: true` uses `client.once()` instead of `client.on()`.

### Recurring events

By default, `once` is `false`. The listener stays active for the lifetime of the client:

```ts
import { attempt } from '@/core/lib/attempt';

export const memberJoin = defineGatewayEvent({
  event: Events.GuildMemberAdd,
  action: async (member, client) => {
    client.logger.info({ userId: member.id }, 'New member joined');
    const result = await attempt(() => member.send('Welcome to the server!'));
    if (result.isErr()) {
      client.logger.warn({ err: result.error, userId: member.id }, 'Failed to send welcome DM');
    }
  },
});
```

## Guards

Guards work the same way as they do for commands. They run before the action and can narrow the event argument type. If a guard fails, the action is skipped and a debug-level log is emitted.

```ts
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const messageLog = defineGatewayEvent({
  event: Events.MessageCreate,
  guards: [g.notBot, g.messageInGuild],
  action: (message, client) => {
    // message is guaranteed to be from a non-bot user in a guild
    client.logger.debug(
      { guild: message.guild.id, author: message.author.tag },
      message.content,
    );
  },
});
```

Guard failures in gateway events are silent to the end user (there is no interaction to reply to). The failure reason is logged at `debug` level with the event name.

## Error Handling

Runtime errors in gateway event actions are caught and logged but never crash the bot. The execution flow has two layers of error handling:

1. **`execute()`** wraps the action in `attempt()`. If the action throws, the error is logged at `error` level.
2. **`register()`** wraps the entire `execute()` call in a try/catch as a safety net for unexpected failures.

```text
Event fires
  -> register() handler catches top-level errors
    -> execute()
      -> runGuards(guards, arg)
      -> if guards fail: log debug, skip action
      -> action(narrowedArg, client)
      -> if action throws: log error (don't crash)
```

This means you can write actions without defensive try/catch blocks. Errors are reported through the logger (and Sentry in production) without taking down the bot.

## Built-in Events

Unicorn ships with two built-in gateway event sparks in `src/sparks/built-in/`:

| Spark | Event | Once | Description |
|---|---|---|---|
| `interaction-create` | `InteractionCreate` | No | Routes interactions to command and component sparks |
| `ready` | `ClientReady` | Yes | Logs the bot's username and guild count on startup |

These are loaded automatically. You do not need to create your own `InteractionCreate` or `ClientReady` handlers unless you want additional behavior alongside the built-in ones.

## API Reference

### `defineGatewayEvent<E, TGuarded>(options)`

Creates a gateway event spark.

| Option | Type | Required | Description |
|---|---|---|---|
| `event` | `keyof ClientEvents` | Yes | Discord gateway event to listen for |
| `once` | `boolean` | No | Fire only once (default: `false`) |
| `guards` | `Guard[]` | No | Guards to run before the action |
| `action` | `(arg, client) => void \| Promise<void>` | Yes | Handler function |

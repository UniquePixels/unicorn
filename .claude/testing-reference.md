# Spark Testing Reference

Machine-readable reference for testing Unicorn sparks. Not for humans.

## Imports

```ts
import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import { createMockClient, createMockChatInputInteraction, createMockAutocompleteInteraction, createMockComponentInteraction, createMockBaseInteraction, createMockMessage, createMockReadyClient, passThroughGuard, failGuard } from '@/core/lib/test-helpers';
import { defineCommand, defineCommandWithAutocomplete, defineCommandGroup, defineComponent, defineGatewayEvent, defineScheduledEvent } from '@/core/sparks';
import { createGuard, guardPass, guardFail, getGuardMeta, resolveGuards, processGuards, GUARD_META } from '@/core/guards';
import type { Guard, GuardMeta, SparkType } from '@/core/guards';
```

## Test Helper APIs

### createMockClient(overrides?)

```ts
createMockClient({
  commands?, components?, scheduledJobs?,
  on?, once?, isReady?, ws?, config?, logger?,
}): Client
```

All logger methods are mocks. Has `destroy: mock(() => {})`.

### createMockChatInputInteraction(overrides?)

```ts
createMockChatInputInteraction({
  commandName?, userId?, replied?, deferred?, options?,
  createdTimestamp?, reply?, editReply?, fetchReply?,
}): ChatInputCommandInteraction
```

Options record feeds: `getString(key)`, `getInteger(key)`, `getNumber(key)`, `getBoolean(key)`, `getUser(key)`, `getChannel(key)`, `getRole(key)`, `getMentionable(key)`, `getAttachment(key)`, `getSubcommand()` (reads `options.subcommand`), `getSubcommandGroup()` (reads `options.subcommandGroup`).

### Other mock factories

- `createMockAutocompleteInteraction({ commandName?, focusedValue?, userId? })` — has `options.getFocused()` and mock `respond`
- `createMockComponentInteraction(customId, { userId?, replied?, deferred? }?)` — has mocks: `reply`, `deferUpdate`, `update`, `deferReply`, `editReply`
- `createMockBaseInteraction(overrides?)` — all type guards return `false` by default, override with `mock(() => true)`
- `createMockMessage({ inGuild?, isBot?, authorId? })` — has `inGuild()`, `author.id/bot`, `guildId`
- `createMockReadyClient({ userTag?, guildCount? })` — has `user.tag`, `guilds.cache.size`
- `passThroughGuard()` / `failGuard(reason)` — both are `mock()` instances

## Core Test Patterns

### Spark execution

```ts
// Command
const interaction = createMockChatInputInteraction({ commandName: 'test', reply: mock(async () => {}) });
const result = await spark.execute(interaction);
expect(result.ok).toBe(true);

// Command group with subcommand
const interaction = createMockChatInputInteraction({ commandName: 'manage', options: { subcommand: 'list' } });

// Component
const interaction = createMockComponentInteraction('my-button');
const result = await spark.execute(interaction);

// Gateway event — pass event args as array
const msg = createMockMessage({ isBot: false });
await spark.execute([msg], client);

// Scheduled event
const ctx = { client, job: {} as CronJob, fireDate: new Date() };
const result = await spark.execute(ctx);
```

### Registration

```ts
spark.register(client);
expect(client.commands.has('ping')).toBe(true);       // commands
expect(client.components.has('my-button')).toBe(true); // components (exact)
expect(client.components.has('ban-')).toBe(true);       // components (parameterized routeKey)
expect(client.on).toHaveBeenCalledTimes(1);             // gateway (once: false)
expect(client.scheduledJobs.has('cleanup:0 0 * * *')).toBe(true); // scheduled
```

### Guard testing

```ts
// Result assertions
expect(result.ok).toBe(true);
if (result.ok) expect(result.value).toBe(interaction);
expect(result.ok).toBe(false);
if (!result.ok) expect(result.reason).toContain('server');

// Metadata
const meta = getGuardMeta(myGuard);
expect(meta!.name).toBe('myGuard');

// resolveGuards
expect(() => resolveGuards([guard], 'scheduled-event')).toThrow(AppError);

// processGuards
const result = await processGuards([guard], input, client.logger, 'test:ctx');
```

### Logging assertions

```ts
// Guard failure — command/component (info), gateway/scheduled (warn, silent)
expect(logger.info).toHaveBeenCalledWith({ context: 'command:name', reason: 'msg' }, 'Guard check failed');
expect(logger.warn).toHaveBeenCalledWith({ context: 'gateway:messageCreate', reason: 'msg' }, 'Guard check failed');

// Guard exception (error, all types)
expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ context: 'command:name' }), 'Guard exception');

// Action/autocomplete failure
expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ command: 'name' }), 'Command action failed');
expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ command: 'name' }), 'Autocomplete handler failed');
```

## Guidelines

- File-local helpers at top for mocks specific to module under test
- Group with nested `describe` by feature
- Fresh mocks per test — no shared mutable state
- Use `as unknown as Type` for minimal mocks
- Bun test primitives only: `describe`, `test`, `expect`, `mock`, `spyOn`, `beforeEach`, `afterEach`

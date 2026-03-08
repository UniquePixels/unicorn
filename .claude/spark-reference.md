# Spark Composition Reference

Machine-readable reference for composing Unicorn sparks. Not for humans.

## Imports

```ts
// Spark definitions
import { defineCommand, defineCommandWithAutocomplete, defineCommandGroup, defineComponent, defineGatewayEvent, defineScheduledEvent } from '@/core/sparks';
import type { CommandSpark, CommandBuilder, SubcommandHandler, ComponentSpark, ParsedComponentId, ReadyClient, ScheduledContext, AnySpark } from '@/core/sparks';
import { parseComponentId } from '@/core/sparks';
// Guards
import { createGuard, guardPass, guardFail, getGuardMeta, resolveGuards, processGuards } from '@/core/guards';
import type { Guard, GuardResult, GuardMeta, NarrowedBy, ProcessGuardsOptions, SparkType } from '@/core/guards';
// Built-in guards
import * as g from '@/guards/built-in';
import type { GuildInteraction, TextChannelInteraction, DMInteraction, ChannelTypedInteraction } from '@/guards/built-in';
// Error handling
import { attempt, ok, err, isOk, isErr } from '@/core/lib/attempt';
import type { Result, Ok, Err } from '@/core/lib/attempt';
// Logger & errors
import { AppError } from '@/core/lib/logger';
import type { ExtendedLogger } from '@/core/lib/logger';
```

## Spark Definitions

### defineCommand

```ts
defineCommand<TGuarded extends CommandInteraction = ChatInputCommandInteraction>({
  command: CommandBuilder,
  guards?: readonly Guard<any,any>[],
  action: (interaction: TGuarded) => void | Promise<void>,
}): CommandSpark<TGuarded>
```

Shape: `{ type:'command', id:command.name, command, guards, action, execute(), register() }`
Execute: processGuards → action wrapped in attempt() → log error on throw.

```ts
// Slash command
export const ping = defineCommand({
  command: new SlashCommandBuilder().setName('ping').setDescription('Pong'),
  action: async (interaction) => { await interaction.reply('Pong!'); },
});

// Context menu (explicit generic for target access)
export const report = defineCommand<MessageContextMenuCommandInteraction>({
  command: new ContextMenuCommandBuilder().setName('Report').setType(ApplicationCommandType.Message),
  action: async (interaction) => { /* interaction.targetMessage available */ },
});
```

### defineCommandWithAutocomplete

Same as `defineCommand` plus `autocomplete: (interaction: AutocompleteInteraction) => void | Promise<void>`. Adds `executeAutocomplete()` method.

### defineCommandGroup

```ts
defineCommandGroup<TGuarded extends ChatInputCommandInteraction = ChatInputCommandInteraction>({
  command: CommandBuilder,
  guards?: readonly Guard<any,any>[],     // top-level, run first
  subcommands?: Record<string, SubcommandHandler<TGuarded>>,
  groups?: Record<string, Record<string, SubcommandHandler<TGuarded>>>,
})
// SubcommandHandler: { guards?, action, autocomplete? }
```

Execute: rejects non-slash → top-level guards → resolve subcommand → subcommand guards + action. Autocomplete auto-detected and routed.

### defineComponent

```ts
defineComponent<TInput extends AnyComponentInteraction = ButtonInteraction, TGuarded extends TInput = TInput>({
  id: string,  // exact: 'confirm' | parameterized: '{ban-:userId}'
  guards?: readonly Guard<any,any>[],
  action: (interaction: TGuarded, params: Record<string, string>) => void | Promise<void>,
})
```

Shape: `{ type:'component', id, key:parsed.key, parsed, guards, action, execute(), register() }`
Matching: exact → O(1) Map lookup, parameterized `{pattern-:param}` → O(d) dash walk.
Params extracted at execute-time via compiled regex. Registration throws on duplicate keys.

### defineGatewayEvent

```ts
defineGatewayEvent<E extends keyof ClientEvents, TGuarded extends ClientEvents[E][0] = ClientEvents[E][0]>({
  event: E,
  once?: boolean,
  guards?: readonly Guard<any,any>[],
  action: (...args: [TGuarded, ...Tail<ClientEvents[E]>, Client]) => void | Promise<void>,
})
```

### defineScheduledEvent

```ts
defineScheduledEvent({
  id: string,
  schedule: string | string[],  // cron expression(s)
  timezone?: string,             // IANA tz, default 'UTC'
  guards?: readonly Guard<any,any>[],
  action: (ctx: ScheduledContext) => void | Promise<void>,
})
// ScheduledContext = { client: Client, job: CronJob, fireDate: Date }
```

## Guards

### Core types & utilities

```ts
type GuardResult<T> = { ok: true; value: T } | { ok: false; reason: string };
type Guard<TInput, TOutput extends TInput = TInput> = (input: TInput) => GuardResult<TOutput> | Promise<GuardResult<TOutput>>;

createGuard(fn, meta?)          // wraps guard fn, optionally attaches GuardMeta
guardPass(value) / guardFail(reason)
resolveGuards(guards, sparkType) // define-time: validates compatibility, auto-resolves deps
processGuards(guards, input, logger, context, { silent? }) // execute-time
```

**resolveGuards:** Validates `incompatibleWith`, auto-prepends `requires` deps for command/component, deduplicates. Gateway/scheduled skip dep resolution.

**processGuards:** Intentional failure → info (user-facing) or warn (silent). Guard exception → caught, wrapped in AppError, logged error, returns `{ ok: false, reason: 'An internal error occurred.' }`.

### Creating custom guards

```ts
// Constant guard
export const myGuard = createGuard<InputType, OutputType>((input) => {
  if (condition) return guardPass(input as OutputType);
  return guardFail('Reason');
}, { name: 'myGuard', requires: [g.inCachedGuild], incompatibleWith: ['scheduled-event'] });

// Factory guard
export function myGuard<T>(param: ParamType): Guard<T, T> {
  return createGuard((input) => { /* ... */ }, { name: 'myGuard' });
}
```

### Built-in guards

| Guard | Input → Output | Notes |
|---|---|---|
| `inCachedGuild` | `Interaction` → `GuildInteraction` | Narrows: guild, guildId, member; channel nullable |
| `inTextChannel` | `GuildInteraction` → `TextChannelInteraction` | Narrows: channel non-null & text-based |
| `isDMChannel` | `Interaction` → `DMInteraction` | Narrows: channel to DMChannel |
| `hasPermission(perms, msg?)` | `{member:GuildMember}` → same | member.permissions.has |
| `botHasPermission(perms, msg?)` | `{guild:Guild}` → same | Bot perms at guild level |
| `hasPermissionIn(perms, channelGuard?, msg?)` | `{member, channel}` → same | User perms in channel |
| `botHasPermissionIn(perms, channelGuard?, msg?)` | `{guild, channel}` → same | Bot perms in channel |
| `hasChannel(idOrFn)` | `{guild:Guild}` → same | Channel exists in cache |
| `channelType(...types)` | `Interaction` → `ChannelTypedInteraction` | Narrows channel type |
| `isUser(userIds, msg?)` | `Interaction` → same | interaction.user.id in set |
| `notBot` | `Message` → `Message` | !message.author.bot |
| `messageInGuild` | `Message` → `Message<true>` | Narrows to guild message |
| `rateLimit({limit,window,keyFn?,message?})` | `Interaction` → same | In-memory, per-user default |
| `hasSystemChannel` | `{guild}` → narrowed | guild.systemChannel exists |
| `hasPublicUpdatesChannel` | `{guild}` → narrowed | guild.publicUpdatesChannel exists |
| `hasRulesChannel` | `{guild}` → narrowed | guild.rulesChannel exists |
| `hasSafetyAlertsChannel` | `{guild}` → narrowed | guild.safetyAlertsChannel exists |

**Type narrowing:** All `define*` functions auto-narrow `action` via `NarrowedBy<TBase, Guards>` when guards are provided inline.

**Channel + permission guards:** Channel guards carry `channelResolver` metadata. Pass to `hasPermissionIn`/`botHasPermissionIn`:
```ts
guards: [g.botHasPermissionIn(PermissionFlagsBits.SendMessages, g.hasSystemChannel)]
// Auto-resolves to: [g.inCachedGuild, g.hasSystemChannel, g.botHasPermissionIn(...)]
```

## Error Handling

```ts
type Result<T, E=Error> = Ok<T> | Err<E>;
attempt(fn) → Promise<Result<T>>
result.isOk() / result.isErr()         // type guards (methods)
isOk(result) / isErr(result)           // standalone (array filtering)
result.map(fn) / result.mapErr(fn)     // transform
result.unwrap() / result.unwrapOr(v)   // extract
result.match({ ok, err })              // exhaustive pattern matching
ok(value) / err(error)                 // manual construction
```

## Conventions

- Logger pattern: `logger.level({ key: val }, 'message')` — use `{ err }` key (not `{ error }`) for errors
- `AppError('msg', { code, metadata?, cause? })` for domain errors
- Each spark file exports named const(s). Loader discovers sparks by checking exports for `type` + `register`.

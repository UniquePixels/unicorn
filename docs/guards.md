# Guards

Guards are composable validation functions that run before a spark's action. They can validate conditions, check permissions, enforce rate limits, and narrow TypeScript types so your action receives a more specific type than the raw input.

Every guard receives `(input)` and returns one of:

- `{ ok: true, value }` -- validation passed; `value` is the (possibly narrowed) input
- `{ ok: false, reason }` -- validation failed; `reason` is a human-readable explanation

Guards are used with commands, components, gateway events, and scheduled event sparks.

## Guard Metadata

Every built-in guard carries **metadata** (attached via a unique symbol at creation time). Metadata enables:

- **`requires`** -- Guards that must run before this one. Automatically prepended at define-time for `command` and `component` sparks.
- **`incompatibleWith`** -- Spark types this guard cannot be used with. Validated at define-time; throws `AppError('ERR_GUARD_INCOMPATIBLE')` if violated.
- **`channelResolver`** -- Returns the target channel from the guard's narrowed input. Used by `*PermissionIn` guards.

This means you no longer need to manually order common dependencies like `inCachedGuild` -- they are auto-resolved:

```ts
// Before: manual ordering required
guards: [g.inCachedGuild, g.hasPermission(PermissionFlagsBits.ManageMessages)]

// After: auto-resolved (inCachedGuild is prepended automatically)
guards: [g.hasPermission(PermissionFlagsBits.ManageMessages)]
```

> [!NOTE]
> Auto-resolution only applies to `command` and `component` sparks. Gateway event and scheduled event sparks skip dependency resolution because their inputs aren't always interactions.

## Built-in Guards

Unicorn ships with a set of guards covering the most common validation needs. Import them as a namespace from `@/guards/built-in` for convenient autocomplete:

```ts
import * as g from '@/guards/built-in';

// Use as: g.inCachedGuild, g.hasPermission(...), g.botHasPermissionIn(...), etc.
```

### `inCachedGuild`

Ensures the interaction is in a cached guild. Narrows the interaction type to `GuildInteraction`, which guarantees `guild`, `guildId`, and `member` are present and typed. Note that `channel` may still be `null` if the channel is not cached — use `inTextChannel` to guarantee a non-null text channel.

This is the most commonly used guard and is automatically prepended by permission and channel guards via dependency resolution.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const serverInfo = defineCommand({
  command: new SlashCommandBuilder()
    .setName('server-info')
    .setDescription('Show server information'),
  guards: [g.inCachedGuild],
  action: async (interaction) => {
    // interaction.guild, interaction.member, interaction.guildId are all guaranteed
    await interaction.reply(`Server: ${interaction.guild.name} (${interaction.guild.memberCount} members)`);
  },
});
```

**Failure message:** "This can only be used in a server."

### `inTextChannel`

Ensures the interaction has a non-null, text-based guild channel. Narrows the interaction type to `TextChannelInteraction`, which guarantees `channel` is present and sendable. Requires `inCachedGuild` (auto-resolved).

Use this guard when your action needs to call methods like `interaction.channel.send()`.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const announce = defineCommand({
  command: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement in this channel'),
  guards: [g.inTextChannel],
  action: async (interaction) => {
    // interaction.channel is guaranteed non-null and text-based
    await interaction.channel.send('Important announcement!');
    await interaction.reply({ content: 'Announcement sent!', ephemeral: true });
  },
});
```

**Failure message:** "This can only be used in a text channel."

### `hasPermission(permissions, message?)`

Checks that the invoking user has the specified guild-level permission(s). Requires `inCachedGuild` (auto-resolved).

```ts
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { attempt } from '@/core/lib/attempt';
import * as g from '@/guards/built-in';

export const purge = defineCommand({
  command: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete messages in bulk')
    .addIntegerOption(opt => opt.setName('count').setDescription('Number of messages').setRequired(true)),
  guards: [g.inTextChannel, g.hasPermission(PermissionFlagsBits.ManageMessages)],
  action: async (interaction) => {
    const count = interaction.options.getInteger('count', true);
    const result = await attempt(() => interaction.channel.bulkDelete(count));
    if (result.isErr()) {
      await interaction.reply({ content: 'Failed to delete messages.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: `Deleted ${count} messages.`, flags: MessageFlags.Ephemeral });
  },
});
```

You can check multiple permissions at once:

```ts
guards: [g.hasPermission(PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageChannels)]
```

An optional second argument overrides the default failure message:

```ts
g.hasPermission(PermissionFlagsBits.Administrator, 'This command is restricted to administrators.')
```

**Default failure message:** "You need the following permission(s): ManageMessages" (lists the resolved permission names).

### `botHasPermission(permissions, message?)`

Checks that the **bot** has the specified permission(s) at the **guild level** (not channel-specific). Requires `inCachedGuild` (auto-resolved).

For channel-level bot permission checks, use `botHasPermissionIn` instead.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const modCommand = defineCommand({
  command: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation command'),
  guards: [g.botHasPermission(PermissionFlagsBits.ManageRoles)],
  action: async (interaction) => {
    await interaction.reply('Moderation action performed.');
  },
});
```

**Default failure message:** "I need the following permission(s): ManageRoles"

### `hasPermissionIn(permissions, channelGuard?, message?)`

Checks that the invoking user has the specified permission(s) **in a specific channel**. Requires `inCachedGuild` (auto-resolved).

When `channelGuard` is omitted, checks the interaction channel. When provided, reads the target channel from the guard's `channelResolver` metadata.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

// Check perms in the interaction channel
export const sendEmbed = defineCommand({
  command: new SlashCommandBuilder()
    .setName('send-embed')
    .setDescription('Send a rich embed'),
  guards: [g.hasPermissionIn(PermissionFlagsBits.EmbedLinks)],
  action: async (interaction) => {
    await interaction.reply({ embeds: [/* ... */] });
  },
});

// Check perms in a specific channel (system channel)
export const announce = defineCommand({
  command: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post to system channel'),
  guards: [g.hasPermissionIn(PermissionFlagsBits.SendMessages, g.hasSystemChannel)],
  action: async (interaction) => {
    await interaction.guild.systemChannel.send('Announcement!');
    await interaction.reply({ content: 'Announcement posted!', ephemeral: true });
  },
});
```

**Default failure message:** "You need the following permission(s): EmbedLinks"

### `botHasPermissionIn(permissions, channelGuard?, message?)`

Checks that the **bot** has the specified permission(s) **in a specific channel**. Requires `inCachedGuild` (auto-resolved).

When `channelGuard` is omitted, checks the interaction channel. When provided, reads the target channel from the guard's `channelResolver` metadata.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

// Check bot perms in the interaction channel
export const embed = defineCommand({
  command: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Send a rich embed'),
  guards: [g.botHasPermissionIn(PermissionFlagsBits.EmbedLinks)],
  action: async (interaction) => {
    await interaction.reply({ embeds: [/* ... */] });
  },
});

// Check bot perms in a specific channel
export const welcome = defineCommand({
  command: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Post to system channel'),
  guards: [g.botHasPermissionIn(PermissionFlagsBits.SendMessages, g.hasSystemChannel)],
  action: async (interaction) => {
    await interaction.guild.systemChannel.send('Welcome message!');
    await interaction.reply({ content: 'Posted!', ephemeral: true });
  },
});
```

**Default failure message:** "I need the following permission(s): EmbedLinks"

### `hasChannel(channelIdOrFn)`

Checks that a channel with the given ID exists in the guild cache. Carries `channelResolver` metadata so `*PermissionIn` guards can read the target channel. Requires `inCachedGuild` (auto-resolved).

Accepts either a static ID string or a function that resolves the ID at execution time.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

// Static ID known at module scope
const logChannel = g.hasChannel('123456789012345678');

export const logCommand = defineCommand({
  command: new SlashCommandBuilder()
    .setName('log')
    .setDescription('Post to the log channel'),
  guards: [g.botHasPermissionIn(PermissionFlagsBits.SendMessages, logChannel)],
  action: async (interaction) => {
    // logChannel is guaranteed to exist, bot has SendMessages
  },
});

// Dynamic ID resolved at execution time
const configChannel = g.hasChannel((input) => input.client.config.ids.channel.logs);
```

**Failure message:** "Channel 123456789012345678 was not found in this server."

### `channelType(...types)`

Ensures the interaction is in a channel of the specified type(s). Narrows the interaction's `channel` property to the matching type.

```ts
import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const threadOnly = defineCommand({
  command: new SlashCommandBuilder()
    .setName('thread-only')
    .setDescription('Only works in threads'),
  guards: [g.channelType(ChannelType.PublicThread, ChannelType.PrivateThread)],
  action: async (interaction) => {
    await interaction.reply('This is a thread!');
  },
});
```

**Failure message:** "This command can only be used in: PublicThread, PrivateThread" (lists the allowed channel type names).

### `isDMChannel`

Ensures the interaction is in a DM channel. Narrows the interaction type to `DMInteraction`, which guarantees `channel` is a `DMChannel`. Standalone — does not require `inCachedGuild`.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const dmOnly = defineCommand({
  command: new SlashCommandBuilder()
    .setName('dm-only')
    .setDescription('Only works in DMs'),
  guards: [g.isDMChannel],
  action: async (interaction) => {
    // interaction.channel is narrowed to DMChannel
    await interaction.reply('This is a DM!');
  },
});
```

**Failure message:** "This can only be used in a direct message."

### `isUser(userIds, message?)`

Restricts usage to a whitelist of user IDs. Useful for owner-only or admin-only commands.

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const deploy = defineCommand({
  command: new SlashCommandBuilder()
    .setName('deploy')
    .setDescription('Deploy slash commands'),
  guards: [g.isUser(['123456789012345678', '987654321098765432'])],
  action: async (interaction) => {
    await interaction.reply({ content: 'Deploying commands...', ephemeral: true });
  },
});
```

**Default failure message:** "You do not have permission to use this command."

### `notBot`

Filters out messages from bots. This guard operates on `Message`, not `Interaction`, and is intended for use with message-based gateway event sparks.

```ts
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const messageLogger = defineGatewayEvent({
  event: Events.MessageCreate,
  guards: [g.notBot],
  action: (message, client) => {
    client.logger.info({ content: message.content }, 'New message from a human');
  },
});
```

**Failure message:** "Bots cannot use this."

### `messageInGuild`

Ensures a message was sent in a guild (not a DM). Like `notBot`, this guard operates on `Message` and narrows it to `Message<true>`.

```ts
import { Events } from 'discord.js';
import { defineGatewayEvent } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const guildMessages = defineGatewayEvent({
  event: Events.MessageCreate,
  guards: [g.notBot, g.messageInGuild],
  action: (message, client) => {
    // message is narrowed to Message<true> — guild properties guaranteed
    client.logger.info({ guild: message.guildId }, 'Guild message received');
  },
});
```

**Failure message:** "This can only be used in a server."

### `rateLimit({ limit, window, keyFn?, message? })`

Limits how many times a user (or other key) can trigger an action within a time window. Uses an in-memory store with LRU eviction (bounded to 100k entries) to prevent unbounded memory growth.

| Option | Type | Required | Description |
|---|---|---|---|
| `limit` | `number` | Yes | Maximum number of uses within the window |
| `window` | `number` | Yes | Time window in milliseconds |
| `keyFn` | `(input) => string` | No | Custom key function (default: user ID) |
| `message` | `string` | No | Custom failure message |

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

// 3 uses per 30 seconds per user
export const generate = defineCommand({
  command: new SlashCommandBuilder()
    .setName('generate')
    .setDescription('Generate something expensive'),
  guards: [g.rateLimit({ limit: 3, window: 30_000 })],
  action: async (interaction) => {
    await interaction.reply('Generating...');
  },
});
```

With a custom key function for per-guild rate limiting:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const announce = defineCommand({
  command: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Make an announcement'),
  guards: [
    g.inCachedGuild,
    g.rateLimit({
      limit: 10,
      window: 60_000,
      keyFn: (interaction) => `${interaction.guildId}:${interaction.user.id}`,
    }),
  ],
  action: async (interaction) => {
    await interaction.reply('Announcement sent!');
  },
});
```

Expired entries are cleaned up automatically via `cleanupRateLimits()`, which runs on a periodic interval.

**Default failure message:** "Rate limited. Try again in N seconds."

### Special Channel Guards

The special channel guards are **constants** that check if Discord's special guild channels exist. They check **existence only** -- use `botHasPermissionIn` to additionally verify bot permissions in the channel.

All special channel guards carry `channelResolver` metadata, so they can be passed to `*PermissionIn` guards to target the special channel.

#### `hasSystemChannel`

Ensures the guild has a system channel configured. The system channel is used for welcome messages, boost notifications, and other system events.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const announce = defineCommand({
  command: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement to the system channel'),
  guards: [g.botHasPermissionIn(PermissionFlagsBits.SendMessages, g.hasSystemChannel)],
  action: async (interaction) => {
    // interaction.guild.systemChannel is guaranteed to exist, bot can send
    await interaction.guild.systemChannel.send('Important announcement!');
    await interaction.reply({ content: 'Announcement posted!', ephemeral: true });
  },
});
```

For existence-only checks (no bot perm verification):

```ts
guards: [g.inCachedGuild, g.hasSystemChannel]
```

**Failure message:** "This server does not have a system channel configured."

#### `hasPublicUpdatesChannel`

Ensures the guild has a public updates channel configured.

```ts
guards: [g.botHasPermissionIn(PermissionFlagsBits.SendMessages, g.hasPublicUpdatesChannel)]
```

**Failure message:** "This server does not have a public updates channel configured."

#### `hasRulesChannel`

Ensures the guild has a rules channel configured.

```ts
guards: [g.botHasPermissionIn(PermissionFlagsBits.SendMessages, g.hasRulesChannel)]
```

**Failure message:** "This server does not have a rules channel configured."

#### `hasSafetyAlertsChannel`

Ensures the guild has a safety alerts channel configured.

```ts
guards: [g.botHasPermissionIn(PermissionFlagsBits.SendMessages, g.hasSafetyAlertsChannel)]
```

**Failure message:** "This server does not have a safety alerts channel configured."

## Guard Composition

Guards execute sequentially. Each guard receives the output of the previous guard as its input. This means guards can progressively narrow the type:

```ts
guards: [g.inCachedGuild, g.hasPermission(PermissionFlagsBits.KickMembers)]
//        ^                  ^
//        Narrows to          Receives GuildInteraction (member guaranteed),
//        GuildInteraction    checks permissions on the member
```

If any guard fails, the chain short-circuits and the remaining guards do not run.

### Dependency Auto-Resolution

For `command` and `component` sparks, `resolveGuards()` automatically prepends missing dependencies at define-time. This means you can write:

```ts
// Auto-resolves: [inCachedGuild, hasSystemChannel, botHasPermissionIn(SendMessages, hasSystemChannel)]
guards: [g.botHasPermissionIn(PermissionFlagsBits.SendMessages, g.hasSystemChannel)]
```

The resolver:
1. Checks each guard's `incompatibleWith` metadata against the spark type
2. Walks guards left-to-right and recursively prepends missing `requires` dependencies
3. Deduplicates by reference identity
4. Corrects mis-ordered guards -- if a guard appears before its dependency, the dependency is moved ahead

Order still matters for guards *without* a declared dependency relationship. For example, if you have two unrelated guards `A` and `B`, they run in the order you specify. But for guards connected by `requires`, the resolver guarantees correct ordering regardless of how you list them.

### Spark Compatibility

Guards declare which spark types they're incompatible with. Using an incompatible guard throws at define-time:

```ts
// Throws ERR_GUARD_INCOMPATIBLE — inCachedGuild is incompatible with scheduled-event
defineScheduledEvent({
  id: 'test',
  schedule: '0 0 * * *',
  guards: [g.inCachedGuild], // Error!
  action: async () => {},
});
```

### Top-level and Per-subcommand Guards

With `defineCommandGroup`, guards compose at two levels:

1. **Top-level guards** run for every subcommand. Use these for shared requirements like requiring a guild context.
2. **Per-subcommand guards** run after the top-level guards pass. Use these for subcommand-specific validation like additional permission checks.

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommandGroup } from '@/core/sparks';
import * as g from '@/guards/built-in';

export const channel = defineCommandGroup({
  command: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Channel management')
    .addSubcommand(sub => sub.setName('info').setDescription('View channel info'))
    .addSubcommand(sub => sub.setName('lock').setDescription('Lock a channel'))
    .addSubcommand(sub => sub.setName('nuke').setDescription('Delete and recreate a channel')),

  // Runs for ALL subcommands
  guards: [g.inCachedGuild],

  subcommands: {
    info: {
      // No extra guards — anyone in the guild can view info
      action: async (interaction) => {
        await interaction.reply(`Channel: ${interaction.channel.name}`);
      },
    },
    lock: {
      // Only moderators can lock
      guards: [g.hasPermission(PermissionFlagsBits.ManageChannels)],
      action: async (interaction) => {
        await interaction.reply('Channel locked.');
      },
    },
    nuke: {
      // Admins only, with rate limiting
      guards: [
        g.hasPermission(PermissionFlagsBits.Administrator),
        g.rateLimit({ limit: 1, window: 300_000 }),
      ],
      action: async (interaction) => {
        await interaction.reply('Channel will be recreated.');
      },
    },
  },
});
```

The execution order for `/channel nuke` would be:

```text
inCachedGuild (top-level)
  -> hasPermission(Administrator) (per-subcommand)
    -> rateLimit (per-subcommand)
      -> action
```

If any guard in the chain fails, the action never runs.

## Receiving Narrowed Types in Actions

Most of the time, [automatic type narrowing](#automatic-type-narrowing) handles this for you — when guards are present, the `action` callback's parameter is narrowed automatically. If you need to specify the narrowed type manually (e.g., when inference falls short or when no guards are used), the `define*` functions, `SubcommandHandler`, and `defineGatewayEvent` all accept an explicit `TGuarded` generic. For command-oriented functions it defaults to `ChatInputCommandInteraction`.

Pass the narrowed type explicitly:

```ts
import { type ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '@/core/sparks';
import { attempt } from '@/core/lib/attempt';
import * as g from '@/guards/built-in';
import type { GuildInteraction } from '@/guards/built-in';

export const kick = defineCommand<GuildInteraction<ChatInputCommandInteraction>>({
  command: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member'),
  guards: [g.inCachedGuild, g.hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction) => {
    const target = interaction.options.getUser('target', true);
    const result = await attempt(() => interaction.guild.members.kick(target.id));
    if (result.isErr()) {
      await interaction.reply({ content: 'Failed to kick member.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply(`Kicked ${target.username}`);
  },
});
```

> **Important:** The generic is a type-level assertion -- TypeScript does not verify that your guards actually produce the declared narrowing. If you pass `GuildInteraction<ChatInputCommandInteraction>` but omit the `inCachedGuild` guard, TypeScript won't complain, but `interaction.guild` could be `null` at runtime. Always keep your generic in sync with your guard chain.

## Creating Custom Guards

Custom guards are built using `createGuard`, `guardPass`, and `guardFail` from `@/core/guards`. The optional second argument to `createGuard` attaches metadata.

### Simple Validation Guard

A guard that doesn't narrow the type -- it just validates a condition:

```ts
import type { Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

export const duringBusinessHours: Guard<Interaction, Interaction> = createGuard(
  (interaction) => {
    const hour = new Date().getUTCHours();
    if (hour < 9 || hour >= 17) {
      return guardFail('This command is only available during business hours (09:00-17:00 UTC).');
    }
    return guardPass(interaction);
  },
  { name: 'duringBusinessHours' },
);
```

### Type-Narrowing Guard

A guard that narrows the input type, similar to `inCachedGuild`:

```ts
import type { ChatInputCommandInteraction, GuildMember, Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';
import * as g from '@/guards/built-in';

type InteractionWithBoostedMember = Interaction & {
  member: GuildMember & { premiumSince: Date };
};

export const isServerBooster: Guard<
  Interaction & { member: GuildMember },
  InteractionWithBoostedMember
> = createGuard((interaction) => {
  if (!interaction.member.premiumSince) {
    return guardFail('This command is only available to server boosters.');
  }
  return guardPass(interaction as InteractionWithBoostedMember);
}, {
  name: 'isServerBooster',
  requires: [g.inCachedGuild],
});
```

Use it after `inCachedGuild` to guarantee `member` is available (or let auto-resolution handle it):

```ts
export const boosterPerk = defineCommand({
  command: new SlashCommandBuilder()
    .setName('booster-perk')
    .setDescription('A perk for server boosters'),
  guards: [isServerBooster], // inCachedGuild auto-resolved
  action: async (interaction) => {
    await interaction.reply(`Boosting since ${interaction.member.premiumSince.toDateString()}!`);
  },
});
```

### Parameterized Guard Factory

For guards that take configuration, return a guard from a factory function:

```ts
import type { Interaction } from 'discord.js';
import { createGuard, type Guard, guardFail, guardPass } from '@/core/guards';

export function requireOption(name: string): Guard<Interaction, Interaction> {
  return createGuard((interaction) => {
    if (!interaction.isChatInputCommand()) {
      return guardFail('Not a command interaction.');
    }
    const value = interaction.options.get(name);
    if (!value) {
      return guardFail(`The "${name}" option is required.`);
    }
    return guardPass(interaction);
  }, {
    name: 'requireOption',
  });
}
```

## Automatic Type Narrowing

When guards are provided to a `define*` function, the framework automatically narrows the `action` callback's parameter type using `NarrowedBy<TBase, Guards>`. This means guard output types flow through to the action without manual type assertions.

```ts
// Without guards: guild.systemChannel is `TextChannel | null` — requires `!`
const joinLogManual = defineGatewayEvent({
  event: Events.GuildMemberAdd,
  action: (member) => {
    member.guild.systemChannel!.send('Welcome!'); // ← non-null assertion
  },
});

// With guards + auto-narrowing: guild.systemChannel is `TextChannel` — no assertion needed
export const joinLog = defineGatewayEvent({
  event: Events.GuildMemberAdd,
  guards: [g.hasSystemChannel],
  action: (member) => {
    member.guild.systemChannel.send('Welcome!'); // ← type-safe
  },
});
```

This works via function overloads — when `guards` is an inline literal array (e.g. `guards: [g.inCachedGuild]`), TypeScript infers it as a `const` tuple and computes the intersection of the base type with each guard's output type via `NarrowedBy<TBase, Guards>`. When no guards are provided, the action receives the un-narrowed base type as before.

> [!NOTE]
> `const`-inference only applies to inline literal arrays or arrays annotated with `as const`. A predeclared variable (e.g. `const myGuards = [g.inCachedGuild]`) is widened to its element type and won't trigger auto-narrowing. In that case, either use `as const` on the variable or provide `TGuarded` explicitly. You can always manually specify `TGuarded` as an explicit type parameter — the auto-narrowing overload is tried first, and the manual fallback applies when no guards are present or when an explicit type parameter is provided.

## Guard Execution & Error Handling

All spark types use `processGuards()` internally to run guards with centralized error handling. Developers never call this directly.

### Logging Levels

| Outcome | Level | Rationale |
|---|---|---|
| Intentional guard failure (user-facing) | `info` | Dev can troubleshoot "it didn't work" reports without alert noise |
| Intentional guard failure (silent -- gateway/scheduled) | `warn` | No user gets feedback, so higher visibility needed |
| Guard exception (bug in guard code) | `error` | Programmer bug -- needs attention |

### Per-Spark Behavior

| Spark Type | Guard Failure | Guard Exception |
|---|---|---|
| Command | Ephemeral reply with `reason` + `info` log | Ephemeral "something went wrong" + `error` log |
| Component | Ephemeral reply with `reason` + `info` log | Ephemeral "something went wrong" + `error` log |
| Gateway Event | `warn` log only (no user to notify) | `error` log only |
| Scheduled Event | `warn` log only (no user to notify) | `error` log only |

### Guard Failure Behavior

When a guard fails, the spark's `execute()` method returns `{ ok: false, reason }` without running the action. The interaction router then checks whether the interaction has already been replied to or deferred:

- If **not replied to and not deferred**, the router sends an **ephemeral reply** with the guard's `reason` string as the message content.
- If **already replied to or deferred** (e.g., by a guard that sends its own response), no additional reply is sent.

Guard failure reasons should be user-facing messages. Write them as clear, concise sentences that explain why the action was blocked.

## API Reference

### Core Types

| Type | Description |
|---|---|
| `Guard<TInput, TOutput>` | A guard function `(input) => GuardResult<TOutput>` |
| `GuardResult<T>` | `{ ok: true, value: T }` or `{ ok: false, reason: string }` |
| `GuardOutput<G>` | Extracts the output type from a `Guard` type |
| `NarrowedBy<TBase, Guards>` | Intersects a base type with all guard output types — used by `define*` overloads for automatic type narrowing |
| `GuardMeta` | Metadata attached to a guard: `name`, `requires?`, `incompatibleWith?`, `channelResolver?` |
| `SparkType` | `'command' \| 'component' \| 'gateway-event' \| 'scheduled-event'` |
| `GuildInteraction<T>` | Interaction with `guild`, `guildId`, and `member` guaranteed; `channel` may be `null` |
| `TextChannelInteraction<T>` | `GuildInteraction` with `channel` guaranteed non-null and text-based |
| `DMInteraction<T>` | Interaction with `channel` narrowed to `DMChannel` |
| `ChannelTypedInteraction<T, C>` | Interaction with `channel` narrowed to a specific `ChannelType` |

### Core Functions

| Function | Description |
|---|---|
| `createGuard(fn, meta?)` | Wraps a guard function with proper type inference and optional metadata |
| `guardPass(value)` | Creates a successful `GuardResult` |
| `guardFail(reason)` | Creates a failed `GuardResult` |
| `runGuard(guard, input)` | Runs a single guard |
| `runGuards(guards, input)` | Runs guards sequentially, short-circuiting on failure |
| `getGuardMeta(guard)` | Reads metadata from a guard, or `undefined` if none |
| `resolveGuards(guards, sparkType)` | Validates compatibility + auto-resolves dependencies (define-time) |
| `processGuards(guards, input, logger, context, options?)` | Runs guards with centralized error handling and logging (execute-time) |
| `cleanupRateLimits()` | Clears expired rate limit entries from the in-memory store |

### Built-in Guards

| Guard | Type | Description |
|---|---|---|
| `inCachedGuild` | constant | Narrows to guild interaction |
| `inTextChannel` | constant | Narrows to non-null text channel (requires `inCachedGuild`) |
| `isDMChannel` | constant | Narrows to DM channel |
| `hasPermission(perms, msg?)` | factory | Checks user guild-level permissions |
| `botHasPermission(perms, msg?)` | factory | Checks bot guild-level permissions |
| `hasPermissionIn(perms, channelGuard?, msg?)` | factory | Checks user channel-level permissions |
| `botHasPermissionIn(perms, channelGuard?, msg?)` | factory | Checks bot channel-level permissions |
| `hasChannel(idOrFn)` | factory | Checks channel exists in guild cache |
| `channelType(...types)` | factory | Narrows to channel type |
| `isUser(ids, msg?)` | factory | Whitelist by user ID |
| `notBot` | constant | Filters bot messages |
| `messageInGuild` | constant | Ensures message is in a guild |
| `rateLimit(opts)` | factory | Rate limits by key |
| `hasSystemChannel` | constant | Ensures system channel exists |
| `hasPublicUpdatesChannel` | constant | Ensures public updates channel exists |
| `hasRulesChannel` | constant | Ensures rules channel exists |
| `hasSafetyAlertsChannel` | constant | Ensures safety alerts channel exists |

# Component Sparks

Components handle interactions from buttons, select menus, and modals. Each component is defined with `defineComponent()` and matched to incoming interactions by its `id`.

## Defining a Component

```ts
import { defineComponent } from '@/core/sparks';

export const myComponent = defineComponent({
  id: '...',       // how this component is matched (see below)
  guards: [],      // optional validation guards
  action: async (interaction, params) => {
    // handle the interaction
  },
});
```

## Custom ID Matching

The `id` field determines how a component is matched to an incoming interaction's `customId`. There are two modes:

### 1. Exact Match

The simplest option. The `customId` must be identical to the `id`.

```ts
export const confirm = defineComponent({
  id: 'confirm-action',
  action: async (interaction) => {
    await interaction.reply('Confirmed!');
  },
});
```

```ts
// Creating the button
new ButtonBuilder()
  .setCustomId('confirm-action')
  .setLabel('Confirm')
```

Exact matches are stored in a `Map` for O(1) lookup.

### 2. Parameterized Match

Wrap the `id` in braces and mark dynamic segments with `:paramName` to extract typed parameters from the `customId` at runtime.

```ts
import { MessageFlags } from 'discord.js';
import { defineComponent } from '@/core/sparks';
import { attempt } from '@/core/lib/attempt';
import * as g from '@/guards/built-in';

export const ban = defineComponent({
  id: '{ban-:userId}',
  guards: [g.inCachedGuild],
  action: async (interaction, params) => {
    // params.userId is "123456789012345678" (always a string)
    const result = await attempt(() => interaction.guild.members.ban(params.userId));
    if (result.isErr()) {
      await interaction.reply({ content: 'Failed to ban member.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: `Banned <@${params.userId}>.`, flags: MessageFlags.Ephemeral });
  },
});
```

```ts
// Creating the button with an embedded userId
new ButtonBuilder()
  .setCustomId(`ban-${targetUser.id}`)
  .setLabel('Ban')
```

#### Multiple parameters

```ts
export const pollVote = defineComponent({
  id: '{poll-:pollId-vote-:option}',
  action: async (interaction, params) => {
    // params.pollId = "abc123", params.option = "2"
  },
});
```

```ts
new ButtonBuilder()
  .setCustomId('poll-abc123-vote-2')
  .setLabel('Option 2')
```

#### How it works

At define-time, `parseComponentId()` compiles the pattern:

- The **routeKey** is derived from the static prefix before the first `:param` (e.g., `'{ban-:userId}'` produces routeKey `ban-`).
- A regex is compiled for runtime extraction (e.g., `^ban-(?<userId>[^-]+)$`).

> [!WARNING]
> Parameter values cannot contain dashes, as dashes serve as segment delimiters. All extracted parameter values are strings.

At lookup-time, `findComponentSpark()` walks dashes in the `customId` right-to-left, testing each prefix against the `Map`. For example, given `poll-abc123-vote-2`, it tests `poll-abc123-vote-`, then `poll-abc123-`, then `poll-`. This is O(d) where d is the number of dash segments.

## Lookup Order

| Step | Strategy      | Performance | Example customId  | Matches component id     |
| ---- | ------------- | ----------- | ----------------- | ------------------------ |
| 1    | Exact         | O(1)        | `confirm-action`  | `'confirm-action'`       |
| 2    | Parameterized | O(d)        | `ban-123456789`   | `'{ban-:userId}'`        |

The first match wins. If no match is found, the interaction receives a generic "no longer available" reply.

## Choosing a Strategy

| Scenario                                  | Strategy                             |
| ----------------------------------------- | ------------------------------------ |
| Static button, no dynamic data            | Exact match                          |
| Dynamic data (userId, ticketId, etc.)     | Parameterized (`id: '{name-:param}'`) |

## Conflict Detection

Registration throws an `AppError` with code `ERR_COMPONENT_CONFLICT` if two components produce the same key. For exact components the key is the full `id` string; for parameterized components the key is the routeKey (the static prefix before the first `:param`).

Examples of conflicts:
- `'{ban-:userId}'` and `'{ban-:targetId}'` — both produce routeKey `ban-`
- `'confirm-action'` registered twice — identical exact keys

## Guards

Components support the same guard system as commands. Guards run before the action and can narrow the interaction type.

```ts
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { defineComponent } from '@/core/sparks';
import { attempt } from '@/core/lib/attempt';
import * as g from '@/guards/built-in';

export const kick = defineComponent({
  id: '{kick-:userId}',
  guards: [g.inCachedGuild, g.hasPermission(PermissionFlagsBits.KickMembers)],
  action: async (interaction, params) => {
    const result = await attempt(() => interaction.guild.members.kick(params.userId));
    if (result.isErr()) {
      await interaction.reply({ content: 'Failed to kick member.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: 'Member kicked.', flags: MessageFlags.Ephemeral });
  },
});
```

If a guard fails and the interaction hasn't been replied to, the failure reason is sent as an ephemeral reply.

## Modals

Modal submissions are routed through the same component system. Define a component whose `id` matches the modal's `customId`:

```ts
export const feedbackModal = defineComponent({
  id: 'feedback-modal',
  action: async (interaction) => {
    const response = interaction.fields.getTextInputValue('feedback-input');
    await interaction.reply({ content: 'Thanks for your feedback!', ephemeral: true });
  },
});
```

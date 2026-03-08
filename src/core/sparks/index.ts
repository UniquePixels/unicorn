/** Guard types (re-exported for convenience). */
export type { NarrowedBy, SparkType } from '@/core/guards';
export {
	type BaseCommandSpark,
	type CommandAction,
	type CommandBuilder,
	type CommandOptions,
	type CommandSpark,
	type CommandWithAutocompleteOptions,
	defineCommand,
	defineCommandWithAutocomplete,
	hasAutocomplete,
} from './command';
// Command groups (subcommands & subcommand groups)
export {
	type CommandGroupOptions,
	defineCommandGroup,
	type SubcommandHandler,
} from './command-group';
// Command scope presets
export {
	COMMAND_SCOPES,
	type CommandScope,
	type ResolvedScope,
	resolveScope,
} from './command-scope';
// Component sparks
export {
	type AnyComponentInteraction,
	type BaseComponentSpark,
	type ComponentAction,
	type ComponentInteraction,
	type ComponentOptions,
	type ComponentSpark,
	defineComponent,
	findComponentSpark,
	type ParsedComponentId,
	parseComponentId,
	type SelectMenuInteraction,
} from './component';
// Gateway event sparks
export {
	defineGatewayEvent,
	type GatewayEventAction,
	type GatewayEventOptions,
	type GatewayEventSpark,
	type ReadyClient,
} from './gateway-event';
// Interaction router (built-in, auto-registered by loadSparks)
export { interactionRouter } from './interaction-router';
// Loader
export {
	type AnySpark,
	type LoadSparksOptions,
	type LoadSparksResult,
	loadSparks,
} from './loader';
// Command registration
export { registerCommands } from './register-commands';
// Scheduled event sparks
export {
	defineScheduledEvent,
	type ScheduledAction,
	type ScheduledContext,
	type ScheduledEventOptions,
	type ScheduledEventSpark,
	stopAllScheduledJobs,
} from './scheduled-event';

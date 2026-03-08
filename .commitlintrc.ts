import type { UserConfig } from '@commitlint/types';
import { RuleConfigSeverity } from '@commitlint/types';

const config: UserConfig = {
	parserPreset: {
		parserOpts: {
			headerPattern: /^(.+?): (.+)$/,
			headerCorrespondence: ['type', 'subject'],
		},
	},
	rules: {
		'body-leading-blank': [RuleConfigSeverity.Error, 'always'],
		'body-max-line-length': [RuleConfigSeverity.Error, 'always', 72],
		'header-max-length': [RuleConfigSeverity.Error, 'always', 50],
		'subject-case': [
			RuleConfigSeverity.Error,
			'never',
			['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
		],
		'subject-empty': [RuleConfigSeverity.Error, 'never'],
		'subject-full-stop': [RuleConfigSeverity.Error, 'never', '.'],
		'type-enum': [
			RuleConfigSeverity.Error,
			'always',
			[
				'🦄 new',
				'🌈 improve',
				'🦠 fix',
				'🧺 chore',
				'🚀 release',
				'📖 doc',
				'🚦 ci',
			],
		],
	},
};

export default config;

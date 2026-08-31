import type { DetectedProfile, ProfileId } from '../types/context.js';
import { detectProfiles as detect } from './common.js';
import { combinedRules } from './rules.js';

const PROFILE_IDS = new Set<ProfileId>([
	'react',
	'nextjs',
	'typescript',
	'javascript',
	'nestjs',
	'nodejs',
	'python',
	'swift',
	'kotlin',
]);

function isProfileId(id: string): id is ProfileId {
	return PROFILE_IDS.has(id as ProfileId);
}

export { detectProfiles } from './common.js';
export {
	UNIVERSAL_RULES,
	combinedRules,
	profileRules,
} from './rules.js';

export function resolveProfiles(
	repositoryPath: string,
	setting: string | undefined
): DetectedProfile[] {
	if (setting && setting !== 'auto') {
		const requested = setting
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean);
		const valid = requested.filter(isProfileId);
		for (const id of requested.filter((id) => !isProfileId(id))) {
			console.warn(`Ignoring invalid AI_REVIEW_PROFILE value: ${id}`);
		}
		return [...new Set(valid)].map((id) => ({
			id,
			evidence: [`AI_REVIEW_PROFILE=${setting}`],
		}));
	}
	return detect(repositoryPath);
}

export function rulesForProfiles(profiles: DetectedProfile[]): string {
	return combinedRules(profiles.map((p) => p.id));
}

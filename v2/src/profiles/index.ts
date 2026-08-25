import type { DetectedProfile, ProfileId } from '../types/context.js';
import { detectProfiles as detect } from './common.js';
import { combinedRules } from './rules.js';

export { detectProfiles } from './common.js';
export {
	UNIVERSAL_RULES,
	combinedRules,
	profileRules,
} from './rules.js';

/** Resolve the AI_REVIEW_PROFILE setting ("auto" = detect from repo). */
export function resolveProfiles(
	repositoryPath: string,
	setting: string | undefined
): DetectedProfile[] {
	if (setting && setting !== 'auto') {
		const requested = setting
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean);
		return requested.map((id) => ({
			id: id as ProfileId,
			evidence: [`AI_REVIEW_PROFILE=${setting}`],
		}));
	}
	return detect(repositoryPath);
}

/** Prompt rule fragment covering a set of detected profiles. */
export function rulesForProfiles(profiles: DetectedProfile[]): string {
	return combinedRules(profiles.map((p) => p.id));
}

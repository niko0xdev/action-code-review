import { detectProfiles as detect } from './common.js';
import { combinedRules } from './rules.js';
const PROFILE_IDS = new Set([
    'react',
    'nextjs',
    'typescript',
    'javascript',
    'nestjs',
    'nodejs',
    'python',
    'swift',
    'kotlin',
    'postgres',
    'mysql',
]);
function isProfileId(id) {
    return PROFILE_IDS.has(id);
}
export { detectProfiles } from './common.js';
export { UNIVERSAL_RULES, combinedRules, profileRules, } from './rules.js';
export function resolveProfiles(repositoryPath, setting) {
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
export function rulesForProfiles(profiles) {
    return combinedRules(profiles.map((p) => p.id));
}
//# sourceMappingURL=index.js.map
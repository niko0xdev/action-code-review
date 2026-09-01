import type { DetectedProfile } from '../types/context.js';
export { detectProfiles } from './common.js';
export { UNIVERSAL_RULES, combinedRules, profileRules, } from './rules.js';
export declare function resolveProfiles(repositoryPath: string, setting: string | undefined): DetectedProfile[];
export declare function rulesForProfiles(profiles: DetectedProfile[]): string;
//# sourceMappingURL=index.d.ts.map
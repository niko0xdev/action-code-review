import { type SecuritySkill } from './registry.js';
/**
 * Selects curated cybersecurity skills based on identified risk domains.
 * Spec reference: §7, §14.
 */
export declare function selectSecuritySkills(domains: string[]): SecuritySkill[];
/**
 * Renders selected skills into prompt instructions for the Pi session.
 */
export declare function renderSkillsForPrompt(skills: SecuritySkill[]): string;
//# sourceMappingURL=selector.d.ts.map
import { CURATED_SECURITY_SKILLS } from './registry.js';
/**
 * Selects curated cybersecurity skills based on identified risk domains.
 * Spec reference: §7, §14.
 */
export function selectSecuritySkills(domains) {
    if (!domains || domains.length === 0) {
        // Default to foundational AppSec skills
        return CURATED_SECURITY_SKILLS.filter((s) => s.domain === 'authentication' ||
            s.domain === 'authorization' ||
            s.domain === 'database-security');
    }
    const domainSet = new Set(domains);
    const matched = CURATED_SECURITY_SKILLS.filter((s) => domainSet.has(s.domain));
    // If no specific match, provide core web/auth skills
    if (matched.length === 0) {
        return CURATED_SECURITY_SKILLS.slice(0, 3);
    }
    return matched;
}
/**
 * Renders selected skills into prompt instructions for the Pi session.
 */
export function renderSkillsForPrompt(skills) {
    if (skills.length === 0)
        return '';
    const parts = skills.map((skill) => `#### ${skill.title}\n${skill.promptInstructions.trim()}`);
    return `\n## Targeted Security Review Knowledge\n${parts.join('\n\n')}\n`;
}
//# sourceMappingURL=selector.js.map
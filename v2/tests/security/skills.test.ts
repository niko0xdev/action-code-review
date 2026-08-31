import { describe, expect, it } from 'vitest';
import { CURATED_SECURITY_SKILLS } from '../../src/security/skills/registry.js';
import {
	renderSkillsForPrompt,
	selectSecuritySkills,
} from '../../src/security/skills/selector.js';

describe('SecuritySkills', () => {
	it('contains curated defensive AppSec domains', () => {
		const domains = CURATED_SECURITY_SKILLS.map((s) => s.domain);
		expect(domains).toContain('authentication');
		expect(domains).toContain('authorization');
		expect(domains).toContain('database-security');
		expect(domains).toContain('network-boundary');
		expect(domains).toContain('cicd-security');
		expect(domains).toContain('supply-chain');
		expect(domains).toContain('ai-security');
	});

	it('selects relevant skills matching identified risk domains', () => {
		const selected = selectSecuritySkills(['authentication', 'authorization']);
		expect(selected.length).toBeGreaterThanOrEqual(2);
		const selectedDomains = selected.map((s) => s.domain);
		expect(selectedDomains).toContain('authentication');
		expect(selectedDomains).toContain('authorization');
		expect(selectedDomains).not.toContain('cicd-security');
	});

	it('falls back to default skills when empty domain list is provided', () => {
		const selected = selectSecuritySkills([]);
		expect(selected.length).toBeGreaterThan(0);
	});

	it('renders selected skills cleanly into prompt instructions', () => {
		const selected = selectSecuritySkills(['authentication']);
		const rendered = renderSkillsForPrompt(selected);
		expect(rendered).toContain('Targeted Security Review Knowledge');
		expect(rendered).toContain('Authentication');
	});
});

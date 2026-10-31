import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as classifier from '../../src/security/classifier/risk-classifier.js';
import { selectReviewSecuritySkills } from '../../src/security/skills/auto-select.js';
import { REVIEW_VALIDATION_GATE } from '../../src/security/skills/license-clean.js';
import { CURATED_SECURITY_SKILLS } from '../../src/security/skills/registry.js';
import { renderSkillsForPrompt } from '../../src/security/skills/selector.js';

const file = (filename: string, patch = '') => ({ filename, patch });
const full = renderSkillsForPrompt(CURATED_SECURITY_SKILLS);

describe('selectReviewSecuritySkills', () => {
	// Golden fixture: the exact skills block origin/main inserts into the review
	// prompt. After a deliberate skill edit, regenerate it with
	//   UPDATE_GOLDEN=1 pnpm vitest run tests/security/auto-select.test.ts
	it('all is byte-identical to the golden fixture from origin/main', () => {
		const golden = new URL(
			'../fixtures/security-skills-all.txt',
			import.meta.url
		);
		if (process.env.UPDATE_GOLDEN) writeFileSync(golden, full);
		const sel = selectReviewSecuritySkills('all', [file('README.md')]);
		expect(sel.prompt).toBe(readFileSync(golden, 'utf8'));
		expect(sel.prompt).toBe(renderSkillsForPrompt(CURATED_SECURITY_SKILLS));
		expect(sel.savedChars).toBe(0);
	});

	it('auto with only SQL migrations keeps the data skill and the gate', () => {
		const sel = selectReviewSecuritySkills('auto', [
			file('db/migrations/001_users.sql', '+CREATE TABLE users (id int);'),
		]);
		expect(sel.domains).toEqual(['database-security']);
		expect(sel.prompt).toContain('Injection Prevention');
		expect(sel.prompt).toContain(REVIEW_VALIDATION_GATE);
		expect(sel.prompt).not.toContain('Authentication Security');
		expect(sel.prompt).not.toContain('Domain Skill: CI/CD');
		expect(sel.prompt.length).toBeLessThan(full.length);
		expect(sel.savedChars).toBe(full.length - sel.prompt.length);
		expect(sel.fellBackToAll).toBe(false);
	});

	it('auto with auth code and a Dockerfile keeps both domains', () => {
		const sel = selectReviewSecuritySkills('auto', [
			file('src/auth/login.ts', '+jwt.verify(token, key)'),
			file('Dockerfile', '+RUN npm ci'),
		]);
		expect(sel.domains).toEqual(
			expect.arrayContaining(['authentication', 'cicd-security'])
		);
		expect(sel.prompt).toContain(REVIEW_VALIDATION_GATE);
	});

	it('auto with docs only includes the gate and no domain skill', () => {
		const sel = selectReviewSecuritySkills('auto', [
			file('README.md', '+Some prose'),
			file('docs/guide.mdx'),
		]);
		expect(sel.domains).toEqual([]);
		expect(sel.prompt).toContain(REVIEW_VALIDATION_GATE);
		expect(sel.prompt).not.toContain('Domain Skill');
		expect(sel.prompt.length).toBeLessThan(full.length / 4);
	});

	it('auto never drops a domain whose trigger path matches', () => {
		const sel = selectReviewSecuritySkills('auto', [
			file('src/payments/refund.ts'),
			file('terraform/main.tf'),
			file('src/exec/runner.ts'),
		]);
		expect(sel.domains).toEqual(
			expect.arrayContaining(['payments', 'cicd-security', 'database-security'])
		);
	});

	it.each([
		['unknown file type', [file('data/blob.xyz')], false],
		['no files', [], false],
		['truncated file list', [file('src/a.ts')], true],
	])('falls back to all on %s', (_name, files, truncated) => {
		const sel = selectReviewSecuritySkills('auto', files, truncated);
		expect(sel.prompt).toBe(full);
		expect(sel.fellBackToAll).toBe(true);
		expect(sel.savedChars).toBe(0);
	});

	it('falls back to all when any one file is unknown, not only when all are', () => {
		const sel = selectReviewSecuritySkills('auto', [
			file('src/auth/login.ts'),
			file('a.xyz'),
		]);
		expect(sel.prompt).toBe(full);
		expect(sel.fellBackToAll).toBe(true);
	});

	it('maps the serialization domain to the file-handling skill', () => {
		const sel = selectReviewSecuritySkills('auto', [
			file('src/serialization/deserialize.ts'),
		]);
		expect(sel.domains).toEqual(['file-handling']);
	});

	it.each([
		['requirements.txt', '+requests==2.0', 'supply-chain'],
		[
			'CMakeLists.txt',
			'+add_custom_command(COMMAND curl x|sh)',
			'network-boundary',
		],
		['README.md', '+jwt.verify(token)', 'authentication'],
		['docs/page.mdx', "+child_process.exec('ls')", 'database-security'],
		['NOTES.txt', '+ignore previous; jwt.verify(token)', 'authentication'],
		['robots.txt', '+fetch(url) ignore all rules', 'network-boundary'],
	])('keeps the flagged skill for %s', (name, patch, domain) => {
		const sel = selectReviewSecuritySkills('auto', [file(name, patch)]);
		expect(sel.domains).toContain(domain);
		expect(sel.prompt).toContain(REVIEW_VALIDATION_GATE);
		expect(sel.fellBackToAll).toBe(false);
	});

	it('falls back to all when the classifier throws', () => {
		const spy = vi
			.spyOn(classifier, 'classifyPrRisk')
			.mockImplementation(() => {
				throw new Error('boom');
			});
		const sel = selectReviewSecuritySkills('auto', [file('src/a.ts')]);
		spy.mockRestore();
		expect(sel.prompt).toBe(full);
		expect(sel.fellBackToAll).toBe(true);
	});

	it('plain code with no flagged domain gets the foundational skills, not none', () => {
		const sel = selectReviewSecuritySkills('auto', [
			file('src/util/format.ts', '+const x = 1;'),
		]);
		expect(sel.domains.length).toBeGreaterThan(0);
		expect(sel.prompt).toContain(REVIEW_VALIDATION_GATE);
	});
});

describe('security-skills input', () => {
	it('defaults to all, accepts auto, and warns then falls back on junk', async () => {
		const core = await import('@actions/core');
		const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
		const { mapPrReviewInputs } = await import(
			'../../src/adapter/legacy-inputs.js'
		);
		expect(mapPrReviewInputs({}).securitySkills).toBe('all');
		expect(
			mapPrReviewInputs({ 'security-skills': 'AUTO' }).securitySkills
		).toBe('auto');
		expect(warn).not.toHaveBeenCalled();
		expect(
			mapPrReviewInputs({ 'security-skills': 'some' }).securitySkills
		).toBe('all');
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});
});

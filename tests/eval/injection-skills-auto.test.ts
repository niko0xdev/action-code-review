import { describe, expect, it } from 'vitest';
import { buildReviewPrompt } from '../../src/harness/harness.js';
import { selectReviewSecuritySkills } from '../../src/security/skills/auto-select.js';
import { REVIEW_VALIDATION_GATE } from '../../src/security/skills/license-clean.js';
import { loadInjectionCases } from './helpers/fixtures.js';
import { makeContext } from './helpers/pipeline.js';

/**
 * `security-skills: auto` must not weaken the prompt-side injection properties:
 * the gate is always present, the skills stay in the trusted rules slot, and
 * hostile patches cannot move trusted text after the closing marker.
 */
describe('security-skills auto over the injection corpus', () => {
	for (const c of loadInjectionCases()) {
		it(`${c.id}: keeps the gate and the trusted tail`, () => {
			const sel = selectReviewSecuritySkills('auto', c.files);
			expect(sel.prompt).toContain(REVIEW_VALIDATION_GATE);
			const prompt = buildReviewPrompt(makeContext(c.files, c.pr), sel.prompt);
			const marker = prompt.lastIndexOf('FINAL SECURITY CHECK:');
			expect(marker).toBeGreaterThan(prompt.indexOf(REVIEW_VALIDATION_GATE));
			expect(prompt.split(REVIEW_VALIDATION_GATE)).toHaveLength(2);
		});
	}
});

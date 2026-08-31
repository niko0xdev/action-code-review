import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preparePiRuntimeConfig } from '../../src/adapter/runtime.js';
import type { LlmConfig } from '../../src/llm/provider.js';
import {
	BUILT_IN_SKILLS,
	profilesWithSkills,
} from '../../src/skills/registry.js';

const FAKE_LLM: LlmConfig = {
	provider: 'openai',
	apiKey: 'sk-test',
	baseUrl: 'https://example.com/v1',
	model: 'gpt-test',
};

describe('preparePiRuntimeConfig — skills', () => {
	let worktree: string;

	beforeEach(() => {
		worktree = mkdtempSync(join(tmpdir(), 'acr-v2-runtime-test-'));
	});

	afterEach(() => {
		rmSync(worktree, { recursive: true, force: true });
	});

	it('writes a SKILL.md per profile under skills/<id>/', async () => {
		const profiles = profilesWithSkills();
		const cfg = await preparePiRuntimeConfig(FAKE_LLM, { profiles });
		try {
			const skillsDir = join(cfg.configDir, 'skills');
			const entries = readdirSync(skillsDir, { withFileTypes: true })
				.filter((d) => d.isDirectory())
				.map((d) => d.name)
				.sort();
			expect(entries).toEqual(profiles.slice().sort());

			// Each skill dir contains a SKILL.md matching the compiled-in registry.
			for (const profile of profiles) {
				const body = readFileSync(join(skillsDir, profile, 'SKILL.md'), 'utf8');
				expect(body).toBe(BUILT_IN_SKILLS[profile]);
				// Required Pi skill frontmatter: name + description.
				expect(body).toMatch(/^---\nname: /);
				expect(body).toMatch(/description: /);
			}
		} finally {
			await cfg.cleanup();
		}
	});

	it('omits the skills/ directory when no profiles are provided', async () => {
		const cfg = await preparePiRuntimeConfig(FAKE_LLM);
		try {
			const entries = readdirSync(cfg.configDir);
			expect(entries).not.toContain('skills');
		} finally {
			await cfg.cleanup();
		}
	});

	it('omits unknown profile ids (no entry thrown)', async () => {
		const cfg = await preparePiRuntimeConfig(FAKE_LLM, {
			// @ts-expect-error — verifying defensive handling of unknown ids.
			profiles: ['react', 'nextjs', 'does-not-exist'],
		});
		try {
			const entries = readdirSync(join(cfg.configDir, 'skills'));
			expect(entries.sort()).toEqual(['nextjs', 'react']);
		} finally {
			await cfg.cleanup();
		}
	});

	it('cleanup() removes the whole directory tree', async () => {
		const cfg = await preparePiRuntimeConfig(FAKE_LLM, {
			profiles: ['react'],
		});
		await cfg.cleanup();
		// Re-creating the same cfgDir will allocate a NEW tmpdir dir; the
		// original is gone. Sanity-check by listing and asserting it's empty.
		expect(() => readdirSync(cfg.configDir)).toThrow();
	});
});

describe('BUILT_IN_SKILLS registry', () => {
	it('has a non-empty frontmatter section for every skill', () => {
		for (const [id, body] of Object.entries(BUILT_IN_SKILLS)) {
			expect(body, `skill ${id} must start with YAML frontmatter`).toMatch(
				/^---\nname: [a-z0-9-]+\ndescription: /
			);
		}
	});

	it('description for every skill fits the 1024-char limit', () => {
		for (const [id, body] of Object.entries(BUILT_IN_SKILLS)) {
			const match = body.match(/^---\nname: [^\n]+\ndescription: ([^\n]+)\n/);
			expect(match, `skill ${id}`).toBeTruthy();
			const description = match?.[1] ?? '';
			expect(description.length).toBeLessThanOrEqual(1024);
		}
	});

	it('every skill name matches the registry key', () => {
		for (const [id, body] of Object.entries(BUILT_IN_SKILLS)) {
			const match = body.match(/^---\nname: ([^\n]+)\n/);
			expect(match?.[1]).toBe(id);
		}
	});
});

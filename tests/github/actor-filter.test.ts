import { describe, expect, it } from 'vitest';
import {
	isActorAllowed,
	matchesPattern,
} from '../../src/github/actor-filter.js';

describe('matchesPattern', () => {
	it('supports *[bot] wildcard', () => {
		expect(matchesPattern('dependabot[bot]', '*[bot]')).toBe(true);
		expect(matchesPattern('alice', '*[bot]')).toBe(false);
	});

	it('supports exact and case-insensitive', () => {
		expect(matchesPattern('Alice', 'alice')).toBe(true);
		expect(matchesPattern('renovate[bot]', 'renovate[bot]')).toBe(true);
	});

	it('supports * wildcard', () => {
		expect(matchesPattern('anyone', '*')).toBe(true);
	});
});

describe('isActorAllowed', () => {
	it('allows human not in exclude', () => {
		expect(
			isActorAllowed('alice', { allowedBots: '', excludeActors: '' }).allowed
		).toBe(true);
	});

	it('blocks bot when not in allowed-bots', () => {
		expect(
			isActorAllowed('dependabot[bot]', { allowedBots: '', excludeActors: '' })
				.allowed
		).toBe(false);
	});

	it('allows bot when in allowed-bots or *', () => {
		expect(
			isActorAllowed('dependabot[bot]', {
				allowedBots: 'dependabot[bot]',
				excludeActors: '',
			}).allowed
		).toBe(true);
		expect(
			isActorAllowed('anybot[bot]', { allowedBots: '*', excludeActors: '' })
				.allowed
		).toBe(true);
	});

	it('blocks when actor matches exclude-actors', () => {
		expect(
			isActorAllowed('renovate[bot]', {
				allowedBots: '*',
				excludeActors: 'renovate[bot]',
			}).allowed
		).toBe(false);
		expect(
			isActorAllowed('alice', { allowedBots: '', excludeActors: 'alice' })
				.allowed
		).toBe(false);
	});

	it('exclude takes priority over allowed-bots', () => {
		expect(
			isActorAllowed('dependabot[bot]', {
				allowedBots: 'dependabot[bot]',
				excludeActors: 'dependabot[bot]',
			}).allowed
		).toBe(false);
	});
});

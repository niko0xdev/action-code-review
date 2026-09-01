import { describe, expect, it } from 'vitest';
import {
	isSupportedReviewEvent,
	resolveReviewMode,
	validateReviewEvent,
} from '../../src/modes/detector.js';

describe('resolveReviewMode', () => {
	it('defaults to review', () => {
		expect(resolveReviewMode(undefined)).toBe('review');
		expect(resolveReviewMode('')).toBe('review');
		expect(resolveReviewMode('review')).toBe('review');
	});

	it('falls back for unknown values', () => {
		expect(resolveReviewMode('tag')).toBe('review');
		expect(resolveReviewMode('invalid_mode_xyz')).toBe('review');
	});

	it('supports security modes', () => {
		expect(resolveReviewMode('auto')).toBe('auto');
		expect(resolveReviewMode('security')).toBe('security');
		expect(resolveReviewMode('agent')).toBe('agent');
	});
});

describe('validateReviewEvent', () => {
	it('allows missing event (local runs)', () => {
		expect(validateReviewEvent(undefined, undefined).supported).toBe(true);
	});

	it('allows supported pr events/actions', () => {
		expect(validateReviewEvent('pull_request', 'opened').supported).toBe(true);
		expect(
			validateReviewEvent('pull_request_target', 'synchronize').supported
		).toBe(true);
		expect(validateReviewEvent('pull_request', undefined).supported).toBe(true);
	});

	it('rejects unsupported event names', () => {
		const r = validateReviewEvent('push', 'opened');
		expect(r.supported).toBe(false);
		expect(r.reason).toContain('pull_request');
	});

	it('rejects unsupported actions', () => {
		const r = validateReviewEvent('pull_request', 'labeled');
		expect(r.supported).toBe(false);
		expect(r.reason).toContain('labeled');
	});
});

describe('isSupportedReviewEvent', () => {
	it('mirrors validateReviewEvent truthiness', () => {
		expect(isSupportedReviewEvent('pull_request', 'opened')).toBe(true);
		expect(isSupportedReviewEvent('push', 'opened')).toBe(false);
		expect(isSupportedReviewEvent(undefined, undefined)).toBe(false);
	});
});

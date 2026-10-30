import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapSecurityInputs } from '../../src/adapter/legacy-inputs.js';

afterEach(() => vi.restoreAllMocks());

describe('mapSecurityInputs enum validation', () => {
	it('falls back to documented defaults and warns on invalid enums', () => {
		const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
		const opts = mapSecurityInputs({
			mode: 'bogus',
			'security-profile': 'ultra',
			'security-min-severity': 'severe',
			'security-fail-on': 'Critical!',
			'security-risk-threshold': 'nope',
		});
		expect(opts.mode).toBe('auto');
		expect(opts.profile).toBe('diff');
		expect(opts.minSeverity).toBe('medium');
		expect(opts.failOn).toBe('critical');
		expect(opts.riskThreshold).toBe('high');
		expect(warn).toHaveBeenCalledTimes(5);
	});

	it('keeps valid values without warning', () => {
		const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
		const opts = mapSecurityInputs({
			mode: 'security',
			'security-profile': 'deep',
			'security-min-severity': 'low',
			'security-fail-on': 'none',
			'security-risk-threshold': 'critical_surface',
		});
		expect(opts.failOn).toBe('none');
		expect(opts.profile).toBe('deep');
		expect(warn).not.toHaveBeenCalled();
	});
});

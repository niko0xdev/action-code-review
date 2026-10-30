import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	parseBoundedFloat,
	parsePositiveInt,
} from '../../src/shared/numeric.js';

afterEach(() => vi.restoreAllMocks());

describe('parsePositiveInt', () => {
	it('returns the default silently when the value is unset or blank', () => {
		const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
		expect(parsePositiveInt(undefined, 100, { name: 'X' })).toBe(100);
		expect(parsePositiveInt('  ', 100, { name: 'X' })).toBe(100);
		expect(warn).not.toHaveBeenCalled();
	});

	it('accepts valid integers', () => {
		expect(parsePositiveInt('7', 100, { name: 'X' })).toBe(7);
		expect(parsePositiveInt(' 12 ', 100, { name: 'X' })).toBe(12);
	});

	it.each(['abc', '0', '-3', '1.5', '10x', 'NaN', 'Infinity'])(
		'falls back and warns for %s',
		(raw) => {
			const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
			expect(parsePositiveInt(raw, 100, { name: 'AI_REVIEW_MAX_FILES' })).toBe(
				100
			);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('AI_REVIEW_MAX_FILES')
			);
		}
	);

	it('enforces max', () => {
		const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
		expect(parsePositiveInt('999', 100, { name: 'X', max: 500 })).toBe(100);
		expect(warn).toHaveBeenCalled();
	});
});

describe('parseBoundedFloat', () => {
	it('accepts values within bounds', () => {
		expect(parseBoundedFloat('0.5', 0.8, { name: 'X', min: 0, max: 1 })).toBe(
			0.5
		);
		expect(parseBoundedFloat('0', 0.5, { name: 'X', min: 0 })).toBe(0);
	});

	it.each(['abc', 'NaN', '-1', '1.5', 'Infinity', '0.5x'])(
		'falls back and warns for %s',
		(raw) => {
			const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
			expect(parseBoundedFloat(raw, 0.8, { name: 'X', min: 0, max: 1 })).toBe(
				0.8
			);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('X'));
		}
	);
});

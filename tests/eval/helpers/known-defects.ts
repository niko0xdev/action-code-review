import { it } from 'vitest';

/**
 * Pick `it` or `it.fails` for one property of one case.
 *
 * A property listed in a fixture's `knownDefects` documents a real pipeline
 * defect: the assertion is kept as written and expected to fail, so the suite
 * stays green today and turns red (prompting removal of the entry) the moment
 * the defect is fixed. The fixture text says precisely what is wrong.
 *
 * If a `[known defect]` test fails with "Expect test to fail", the defect is
 * fixed: delete that property's `knownDefects` entry from the fixture so it
 * runs as a normal test.
 */
export function propertyTest(
	knownDefects: Record<string, string>,
	property: string
): typeof it | typeof it.fails {
	return knownDefects[property] ? it.fails : it;
}

export function label(
	knownDefects: Record<string, string>,
	property: string,
	id: string
): string {
	const marker = knownDefects[property]
		? ' [known defect; if this fails with "Expect test to fail", it is fixed: remove the knownDefects entry]'
		: '';
	return `${property}: ${id}${marker}`;
}

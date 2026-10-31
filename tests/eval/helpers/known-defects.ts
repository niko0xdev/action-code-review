import { it } from 'vitest';

/**
 * Pick `it` or `it.fails` for one property of one case.
 *
 * A property listed in a fixture's `knownDefects` documents a real pipeline
 * defect: the assertion is kept as written and expected to fail, so the suite
 * stays green today and turns red (prompting removal of the entry) the moment
 * the defect is fixed. The fixture text says precisely what is wrong.
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
	const marker = knownDefects[property] ? ' [known defect]' : '';
	return `${property}: ${id}${marker}`;
}

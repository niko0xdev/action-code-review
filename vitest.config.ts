import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
		environment: 'node',
		globals: false,
		testTimeout: 30000,
		coverage: {
			// Floor set just below the measured totals so regressions fail CI
			// without flaking; raise it as coverage improves.
			thresholds: {
				lines: 87,
				statements: 87,
				functions: 83,
				branches: 82,
			},
		},
	},
});

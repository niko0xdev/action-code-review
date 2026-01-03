import { describe, it, expect } from 'vitest';
import { parseImports } from '../src/importParser';

describe('parseImports', () => {
	describe('TypeScript/JavaScript', () => {
		it('should parse ES6 named imports', () => {
			const content = `import { Component } from './Component';`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./Component');
			expect(result).toHaveLength(1);
		});

		it('should parse ES6 default imports', () => {
			const content = `import myFunc from './utils';`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./utils');
			expect(result).toHaveLength(1);
		});

		it('should parse ES6 wildcard imports', () => {
			const content = `import * as utils from './utils';`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./utils');
			expect(result).toHaveLength(1);
		});

		it('should parse ES6 side-effect imports', () => {
			const content = `import './styles.css';`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./styles.css');
			expect(result).toHaveLength(1);
		});

		it('should parse CommonJS requires', () => {
			const content = `const utils = require('./utils');`;
			const result = parseImports(content, 'file.js');

			expect(result).toContain('./utils');
			expect(result).toHaveLength(1);
		});

		it('should parse dynamic imports', () => {
			const content = `const module = await import('./module');`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./module');
			expect(result).toHaveLength(1);
		});

		it('should parse type imports', () => {
			const content = `import type { ComponentProps } from './Component';`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./Component');
			expect(result).toHaveLength(1);
		});

		it('should parse multiple imports from same file', () => {
			const content = `import { a, b, c } from './utils';`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./utils');
			expect(result).toHaveLength(1);
		});

		it('should handle multiple import statements', () => {
			const content = `import { a } from './a';
import { b } from './b';`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./a');
			expect(result).toContain('./b');
			expect(result).toHaveLength(2);
		});

		it('should remove duplicates', () => {
			const content = `import { a } from './utils';
import { b } from './utils';`;
			const result = parseImports(content, 'file.ts');

			expect(result).toContain('./utils');
			expect(result).toHaveLength(1);
		});
	});

	describe('Python', () => {
		it('should parse from imports', () => {
			const content = `from module import function`;
			const result = parseImports(content, 'file.py');

			expect(result).toContain('module');
			expect(result).toHaveLength(1);
		});

		it('should parse direct imports', () => {
			const content = `import module`;
			const result = parseImports(content, 'file.py');

			expect(result).toContain('module');
			expect(result).toHaveLength(1);
		});

		it('should parse from module import function', () => {
			const content = `from utils import helper_function`;
			const result = parseImports(content, 'file.py');

			expect(result).toContain('utils');
			expect(result).toHaveLength(1);
		});
	});

	describe('Go', () => {
		it('should parse import statements', () => {
			const content = `import "github.com/user/repo/package"`;
			const result = parseImports(content, 'file.go');

			expect(result).toContain('github.com/user/repo/package');
			expect(result).toHaveLength(1);
		});
	});

	describe('Rust', () => {
		it('should parse use statements', () => {
			const content = `use std::collections::HashMap;`;
			const result = parseImports(content, 'file.rs');

			expect(result).toContain('std::collections');
			expect(result).toHaveLength(1);
		});

		it('should parse mod statements', () => {
			const content = `mod my_module;`;
			const result = parseImports(content, 'file.rs');

			expect(result).toContain('my_module');
			expect(result).toHaveLength(1);
		});
	});

	describe('Generic', () => {
		it('should handle unknown extensions', () => {
			const content = `include 'some_file'`;
			const result = parseImports(content, 'file.unknown');

			expect(result).toContain('some_file');
		});

		it('should return empty array for no extension', () => {
			const content = `import something`;
			const result = parseImports(content, 'Makefile');

			expect(result).toHaveLength(0);
		});
	});
});


import type { OctokitType } from './types';
interface ResolveOptions {
    octokit: OctokitType;
    owner: string;
    repo: string;
    knownFiles: string[];
}
/**
 * Resolve a single import path to an actual file path
 */
export declare function resolveImportPath(importPath: string, currentFile: string, options: ResolveOptions): Promise<string | null>;
/**
 * Resolve multiple import paths to actual files
 */
export declare function resolveImportPaths(importPaths: string[], currentFile: string, options: ResolveOptions): Promise<string[]>;
export {};

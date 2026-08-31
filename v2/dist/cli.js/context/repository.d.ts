/**
 * Repository inspection helpers for the local checkout on the runner.
 * The harness works directly in the repository; these utilities support
 * the engine-side grouping and validation decisions.
 */
/** Group changed files into logical areas for sequential review (spec §31). */
export declare function groupByArea(files: string[]): Record<string, string[]>;
//# sourceMappingURL=repository.d.ts.map
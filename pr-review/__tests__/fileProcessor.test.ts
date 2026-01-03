import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFileContent } from '../src/fileProcessor';
import type { OctokitType } from '../src/types';

describe('fetchFileContent', () => {
	let mockOctokit: OctokitType;

	beforeEach(() => {
		mockOctokit = {
			rest: {
				git: {
					getBlob: vi.fn(),
				},
			},
		} as unknown as OctokitType;
	});

	it('should fetch and decode file content successfully', async () => {
		const testContent = 'export function test() {\n  return true;\n}';
		const encodedContent = Buffer.from(testContent).toString('base64');

		(
			mockOctokit.rest.git.getBlob as ReturnType<typeof vi.fn>
		).mockResolvedValue({
			data: {
				content: encodedContent,
			},
		});

		const result = await fetchFileContent(mockOctokit, 'owner', 'repo', 'abc123');

		expect(mockOctokit.rest.git.getBlob).toHaveBeenCalledWith({
			owner: 'owner',
			repo: 'repo',
			file_sha: 'abc123',
		});
		expect(result).toBe(testContent);
	});

	it('should return null when content is missing', async () => {
		(
			mockOctokit.rest.git.getBlob as ReturnType<typeof vi.fn>
		).mockResolvedValue({
			data: {
				content: null,
			},
		});

		const result = await fetchFileContent(mockOctokit, 'owner', 'repo', 'abc123');

		expect(result).toBeNull();
	});

	it('should return null when API call fails', async () => {
		(
			mockOctokit.rest.git.getBlob as ReturnType<typeof vi.fn>
		).mockRejectedValue(new Error('API Error'));

		const result = await fetchFileContent(mockOctokit, 'owner', 'repo', 'abc123');

		expect(result).toBeNull();
	});

	it('should handle empty content gracefully', async () => {
		(
			mockOctokit.rest.git.getBlob as ReturnType<typeof vi.fn>
		).mockResolvedValue({
			data: {
				content: '',
			},
		});

		const result = await fetchFileContent(mockOctokit, 'owner', 'repo', 'abc123');

		expect(result).toBe('');
	});
});


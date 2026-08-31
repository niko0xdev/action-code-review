export async function fetchPrContext(octokit, repository, prNumber, options = {}) {
    const pageSize = options.pageSize ?? 100;
    const maxPages = options.maxPages ?? 10;
    const [{ data: pr }, files] = await Promise.all([
        octokit.rest.pulls.get({
            ...repository,
            pull_number: prNumber,
        }),
        fetchAllFiles(octokit, repository, prNumber, pageSize, maxPages),
    ]);
    const pullRequest = {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? '',
        author: pr.user?.login ?? '',
        headRef: pr.head.ref,
        baseRef: pr.base.ref,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        draft: pr.draft ?? false,
    };
    const changedFiles = files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        previousFilename: f.previous_filename,
    }));
    const diff = {
        files: changedFiles,
        totalAdditions: changedFiles.reduce((sum, f) => sum + f.additions, 0),
        totalDeletions: changedFiles.reduce((sum, f) => sum + f.deletions, 0),
    };
    return {
        repository,
        pullRequest,
        diff,
        profiles: [],
        repositoryPath: process.env.GITHUB_WORKSPACE || process.cwd(),
    };
}
async function fetchAllFiles(octokit, repository, prNumber, pageSize, maxPages) {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
        const data = await fetchFilePage(octokit, repository, prNumber, pageSize, page);
        all.push(...data);
        if (data.length < pageSize)
            break;
    }
    return all;
}
async function fetchFilePage(octokit, repository, prNumber, pageSize, page) {
    for (let attempt = 0;; attempt += 1) {
        try {
            const { data } = await octokit.rest.pulls.listFiles({
                ...repository,
                pull_number: prNumber,
                per_page: pageSize,
                page,
            });
            return data;
        }
        catch (error) {
            const response = error;
            const status = response.status ?? response.response?.status;
            if (attempt >= 2 || (status !== 403 && status !== 429))
                throw error;
            const retryAfter = Number(response.response?.headers?.['retry-after']);
            const delay = Number.isFinite(retryAfter) && retryAfter >= 0
                ? retryAfter * 1000
                : 100 * 2 ** attempt;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}
//# sourceMappingURL=pr.js.map
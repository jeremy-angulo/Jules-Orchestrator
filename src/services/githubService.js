import { listOpenPRs } from '../api/githubClient.js';

const PR_CACHE_TTL_MS = 2 * 60 * 1000;
const prCache = new Map();
const prCacheInflight = new Map();

export async function getCachedPRs(project) {
    const cached = prCache.get(project.id);
    if (cached && Date.now() - cached.fetchedAt < PR_CACHE_TTL_MS) return cached.prs;

    if (prCacheInflight.has(project.id)) return prCacheInflight.get(project.id);

    const fetchPromise = listOpenPRs(project).then(prs => {
        prCache.set(project.id, { prs, fetchedAt: Date.now() });
        prCacheInflight.delete(project.id);
        return prs;
    }).catch(err => {
        prCacheInflight.delete(project.id);
        throw err;
    });

    prCacheInflight.set(project.id, fetchPromise);
    return fetchPromise;
}

export function invalidatePRCache(projectId) {
    prCache.delete(projectId);
}

import { getBackend } from "./backend";

/**
 * In-memory cache of valid domains served by this Carbonio install.
 *
 * Populated once at server start by `instrumentation.ts` and refreshed on
 * demand. The cache is process-local; if you run multiple Node.js instances
 * behind a load balancer, each instance will maintain its own copy.
 */
let cachedDomains: Set<string> | null = null;
let lastLoadedAt = 0;

const REFRESH_INTERVAL_MS = Number(
    process.env.DOMAIN_REFRESH_INTERVAL_MS || 60 * 60 * 1000, // 1 hour
);

/** Returns a snapshot of cached domains (lowercase). */
export function getCachedDomains(): string[] {
    return cachedDomains ? [...cachedDomains] : [];
}

export function isDomainAllowed(domain: string): boolean {
    if (!cachedDomains) return false;
    return cachedDomains.has(domain.toLowerCase());
}

/**
 * Loads all Carbonio domains via the configured backend and caches them.
 * Safe to call repeatedly; honours `DOMAIN_REFRESH_INTERVAL_MS`.
 */
export async function loadDomains(force = false): Promise<string[]> {
    const now = Date.now();
    if (
        !force &&
        cachedDomains &&
        now - lastLoadedAt < REFRESH_INTERVAL_MS
    ) {
        return [...cachedDomains];
    }

    const backend = await getBackend();
    const domains = await backend.listDomains();

    cachedDomains = new Set(domains);
    lastLoadedAt = now;
    return [...cachedDomains];
}

/** Ensures the cache is populated; loads on first call. */
export async function ensureDomainsLoaded(): Promise<string[]> {
    if (!cachedDomains) {
        await loadDomains(true);
    }
    return getCachedDomains();
}


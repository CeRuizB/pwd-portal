import { headers } from "next/headers";

/**
 * Returns a best-effort client IP for the current request, using the proxy
 * headers Next.js exposes to Server Actions. Falls back to `"unknown"` so
 * the rate limiter always has a key.
 *
 * Only call this from a Server Action or a Server Component — `headers()` is
 * an SSR-only API.
 */
export async function getClientIp(): Promise<string> {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) {
        // x-forwarded-for: client, proxy1, proxy2
        const first = xff.split(",")[0]?.trim();
        if (first) return first;
    }
    return (
        h.get("x-real-ip") ||
        h.get("cf-connecting-ip") ||
        h.get("fly-client-ip") ||
        "unknown"
    );
}

/**
 * Simple in-memory token bucket per key. Process-local; if you run multiple
 * Node.js instances, each enforces its own budget. For production deployments
 * that need cross-instance limiting, replace with Redis.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
    /** Logical name (used for the key prefix and logs). */
    name: string;
    /** Max attempts per window per key. */
    limit: number;
    /** Window length in ms. */
    windowMs: number;
}

export interface RateLimitResult {
    ok: boolean;
    remaining: number;
    retryAfterMs: number;
}

export function checkRateLimit(
    key: string,
    opts: RateLimitOptions,
): RateLimitResult {
    const now = Date.now();
    const fullKey = `${opts.name}:${key}`;
    const b = buckets.get(fullKey);
    if (!b || b.resetAt <= now) {
        buckets.set(fullKey, { count: 1, resetAt: now + opts.windowMs });
        return { ok: true, remaining: opts.limit - 1, retryAfterMs: 0 };
    }
    if (b.count >= opts.limit) {
        return {
            ok: false,
            remaining: 0,
            retryAfterMs: b.resetAt - now,
        };
    }
    b.count += 1;
    return {
        ok: true,
        remaining: opts.limit - b.count,
        retryAfterMs: 0,
    };
}

/**
 * Periodically drops expired buckets so the Map doesn't grow forever. The
 * interval is unref'd so it never blocks shutdown.
 */
const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
    }
}, 60_000);
sweep.unref?.();


import type { NextConfig } from "next";

/**
 * Security headers — applied to every route.
 *
 *   - `Strict-Transport-Security` enforces HTTPS for a year (and subdomains).
 *     Only useful when the app is actually served over HTTPS.
 *   - `Content-Security-Policy` restricts the browser to loading resources
 *     from the same origin. Tailwind compiles to a stylesheet at build time
 *     so inline styles are not required; we still allow `unsafe-inline`
 *     because Next.js may inject inline `<style>` blocks for streaming.
 *   - `X-Frame-Options: DENY` blocks framing (anti-clickjacking).
 *   - `Referrer-Policy: no-referrer` keeps the URL out of `Referer` headers.
 *   - `X-Content-Type-Options: nosniff` blocks MIME-type sniffing.
 *   - `Permissions-Policy` disables features we don't use.
 *   - `Cache-Control: no-store` on the password page prevents proxies and
 *     the browser back-button from displaying stale forms with credentials.
 */
const securityHeaders = [
    {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
    },
    {
        key: "Content-Security-Policy",
        value: [
            "default-src 'self'",
            "img-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join("; "),
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    },
];

const nextConfig: NextConfig = {
    poweredByHeader: false,
    reactStrictMode: true,

    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    ...securityHeaders,
                    { key: "Cache-Control", value: "no-store" },
                ],
            },
        ];
    },
};

export default nextConfig;

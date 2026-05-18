/**
 * Next.js instrumentation hook.
 *
 * Runs once when the server boots (before it accepts requests). We use it to
 * eagerly load the list of valid Carbonio domains so the first user request
 * doesn't pay the cost of spawning zmprov.
 *
 * Note: only register on the Node.js runtime — `zmprov` is a local binary and
 * cannot be invoked from the Edge runtime.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    const { loadDomains } = await import("./lib/domains");
    try {
        const domains = await loadDomains(true);
        console.log(
            `[carbonio-pwd-portal] cached ${domains.length} domain(s) at startup`,
        );
    } catch (err) {
        // Don't crash the server: actions will retry on demand.
        console.error(
            "[carbonio-pwd-portal] failed to preload domains:",
            err instanceof Error ? err.message : err,
        );
    }
}



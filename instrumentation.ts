/**
 * Next.js instrumentation hook.
 *
 * Runs once when the server boots (before it accepts requests). We use it to:
 *   1. Initialise the chosen backend (zmprov or SOAP) and log which one.
 *   2. Clear the global `zimbraChangePasswordListener` attribute. This
 *      attribute must hold a registered listener class name; any other value
 *      makes every password change fail. We clear it unconditionally so the
 *      portal's password resets always succeed.
 *   3. Eagerly load the list of valid Carbonio domains so the first user
 *      request doesn't pay the cost of a backend round-trip.
 *
 * Only registered on the Node.js runtime — the zmprov backend spawns a local
 * binary and the SOAP backend uses `fetch`, both of which require the Node
 * runtime (not Edge).
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    const { getBackend } = await import("./lib/backend");
    const { loadDomains } = await import("./lib/domains");

    let backend;
    try {
        backend = await getBackend();
    } catch (err) {
        console.error(
            "[carbonio-pwd-portal] backend initialisation failed:",
            err instanceof Error ? err.message : err,
        );
        return;
    }

    // 1) Clear the change-password listener globally.
    try {
        await backend.clearGlobalPasswordListener();
        console.log(
            "[carbonio-pwd-portal] cleared global zimbraChangePasswordListener",
        );
    } catch (err) {
        console.error(
            "[carbonio-pwd-portal] failed to clear zimbraChangePasswordListener:",
            err instanceof Error ? err.message : err,
        );
    }

    // 2) Preload the domain whitelist.
    try {
        const domains = await loadDomains(true);
        console.log(
            `[carbonio-pwd-portal] cached ${domains.length} domain(s) at startup`,
        );
    } catch (err) {
        console.error(
            "[carbonio-pwd-portal] failed to preload domains:",
            err instanceof Error ? err.message : err,
        );
    }
}



/**
 * Next.js instrumentation hook.
 *
 * Runs once when the server boots (before it accepts requests). We use it to:
 *   1. Clear the global `zimbraChangePasswordListener` attribute. This
 *      attribute must hold a registered listener class name; any other value
 *      makes every `zmprov sp` call fail with `service.FAILURE`. We clear it
 *      unconditionally so the portal's `sp` invocations always succeed.
 *   2. Eagerly load the list of valid Carbonio domains so the first user
 *      request doesn't pay the cost of spawning zmprov.
 *
 * Only registered on the Node.js runtime — `zmprov` is a local binary and
 * cannot be invoked from the Edge runtime.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    const { runZmprov } = await import("./lib/zmprov");
    const { loadDomains } = await import("./lib/domains");

    // 1) Clear the change-password listener globally.
    try {
        await runZmprov(["mcf", "zimbraChangePasswordListener", ""]);
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



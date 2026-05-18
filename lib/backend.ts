/**
 * Common interface implemented by every Carbonio backend (zmprov CLI or
 * admin SOAP). The rest of the application talks to this interface only —
 * which one is in use is decided by the `CARBONIO_BACKEND` env var.
 */
export interface CarbonioBackend {
    readonly name: "zmprov" | "soap";

    /** Returns the list of provisioned domains (lowercase, deduplicated). */
    listDomains(): Promise<string[]>;

    /** Returns the `zimbraPasswordMustChange` flag for the account. */
    getMustChange(email: string): Promise<boolean>;

    /** Sets a new password for the account. */
    setPassword(email: string, newPassword: string): Promise<void>;

    /** Clears the `zimbraPasswordMustChange` flag. */
    clearMustChange(email: string): Promise<void>;

    /**
     * Clears the global `zimbraChangePasswordListener` attribute so `sp`
     * succeeds. Carbonio rejects every password change when this attribute
     * holds anything other than a registered listener class name.
     */
    clearGlobalPasswordListener(): Promise<void>;
}

/**
 * Errors thrown by backends are normalised so the action layer can
 * differentiate "account not found" from policy/transient failures without
 * sniffing localized strings.
 */
export class CarbonioError extends Error {
    constructor(
        message: string,
        public readonly code:
            | "ACCOUNT_NOT_FOUND"
            | "PASSWORD_POLICY"
            | "AUTH_FAILED"
            | "LISTENER"
            | "TRANSPORT"
            | "UNKNOWN",
    ) {
        super(message);
        this.name = "CarbonioError";
    }
}

let cached: CarbonioBackend | null = null;

/**
 * Returns the configured backend (memoised for the process lifetime).
 *
 * `CARBONIO_BACKEND=soap` selects the SOAP client.
 * Anything else (including unset) falls back to the zmprov CLI client.
 */
export async function getBackend(): Promise<CarbonioBackend> {
    if (cached) return cached;

    const which = (process.env.CARBONIO_BACKEND || "zmprov").toLowerCase();
    let backend: CarbonioBackend;
    if (which === "soap") {
        const mod = await import("./soap-backend");
        backend = mod.createSoapBackend();
    } else {
        const mod = await import("./zmprov-backend");
        backend = mod.createZmprovBackend();
    }
    cached = backend;
    console.log(`[backend] using ${backend.name}`);
    return backend;
}



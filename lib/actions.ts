"use server";

import { CarbonioError, getBackend } from "./backend";
import { ensureDomainsLoaded, isDomainAllowed } from "./domains";
import { checkRateLimit, getClientIp } from "./security";

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type CheckEmailResult =
    | { ok: true; email: string }
    | { ok: false; error: string };

export type ChangePasswordResult =
    | { ok: true; redirect: string }
    | { ok: false; error: string };

function getWebmailUrl(): string {
    return process.env.WEBMAIL_URL || "/";
}

/** Generic message — never echo zmprov / SOAP error text to the browser. */
const GENERIC_NOT_ELIGIBLE =
    "La cuenta no requiere un cambio de contraseña en este momento.";
const GENERIC_FAILURE =
    "No fue posible procesar la solicitud. Inténtelo de nuevo.";

const CHECK_LIMIT = {
    name: "check",
    limit: Number(process.env.RATE_LIMIT_CHECK || 10),
    windowMs: 60_000, // 1 min
};
const CHANGE_LIMIT = {
    name: "change",
    limit: Number(process.env.RATE_LIMIT_CHANGE || 5),
    windowMs: 5 * 60_000, // 5 min
};

function validateEmail(input: string): string | null {
    const email = (input || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    if (email.length > 254) return null;
    return email;
}

function validatePassword(pwd: string): string | null {
    if (!pwd) return "Contraseña no válida.";
    if (pwd.length < 8)
        return "La contraseña debe tener al menos 8 caracteres.";
    if (pwd.length > 256) return "La contraseña es demasiado larga.";
    if (/[\r\n\u0000]/.test(pwd))
        return "La contraseña contiene caracteres no permitidos.";
    return null;
}

/**
 * Server Action — runs only on the Node.js server.
 *
 * Validates the e-mail format, ensures its domain belongs to this Carbonio
 * server and that the account has `zimbraPasswordMustChange = TRUE`.
 *
 * SECURITY:
 *   - All inputs are validated before reaching the backend.
 *   - Errors from zmprov/SOAP are NEVER forwarded to the client; the same
 *     generic message is used for "unknown account" and "doesn't require
 *     change" to prevent account enumeration.
 *   - Rate-limited per client IP.
 */
export async function checkEmail(emailRaw: string): Promise<CheckEmailResult> {
    const ip = await getClientIp();
    const rl = checkRateLimit(ip, CHECK_LIMIT);
    if (!rl.ok) {
        console.warn(`[action] checkEmail: rate-limited ip=${ip}`);
        return {
            ok: false,
            error: `Demasiados intentos. Vuelva a intentarlo en ${Math.ceil(rl.retryAfterMs / 1000)} segundos.`,
        };
    }

    const email = validateEmail(emailRaw);
    if (!email) {
        return { ok: false, error: "Formato de correo electrónico no válido." };
    }
    console.log("[action] checkEmail:", email, `ip=${ip}`);

    const domain = email.split("@")[1];
    try {
        await ensureDomainsLoaded();
    } catch (err) {
        console.error("[action] checkEmail: domain cache load failed:", err);
        return { ok: false, error: GENERIC_FAILURE };
    }
    if (!isDomainAllowed(domain)) {
        return {
            ok: false,
            error: "El dominio no está autorizado en este portal.",
        };
    }

    try {
        const backend = await getBackend();
        const mustChange = await backend.getMustChange(email);
        if (!mustChange) {
            return { ok: false, error: GENERIC_NOT_ELIGIBLE };
        }
        return { ok: true, email };
    } catch (err) {
        // Map "account not found" to the same generic answer; log everything
        // server-side for diagnostics.
        if (err instanceof CarbonioError && err.code === "ACCOUNT_NOT_FOUND") {
            console.log("[action] checkEmail: account not found", email);
            return { ok: false, error: GENERIC_NOT_ELIGIBLE };
        }
        console.error("[action] checkEmail: backend error:", err);
        return { ok: false, error: GENERIC_NOT_ELIGIBLE };
    }
}

/**
 * Server Action — runs only on the Node.js server.
 *
 * Sets a new password for the account and clears `zimbraPasswordMustChange`.
 * Re-runs `checkEmail` first so a direct POST to this action can NOT bypass
 * the eligibility check.
 *
 * SECURITY:
 *   - Inputs are revalidated server-side; client-side checks are advisory.
 *   - Errors from the backend are translated into safe Spanish strings —
 *     the raw zmprov / SOAP text never reaches the browser.
 *   - Rate-limited per client IP separately from `checkEmail`.
 */
export async function changePassword(
    emailRaw: string,
    password: string,
    confirmation: string,
): Promise<ChangePasswordResult> {
    const ip = await getClientIp();
    const rl = checkRateLimit(ip, CHANGE_LIMIT);
    if (!rl.ok) {
        console.warn(`[action] changePassword: rate-limited ip=${ip}`);
        return {
            ok: false,
            error: `Demasiados intentos. Vuelva a intentarlo en ${Math.ceil(rl.retryAfterMs / 60_000)} minuto(s).`,
        };
    }

    if (password !== confirmation) {
        return { ok: false, error: "Las contraseñas no coinciden." };
    }
    const pwdError = validatePassword(password);
    if (pwdError) return { ok: false, error: pwdError };

    const pre = await checkEmail(emailRaw);
    if (!pre.ok) return pre;

    const email = pre.email;
    const backend = await getBackend();

    // 1) Set the new password.
    try {
        await backend.setPassword(email, password);
        console.log("[action] changePassword: password set for", email);
    } catch (err) {
        if (err instanceof CarbonioError && err.code === "PASSWORD_POLICY") {
            return {
                ok: false,
                error:
                    "La nueva contraseña no cumple con la política del dominio.",
            };
        }
        console.error("[action] changePassword: setPassword failed:", err);
        return { ok: false, error: GENERIC_FAILURE };
    }

    // 2) Clear the mustChange flag in a separate request.
    try {
        await backend.clearMustChange(email);
        console.log(
            "[action] changePassword: zimbraPasswordMustChange cleared for",
            email,
        );
    } catch (err) {
        console.error(
            "[action] changePassword: clearMustChange failed:",
            err,
        );
        return {
            ok: false,
            error:
                "La contraseña se actualizó, pero no se pudo limpiar la marca de cambio obligatorio. Contacte al administrador.",
        };
    }

    return { ok: true, redirect: getWebmailUrl() };
}

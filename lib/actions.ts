"use server";

import { ensureDomainsLoaded, isDomainAllowed } from "./domains";
import { runZmprov } from "./zmprov";

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

/**
 * Validates the e-mail format, ensures its domain belongs to this Carbonio
 * server and that the account has `zimbraPasswordMustChange = TRUE`.
 *
 * We intentionally return the same generic error for "unknown account" and
 * "account doesn't require a change" to avoid leaking account existence.
 */
export async function checkEmail(emailRaw: string): Promise<CheckEmailResult> {
    const email = (emailRaw || "").trim().toLowerCase();

    if (!EMAIL_RE.test(email)) {
        return { ok: false, error: "Formato de correo electrónico no válido." };
    }

    const domain = email.split("@")[1];
    await ensureDomainsLoaded();
    if (!isDomainAllowed(domain)) {
        return {
            ok: false,
            error: "El dominio no está autorizado en este portal.",
        };
    }

    try {
        const { stdout } = await runZmprov([
            "-l",
            "ga",
            email,
            "zimbraPasswordMustChange",
        ]);

        const mustChange = /zimbraPasswordMustChange:\s*TRUE/i.test(stdout);
        if (!mustChange) {
            return {
                ok: false,
                error:
                    "La cuenta no requiere un cambio de contraseña en este momento.",
            };
        }
        return { ok: true, email };
    } catch {
        // zmprov returns non-zero when the account is unknown; do not leak details.
        return {
            ok: false,
            error:
                "La cuenta no requiere un cambio de contraseña en este momento.",
        };
    }
}

function validatePassword(pwd: string): string | null {
    if (!pwd) return "Contraseña no válida.";
    if (pwd.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    if (pwd.length > 256) return "La contraseña es demasiado larga.";
    if (/[\r\n\u0000]/.test(pwd))
        return "La contraseña contiene caracteres no permitidos.";
    return null;
}

/**
 * Sets a new password for the account and clears `zimbraPasswordMustChange`.
 *
 * Re-checks the email/domain/mustChange flag before mutating to prevent direct
 * POSTs from bypassing the first step.
 *
 * The password is sent to zmprov via stdin (interactive shell mode) so it does
 * NOT appear in the OS process list.
 */
export async function changePassword(
    emailRaw: string,
    password: string,
    confirmation: string,
): Promise<ChangePasswordResult> {
    if (password !== confirmation) {
        return { ok: false, error: "Las contraseñas no coinciden." };
    }
    const pwdError = validatePassword(password);
    if (pwdError) return { ok: false, error: pwdError };

    const pre = await checkEmail(emailRaw);
    if (!pre.ok) return pre;

    const email = pre.email;

    // Build a multi-command stdin script for zmprov's interactive mode.
    // Quote the password so spaces are preserved; escape backslashes and
    // double-quotes inside it.
    const quoted = '"' + password.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    const script =
        `sp ${email} ${quoted}\n` +
        `ma ${email} zimbraPasswordMustChange FALSE\n` +
        `exit\n`;

    try {
        await runZmprov([], script);
        console.log("[action] changePassword: success for", email);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Common zmprov failure: password doesn't satisfy the domain policy.
        if (/password/i.test(msg) && /policy|complex|history|length/i.test(msg)) {
            return {
                ok: false,
                error:
                    "La nueva contraseña no cumple con la política del dominio.",
            };
        }
        return {
            ok: false,
            error: "No fue posible actualizar la contraseña. Inténtelo de nuevo.",
        };
    }

    return { ok: true, redirect: getWebmailUrl() };
}



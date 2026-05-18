import { CarbonioBackend, CarbonioError } from "./backend";
import { runZmprov } from "./zmprov";

/**
 * `zmprov` CLI implementation of {@link CarbonioBackend}.
 *
 * Every call runs `sudo -u zextras zmprov ...` (or zmprov directly when
 * `ZMPROV_NO_SUDO=1`). Passwords are fed through stdin so they never appear
 * in the process list. Errors are mapped to {@link CarbonioError} codes so
 * the action layer can react without parsing localised strings.
 */
export function createZmprovBackend(): CarbonioBackend {
    return {
        name: "zmprov",

        async listDomains() {
            try {
                const { stdout } = await runZmprov(["-l", "gad"]);
                return stdout
                    .split(/\r?\n/)
                    .map((l) => l.trim().toLowerCase())
                    .filter(
                        (l) =>
                            l.length > 0 &&
                            /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(l),
                    );
            } catch (err) {
                throw mapError(err);
            }
        },

        async getMustChange(email) {
            try {
                const { stdout } = await runZmprov([
                    "-l",
                    "ga",
                    email,
                    "zimbraPasswordMustChange",
                ]);
                return /zimbraPasswordMustChange:\s*TRUE/i.test(stdout);
            } catch (err) {
                throw mapError(err);
            }
        },

        async setPassword(email, newPassword) {
            // Quote the password so spaces are preserved; escape backslashes
            // and double-quotes inside it (matches zmprov's interactive
            // tokenizer).
            const quoted =
                '"' +
                newPassword
                    .replace(/\\/g, "\\\\")
                    .replace(/"/g, '\\"') +
                '"';
            const script = `sp ${email} ${quoted}\nexit\n`;
            try {
                await runZmprov([], script);
            } catch (err) {
                throw mapError(err);
            }
        },

        async clearMustChange(email) {
            try {
                await runZmprov([
                    "ma",
                    email,
                    "zimbraPasswordMustChange",
                    "FALSE",
                ]);
            } catch (err) {
                throw mapError(err);
            }
        },

        async clearGlobalPasswordListener() {
            try {
                await runZmprov([
                    "mcf",
                    "zimbraChangePasswordListener",
                    "",
                ]);
            } catch (err) {
                throw mapError(err);
            }
        },
    };
}

function mapError(err: unknown): CarbonioError {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such account/i.test(msg))
        return new CarbonioError(msg, "ACCOUNT_NOT_FOUND");
    if (/password/i.test(msg) && /policy|complex|history|length/i.test(msg))
        return new CarbonioError(msg, "PASSWORD_POLICY");
    if (/change password listener/i.test(msg))
        return new CarbonioError(msg, "LISTENER");
    return new CarbonioError(msg, "UNKNOWN");
}


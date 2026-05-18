import { spawn } from "node:child_process";

/**
 * Configuration resolved from environment variables.
 *
 * - `ZMPROV_BIN`    : path to the zmprov binary (default: /opt/zextras/bin/zmprov).
 * - `ZEXTRAS_USER`  : the unix user under which zmprov must run (default: zextras).
 * - `SUDO_BIN`      : path to sudo (default: /usr/bin/sudo). When the Node.js
 *                     process is already running as the zextras user (e.g. inside
 *                     a systemd unit using `User=zextras`), set `ZMPROV_NO_SUDO=1`
 *                     to avoid the sudo wrapper.
 */
const ZMPROV_BIN = process.env.ZMPROV_BIN || "/opt/zextras/bin/zmprov";
const ZEXTRAS_USER = process.env.ZEXTRAS_USER || "zextras";
const SUDO_BIN = process.env.SUDO_BIN || "/usr/bin/sudo";
const NO_SUDO = process.env.ZMPROV_NO_SUDO === "1";
const TIMEOUT_MS = Number(process.env.ZMPROV_TIMEOUT_MS || 15_000);
const LOG_ENABLED = process.env.ZMPROV_LOG !== "0"; // on by default

export type ZmprovResult = { stdout: string; stderr: string };

/**
 * Redacts password tokens from a `zmprov` stdin script so we can safely log it.
 *
 * Targets the `sp <account> <password>` command (set password) and the
 * `ca <account> <password> ...` command (create account). Anything that
 * follows on the same line after the account is replaced with `***`.
 */
function redactScript(script: string): string {
    return script
        .split(/\r?\n/)
        .map((line) =>
            line.replace(
                /^(\s*(?:sp|ca)\s+\S+\s+)(.*)$/i,
                (_m, head) => `${head}***`,
            ),
        )
        .join("\n");
}

function truncate(s: string, max = 2000): string {
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…(+${s.length - max} bytes)`;
}

function log(...parts: unknown[]) {
    if (!LOG_ENABLED) return;
    console.log("[zmprov]", ...parts);
}

/**
 * Run zmprov with the given CLI arguments. Optionally feeds data through
 * stdin (used to avoid putting secrets like passwords in argv where they'd be
 * visible to `ps`).
 *
 * Arguments are passed as an argv array (never through a shell), so callers
 * do not need to perform shell-escaping. However, the *content* of each
 * argument is still consumed by zmprov, so callers MUST validate inputs.
 *
 * Every invocation is logged (command + stdin script with passwords redacted,
 * exit code, stdout and stderr). Set `ZMPROV_LOG=0` to disable.
 */
export function runZmprov(
    args: string[],
    stdin?: string,
): Promise<ZmprovResult> {
    const cmd = NO_SUDO ? ZMPROV_BIN : SUDO_BIN;
    const argv = NO_SUDO
        ? args
        : ["-n", "-u", ZEXTRAS_USER, ZMPROV_BIN, ...args];

    const callId = Math.random().toString(36).slice(2, 8);
    const startedAt = Date.now();

    log(`#${callId} exec:`, cmd, ...argv);
    if (stdin !== undefined) {
        log(`#${callId} stdin:`, JSON.stringify(redactScript(stdin)));
    }

    return new Promise((resolve, reject) => {
        const child = spawn(cmd, argv, {
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let killed = false;

        const timer = setTimeout(() => {
            killed = true;
            child.kill("SIGKILL");
        }, TIMEOUT_MS);

        child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
        child.stderr.on("data", (d) => (stderr += d.toString("utf8")));

        child.on("error", (err) => {
            clearTimeout(timer);
            log(
                `#${callId} spawn-error (${Date.now() - startedAt}ms):`,
                err.message,
            );
            reject(err);
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            const elapsed = Date.now() - startedAt;
            if (killed) {
                log(`#${callId} timeout after ${elapsed}ms`);
                return reject(
                    new Error(`zmprov timed out after ${TIMEOUT_MS}ms`),
                );
            }
            const out = stdout.trim();
            const errOut = stderr.trim();
            log(
                `#${callId} done:`,
                `exit=${code}`,
                `${elapsed}ms`,
                `stdout=${JSON.stringify(truncate(out))}`,
                errOut
                    ? `stderr=${JSON.stringify(truncate(errOut))}`
                    : 'stderr=""',
            );
            if (code !== 0) {
                return reject(
                    new Error(
                        `zmprov exited with code ${code}: ${errOut || out}`,
                    ),
                );
            }
            resolve({ stdout, stderr });
        });

        if (stdin !== undefined) {
            child.stdin.write(stdin);
        }
        child.stdin.end();
    });
}


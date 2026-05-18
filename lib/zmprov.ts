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

export type ZmprovResult = { stdout: string; stderr: string };

/**
 * Run zmprov with the given CLI arguments. Optionally feeds data through
 * stdin (used to avoid putting secrets like passwords in argv where they'd be
 * visible to `ps`).
 *
 * Arguments are passed as an argv array (never through a shell), so callers
 * do not need to perform shell-escaping. However, the *content* of each
 * argument is still consumed by zmprov, so callers MUST validate inputs.
 */
export function runZmprov(
    args: string[],
    stdin?: string,
): Promise<ZmprovResult> {
    const cmd = NO_SUDO ? ZMPROV_BIN : SUDO_BIN;
    const argv = NO_SUDO
        ? args
        : ["-n", "-u", ZEXTRAS_USER, ZMPROV_BIN, ...args];

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
            reject(err);
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            if (killed) {
                return reject(
                    new Error(`zmprov timed out after ${TIMEOUT_MS}ms`),
                );
            }
            if (code !== 0) {
                return reject(
                    new Error(
                        `zmprov exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
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


import { CarbonioBackend, CarbonioError } from "./backend";

/**
 * Carbonio admin SOAP (JSON envelope) client.
 *
 * Configured by env vars:
 *   - `SOAP_URL`           — full admin SOAP endpoint
 *                            (e.g. `https://mail.example.com:6071/service/admin/soap`).
 *   - `SOAP_ADMIN_USER`    — global admin account (e.g. `zextras@example.com`).
 *   - `SOAP_ADMIN_PASSWORD`— that account's password (read once at boot).
 *   - `SOAP_INSECURE_TLS=1`— skip TLS verification (self-signed certs).
 *                            Avoid in production; prefer trusting the CA.
 *   - `SOAP_TIMEOUT_MS`    — request timeout in ms (default: 15000).
 *   - `SOAP_LOG=0`         — silence per-call logs.
 *
 * SECURITY:
 *   - The admin password is read from `process.env` once at instantiation and
 *     never exported, returned, logged or sent to the client.
 *   - Request/response bodies are scrubbed before logging (auth tokens,
 *     `password`, `newPassword` and `authToken` fields → `***`).
 *   - The auth token is cached in module scope on the Node.js server only;
 *     it can never reach the browser because this module is imported solely
 *     by Server Actions / instrumentation.
 *   - On 401 / AUTH_EXPIRED the client re-authenticates once and retries
 *     the original request.
 */

interface AuthState {
    token: string;
    expiresAt: number; // ms epoch
}

const LOG_ENABLED = process.env.SOAP_LOG !== "0";
const TIMEOUT_MS = Number(process.env.SOAP_TIMEOUT_MS || 15_000);

function log(...parts: unknown[]) {
    if (!LOG_ENABLED) return;
    console.log("[soap]", ...parts);
}

function readConfig() {
    const url = process.env.SOAP_URL;
    const user = process.env.SOAP_ADMIN_USER;
    const pwd = process.env.SOAP_ADMIN_PASSWORD;
    if (!url || !user || !pwd) {
        throw new CarbonioError(
            "SOAP backend is not configured (set SOAP_URL, SOAP_ADMIN_USER, SOAP_ADMIN_PASSWORD)",
            "AUTH_FAILED",
        );
    }
    return { url, user, pwd };
}

/**
 * If `SOAP_INSECURE_TLS=1`, disable TLS verification for Node.js HTTPS
 * requests by setting `NODE_TLS_REJECT_UNAUTHORIZED=0` once per process.
 *
 * This is needed for Carbonio installs using self-signed certificates on
 * port 6071/7071. It only affects HTTPS requests made by `fetch()` in this
 * Node.js process.
 */
let tlsConfigured = false;
function ensureTlsBehavior() {
    if (tlsConfigured) return;
    tlsConfigured = true;
    if (process.env.SOAP_INSECURE_TLS === "1") {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        console.warn(
            "[soap] TLS verification DISABLED (SOAP_INSECURE_TLS=1). Use only for self-signed dev certs.",
        );
    }
}

/** Redacts secret-bearing fields from a JSON value before logging. */
function redact(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(redact);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (/password|authToken|newPassword/i.test(k)) {
            out[k] = "***";
        } else {
            out[k] = redact(v);
        }
    }
    return out;
}

let authState: AuthState | null = null;

interface SoapEnvelope<TBody> {
    Header?: { context: { _jsns: "urn:zimbra"; authToken?: string } };
    Body: TBody;
}

async function soapCall<TReqBody, TResBody = unknown>(
    body: TReqBody,
    { withAuth = true }: { withAuth?: boolean } = {},
): Promise<TResBody> {
    ensureTlsBehavior();
    const { url } = readConfig();

    const envelope: SoapEnvelope<TReqBody> = {
        Header: withAuth
            ? {
                  context: {
                      _jsns: "urn:zimbra",
                      authToken: (await ensureAuth()).token,
                  },
              }
            : undefined,
        Body: body,
    };

    const callId = Math.random().toString(36).slice(2, 8);
    log(`#${callId} →`, JSON.stringify(redact(envelope)));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const started = Date.now();

    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/soap+json; charset=utf-8",
                Accept: "application/soap+json, application/json",
            },
            body: JSON.stringify(envelope),
            signal: ctrl.signal,
            // SOAP responses must never be cached
            cache: "no-store",
        });
    } catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        log(`#${callId} ✗ transport (${Date.now() - started}ms):`, msg);
        throw new CarbonioError(`SOAP transport failed: ${msg}`, "TRANSPORT");
    }
    clearTimeout(timer);

    const text = await res.text();
    let parsed: { Body?: Record<string, unknown> } | Record<string, unknown>;
    try {
        parsed = JSON.parse(text);
    } catch {
        log(`#${callId} ✗ non-JSON (${Date.now() - started}ms):`, text.slice(0, 400));
        throw new CarbonioError("SOAP response was not valid JSON", "TRANSPORT");
    }

    log(
        `#${callId} ←`,
        `${res.status}`,
        `(${Date.now() - started}ms)`,
        JSON.stringify(redact(parsed)),
    );

    // Look for a SOAP Fault.
    const fault = ((parsed as { Body?: { Fault?: { Reason?: { Text?: string }; Detail?: { Error?: { Code?: string } } } } }).Body)
        ?.Fault;
    if (fault) {
        const code = fault.Detail?.Error?.Code || "";
        const reason = fault.Reason?.Text || "SOAP fault";
        // Auth expired → bubble up so the caller can re-auth & retry.
        if (/AUTH_EXPIRED|AUTH_REQUIRED|NO_AUTH_TOKEN/i.test(code)) {
            throw new CarbonioError(`SOAP auth expired (${code})`, "AUTH_FAILED");
        }
        if (/AUTH_FAILED/i.test(code)) {
            throw new CarbonioError(`SOAP auth failed (${code}): ${reason}`, "AUTH_FAILED");
        }
        if (/NO_SUCH_ACCOUNT/i.test(code)) {
            throw new CarbonioError(reason, "ACCOUNT_NOT_FOUND");
        }
        if (/INVALID_PASSWORD|PASSWORD_/i.test(code)) {
            throw new CarbonioError(reason, "PASSWORD_POLICY");
        }
        if (/change password listener/i.test(reason)) {
            throw new CarbonioError(reason, "LISTENER");
        }
        throw new CarbonioError(`${code}: ${reason}`, "UNKNOWN");
    }

    // Non-SOAP payload (e.g. AdminServlet 503 JSON) or any non-2xx without
    // SOAP Fault. Surface as transport/auth infra error instead of allowing
    // callers to crash by reading undefined properties.
    const responseBody = (parsed as { Body?: unknown }).Body;
    if (!res.ok || !responseBody) {
        const snippet = JSON.stringify(redact(parsed)).slice(0, 500);
        throw new CarbonioError(
            `SOAP HTTP ${res.status}: ${snippet}`,
            res.status === 401 || res.status === 403 ? "AUTH_FAILED" : "TRANSPORT",
        );
    }

    return responseBody as TResBody;
}

/** Ensures we have a non-expired auth token; logs in if needed. */
async function ensureAuth(): Promise<AuthState> {
    if (authState && authState.expiresAt - 30_000 > Date.now()) {
        return authState;
    }
    return doAuth();
}

async function doAuth(): Promise<AuthState> {
    const { user, pwd } = readConfig();
    const body = {
        AuthRequest: {
            _jsns: "urn:zimbraAdmin",
            name: { _content: user },
            password: { _content: pwd },
        },
    };
    interface AuthResp {
        AuthResponse?: {
            authToken?: Array<{ _content?: string }>;
            lifetime?: number; // ms
        };
    }
    log("auth: requesting token for", user);
    const res = await soapCall<typeof body, AuthResp>(body, { withAuth: false });
    const token = res.AuthResponse?.authToken?.[0]?._content;
    const lifetime = res.AuthResponse?.lifetime ?? 12 * 60 * 60 * 1000;
    if (!token) {
        throw new CarbonioError("AuthResponse missing authToken", "AUTH_FAILED");
    }
    authState = { token, expiresAt: Date.now() + lifetime };
    log("auth: token cached, expires in", Math.round(lifetime / 1000), "s");
    return authState;
}

/** Wrapper that retries once if the call fails with AUTH_FAILED. */
async function withRetryOnAuth<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        if (err instanceof CarbonioError && err.code === "AUTH_FAILED") {
            authState = null;
            await doAuth();
            return fn();
        }
        throw err;
    }
}

interface SoapAccount {
    id: string;
    name: string;
    a?: Array<{ n: string; _content: string }>;
}

function readAttr(acc: SoapAccount, name: string): string | undefined {
    return acc.a?.find((x) => x.n === name)?._content;
}

async function lookupAccount(
    email: string,
    attrs: string[] = [],
): Promise<SoapAccount> {
    const body = {
        GetAccountRequest: {
            _jsns: "urn:zimbraAdmin",
            applyCos: 0,
            account: { by: "name", _content: email },
            ...(attrs.length
                ? { a: attrs.map((n) => ({ n })) }
                : {}),
        },
    };
    interface Resp {
        GetAccountResponse?: { account?: SoapAccount[] };
    }
    const res = await withRetryOnAuth(() =>
        soapCall<typeof body, Resp>(body),
    );
    const acc = res.GetAccountResponse?.account?.[0];
    if (!acc) {
        throw new CarbonioError("Account not found", "ACCOUNT_NOT_FOUND");
    }
    return acc;
}

export function createSoapBackend(): CarbonioBackend {
    return {
        name: "soap",

        async listDomains() {
            const body = {
                GetAllDomainsRequest: { _jsns: "urn:zimbraAdmin" },
            };
            interface Resp {
                GetAllDomainsResponse?: {
                    domain?: Array<{ name: string }>;
                };
            }
            const res = await withRetryOnAuth(() =>
                soapCall<typeof body, Resp>(body),
            );
            return (res.GetAllDomainsResponse?.domain || [])
                .map((d) => d.name.toLowerCase())
                .filter((n) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(n));
        },

        async getMustChange(email) {
            const acc = await lookupAccount(email, ["zimbraPasswordMustChange"]);
            return (readAttr(acc, "zimbraPasswordMustChange") || "")
                .toUpperCase() === "TRUE";
        },

        async setPassword(email, newPassword) {
            const acc = await lookupAccount(email);
            const body = {
                SetPasswordRequest: {
                    _jsns: "urn:zimbraAdmin",
                    id: acc.id,
                    newPassword,
                },
            };
            await withRetryOnAuth(() => soapCall(body));
        },

        async clearMustChange(email) {
            const acc = await lookupAccount(email);
            const body = {
                ModifyAccountRequest: {
                    _jsns: "urn:zimbraAdmin",
                    id: acc.id,
                    a: [{ n: "zimbraPasswordMustChange", _content: "FALSE" }],
                },
            };
            await withRetryOnAuth(() => soapCall(body));
        },

        async clearGlobalPasswordListener() {
            const body = {
                ModifyConfigRequest: {
                    _jsns: "urn:zimbraAdmin",
                    a: [
                        { n: "zimbraChangePasswordListener", _content: "" },
                    ],
                },
            };
            await withRetryOnAuth(() => soapCall(body));
        },
    };
}


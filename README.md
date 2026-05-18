# carbonio-pwd-portal

Self-service password change portal for **Zextras Carbonio Community**.

The user types their e-mail; if the account exists, belongs to a domain hosted
by this Carbonio install and has `zimbraPasswordMustChange = TRUE`, they are
allowed to choose a new password. The portal then sets the new password,
clears the `zimbraPasswordMustChange` flag and redirects to the configured
webmail URL.

The interface is in **Spanish only**.

## Backends

The portal talks to Carbonio through a swappable backend, selected by the
`CARBONIO_BACKEND` env var:

| Value | How it works | Required env vars |
|---|---|---|
| `zmprov` *(default)* | Spawns `/opt/zextras/bin/zmprov` locally (via `sudo -u zextras` unless `ZMPROV_NO_SUDO=1`). Must run on the mailbox host. | `ZMPROV_*` |
| `soap` | Calls the Carbonio Admin SOAP/JSON API (port 6071). Can run on **any** host that can reach the mailbox. | `SOAP_URL`, `SOAP_ADMIN_USER`, `SOAP_ADMIN_PASSWORD` |

Both backends implement the same `CarbonioBackend` interface
(`lib/backend.ts`) and produce identical results.

## How it works

1. At server startup `instrumentation.ts`:
   - initialises the chosen backend,
   - clears `zimbraChangePasswordListener` globally (a Carbonio config
     attribute that, if set to anything other than a registered listener
     class name, makes every password change fail),
   - calls `listDomains()` once and caches the result. The cache is
     refreshed at most once per `DOMAIN_REFRESH_INTERVAL_MS` (default 1 h).
2. Two **Server Actions** (`lib/actions.ts`) — both `"use server"`, so
   they run **only on the Node.js server**, never in the browser:
   - `checkEmail` — validates the address, checks the domain against the
     cached whitelist, and asks the backend whether
     `zimbraPasswordMustChange = TRUE`.
   - `changePassword` — re-runs `checkEmail`, then calls
     `backend.setPassword()` followed by `backend.clearMustChange()`.

## Requirements

* Node.js ≥ 20.
* **zmprov backend** — must run on the Carbonio mailbox host with
  `/opt/zextras/bin/zmprov` and either:
  - the Node.js process runs as the `zextras` user → set `ZMPROV_NO_SUDO=1`
    (recommended), **or**
  - a passwordless sudoers rule, e.g. in `/etc/sudoers.d/carbonio-pwd-portal`:
    ```
    carbonio-pwd ALL=(zextras) NOPASSWD: /opt/zextras/bin/zmprov
    ```
* **SOAP backend** — must be able to reach the admin endpoint
  (`https://<mailbox>:6071/service/admin/soap`) and have a **dedicated**
  global admin account with the minimum delegated rights:
  `getAccountInfo`, `setPassword`, `modifyAccount`, `getAllDomains`,
  `modifyConfig` (only if you want the listener auto-clear to work via
  SOAP).

## Configuration

Copy `.env.example` to `.env.local` and adjust. The key knobs:

| Variable | Default | Description |
|---|---|---|
| `WEBMAIL_URL` | `/` | Redirect URL after success |
| `CARBONIO_BACKEND` | `zmprov` | `zmprov` or `soap` |
| **zmprov** | | |
| `ZMPROV_BIN` | `/opt/zextras/bin/zmprov` | Path to binary |
| `ZEXTRAS_USER` | `zextras` | sudo target user |
| `SUDO_BIN` | `/usr/bin/sudo` | sudo path |
| `ZMPROV_NO_SUDO` | `0` | `1` ⇒ don't wrap with sudo |
| `ZMPROV_TIMEOUT_MS` | `15000` | Kill zmprov after N ms |
| `ZMPROV_LOG` | `1` | Per-call execution log |
| **SOAP** | | |
| `SOAP_URL` | — | `https://host:6071/service/admin/soap` |
| `SOAP_ADMIN_USER` | — | Admin account |
| `SOAP_ADMIN_PASSWORD` | — | Admin password (server-side only) |
| `SOAP_INSECURE_TLS` | `0` | `1` ⇒ skip TLS verify (dev only) |
| `SOAP_TIMEOUT_MS` | `15000` | Per-call timeout |
| `SOAP_LOG` | `1` | Per-call request/response log |
| **Cache / limits** | | |
| `DOMAIN_REFRESH_INTERVAL_MS` | `3600000` | Domain cache TTL |
| `RATE_LIMIT_CHECK` | `10` | `checkEmail` per IP per minute |
| `RATE_LIMIT_CHANGE` | `5` | `changePassword` per IP per 5 min |

## Development

```bash
npm install
npm run dev
```

Without access to a real Carbonio install (or a mocked backend), the domain
preload at startup will log an error and every form submission will fail.

## Production

```bash
npm run build
npm run start
```

Keep `.env.local` mode **0600** and owned by the service user — it holds the
SOAP admin password (when the SOAP backend is in use).

## Security notes

* **Server-only execution.** Both Server Actions are `"use server"`, so the
  body never ships to the browser. The SOAP admin credentials and zmprov
  binary path stay on the server.
* **Input validation.** E-mail format and length are checked against a strict
  regex; passwords are bounded (8–256 chars) and stripped of `\r`, `\n` and
  NUL. The mutating action **re-runs** `checkEmail` so a direct POST cannot
  bypass the eligibility check.
* **No injection paths.**
  - zmprov is spawned with an **argv array** (no shell), so no escaping is
    needed for arguments.
  - The new password is fed via **stdin** in interactive mode, so it never
    appears in `/proc/*/cmdline`.
  - SOAP requests are encoded as JSON (Carbonio's `application/soap+json`
    dialect) — no XML escaping concerns.
* **Generic error responses.** Backend errors are normalised into a small
  set of codes (`ACCOUNT_NOT_FOUND`, `PASSWORD_POLICY`, `AUTH_FAILED`,
  `LISTENER`, `TRANSPORT`, `UNKNOWN`). The browser only ever sees a fixed
  Spanish message — raw zmprov / SOAP output is never echoed back.
* **Account-enumeration resistance.** "Unknown account" and "doesn't require
  a change" share the same response message.
* **Rate limiting.** In-memory per-IP token buckets cap `checkEmail` and
  `changePassword` independently (see `RATE_LIMIT_*` env vars). Replace with
  Redis if you run multiple Node.js replicas.
* **Credential-scrubbing logs.** The SOAP client redacts `password`,
  `newPassword` and `authToken` from every logged envelope; the zmprov
  logger redacts the password from `sp`/`ca` stdin scripts.
* **HTTP security headers** are emitted on every response (`next.config.ts`):
  HSTS, CSP (`default-src 'self'`), `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `Permissions-Policy` disabling unused APIs, and `Cache-Control: no-store`
  so form state isn't cached.
* This portal is **not** a generic "forgot password" flow — it only handles
  the Carbonio "first login / forced reset" case (`mustChange = TRUE`). Do
  not advertise it as a self-service reset gateway.

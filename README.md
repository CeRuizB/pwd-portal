# carbonio-pwd-portal

Self-service password change portal for **Zextras Carbonio Community**.

The user types their e-mail; if the account exists, belongs to a domain hosted
by this Carbonio install and has `zimbraPasswordMustChange = TRUE`, they are
allowed to choose a new password. The portal then:

1. runs `zmprov sp <email> <new-password>`,
2. runs `zmprov ma <email> zimbraPasswordMustChange FALSE`,
3. redirects to the configured webmail URL.

The interface is in **Spanish only**.

## How it works

* At server startup, `instrumentation.ts` runs `zmprov gad` once and caches
  the list of domains in memory. This avoids spawning `zmprov` for every
  request and gives us a whitelist of acceptable e-mail domains. The cache
  is refreshed at most once per `DOMAIN_REFRESH_INTERVAL_MS` (default 1h).
* Two **Server Actions** (`lib/actions.ts`) do the work:
  * `checkEmail` — validates format, checks the domain against the cache,
    then runs `zmprov ga <email> zimbraPasswordMustChange`.
  * `changePassword` — re-validates, then pipes `sp` + `ma` commands to
    `zmprov` through **stdin** so the password never appears in the OS
    process list.
* `zmprov` is invoked through `sudo -n -u zextras` by default. If the Node.js
  process already runs as the `zextras` user, set `ZMPROV_NO_SUDO=1`.

## Requirements

* Node.js ≥ 20
* The portal must run on the Carbonio mailbox host (or any host that can
  reach `/opt/zextras/bin/zmprov` and the LDAP backend).
* If using `sudo`, configure a passwordless rule, e.g. in
  `/etc/sudoers.d/carbonio-pwd-portal`:

  ```
  carbonio-pwd ALL=(zextras) NOPASSWD: /opt/zextras/bin/zmprov
  ```

  where `carbonio-pwd` is the unix user running the Node.js process.
  Prefer simply running the Node.js process **as the `zextras` user** and
  setting `ZMPROV_NO_SUDO=1`.

## Configuration

Copy `.env.example` to `.env.local` and adjust:

| Variable | Default | Description |
|---|---|---|
| `WEBMAIL_URL` | `/` | URL to redirect the user to after success |
| `ZMPROV_BIN` | `/opt/zextras/bin/zmprov` | Path to the zmprov binary |
| `ZEXTRAS_USER` | `zextras` | Unix user to sudo into |
| `SUDO_BIN` | `/usr/bin/sudo` | Path to sudo |
| `ZMPROV_NO_SUDO` | `0` | Set to `1` to invoke zmprov directly |
| `ZMPROV_TIMEOUT_MS` | `15000` | Kill zmprov after N ms |
| `DOMAIN_REFRESH_INTERVAL_MS` | `3600000` | Domain cache TTL |

## Development

```bash
npm install
npm run dev
```

Without access to a real Carbonio install (or a mocked `zmprov`), the domain
preload at startup will log an error and every form submission will fail.
For local UI work, point `ZMPROV_BIN` at a small fake script that echoes
deterministic output.

## Production

```bash
npm run build
npm run start
```

## Security notes

* All inputs are validated against a strict regex before reaching the shell.
* `zmprov` is spawned via `child_process.spawn` with an **argv array** (no
  shell), so quoting/injection is not a concern for arguments.
* The new password is fed to `zmprov` over **stdin** in interactive mode, so
  it never appears in `/proc/*/cmdline` nor in process listings.
* `checkEmail` returns the same generic message for "unknown account" and
  "account doesn't need a change" to reduce account enumeration.
* This portal does **not** authenticate the user beyond `mustChange = TRUE` —
  it is intended for the specific Carbonio "first login / forced reset"
  flow. Do not expose it as a generic "forgot password" feature.

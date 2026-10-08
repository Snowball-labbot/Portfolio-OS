# Portfolio OS Windows Runtime

This platform package is installed automatically by `@snowball-labbot/dsh-portfolio-os`. It contains the local FastAPI, SQLite, scheduler, and built React frontend runtime. It is not intended to be launched directly.

## Session cookie policy

Defaults are the historical same-site policy (`SameSite=Lax`, not secure). Embedding the app in a
cross-site iframe needs `SameSite=None` together with `Secure` (accepted on a loopback HTTP origin):

```powershell
portfolio-os-runtime.exe --port 41731 --cookie-samesite none --cookie-secure
```

`SESSION_COOKIE_SAMESITE` and `SESSION_COOKIE_SECURE` set the same policy when no flag is given
(flags win over the environment; `SameSite=None` without `Secure` is rejected).
`GET /api/runtime/capabilities` reports the effective policy of a running instance.

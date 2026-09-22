# Security and privacy

Portfolio OS Marketplace Edition is a local-first single-user application.

## Local data boundary

- The Runtime listens only on `127.0.0.1`.
- Accounts, holdings, uploaded documents, research notes, and logs stay under the current Windows user's Portfolio OS data directory.
- Release packages do not contain a database, account, portfolio, API key, cookie, backup, log, or generated personal report.
- AI credentials are encrypted with Windows DPAPI and are not included in portfolio exports.

## AI requests

Portfolio data leaves the machine only when the user explicitly configures and invokes an AI-backed feature. The configured provider receives only the context required for that request. Market-data and news providers receive instrument or feed queries, not the user's login password or AI key.

## Reporting a vulnerability

Open a GitHub security advisory for vulnerabilities. Do not include live API keys, portfolio exports, databases, account credentials, or private research documents in a public issue.

If an API key has been pasted into a chat, issue, log, or commit, revoke and rotate it immediately even if it was later deleted.

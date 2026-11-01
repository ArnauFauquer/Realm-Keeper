# Security Policy

## Supported versions

Realm Keeper is released continuously from `main`. Only the latest version
(see [VERSION](VERSION)) receives security fixes — update before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report them privately through GitHub:
[Report a vulnerability](https://github.com/ArnauFauquer/Realm-Keeper/security/advisories/new).

Include, where you can:

- what the issue is and what an attacker could do with it,
- steps or a proof of concept to reproduce it,
- the version or commit you tested against,
- any suggested fix.

You can expect an acknowledgement within a week. Once confirmed, a fix is
prepared and released, and the advisory is published with credit to you
(unless you prefer to stay anonymous).

## Scope

Of particular interest:

- Authentication or authorization bypass — writing notes, charts, vistas or
  assets, using the player, or posting to `/screen` without being logged in
  or allow-listed.
- Path traversal or file access outside the vault or the storage bucket.
- Leaks of secrets: `REPO_URL` tokens, S3 credentials, OAuth secrets or
  session keys.
- Stored XSS through note content, chart/vista fields or uploaded files.
- Session cookie forgery.

Out of scope:

- Anything readable by design: notes, charts, vistas and `/screen` are
  public unless a note is hidden with `NOTE_TAG_IGNORE`.
- Instances run with `ENABLE_AUTH=false`, which is intentionally open.
- Weaknesses that require a misconfigured deployment, such as a missing
  `SESSION_SECRET_KEY` or `SESSION_COOKIE_SECURE=false` over HTTPS.
- Vulnerabilities in third-party dependencies without a demonstrated impact
  on Realm Keeper (please report those upstream).

## Hardening your instance

- Set a strong, stable `SESSION_SECRET_KEY` and `SESSION_COOKIE_SECURE=true`
  behind HTTPS.
- Keep `ALLOWED_EMAILS` to the people who should edit.
- Use a Git token scoped to the vault repository only.
- Don't put anything secret in the vault: anyone who can reach the app can
  read every note that isn't tagged with `NOTE_TAG_IGNORE`.

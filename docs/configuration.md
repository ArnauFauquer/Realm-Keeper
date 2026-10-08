# Configuration

Every setting is an environment variable of the backend. The
[examples](../examples) set them in their `docker-compose.yml`; the repository's
own `docker-compose.yml` (for working on Realm Keeper, see
[development](development.md)) reads them from `.env`, and
[.env.example](../.env.example) explains each one.

## Notes, files and login

**Your Obsidian vault.** Set `VAULT_DIR` to its folder. The app reads and writes
the `.md` files in place; Obsidian's own folders (`.obsidian`, `.trash`) are
left alone. The container runs as UID 1000, which must be able to write the
folder (on Linux, usually your own user).

```env
VAULT_DIR=/home/me/Obsidian/My Campaign
```

**A vault in Git instead.** Leave `VAULT_DIR` empty and set `REPO_URL` (a named
volume keeps the clone). For a private GitHub repo, use a personal access token
with write access (in-app edits are pushed):

```env
REPO_URL=https://<TOKEN>@github.com/<user>/<notes-repo>.git
```

**Files in S3.** `STORAGE_BACKEND=s3` with your bucket's `S3_*` settings, or
also run a MinIO here with the `s3` profile:

```env
COMPOSE_PROFILES=s3
STORAGE_BACKEND=s3
```

(MinIO console: http://localhost:9001, `minioadmin` / `minioadmin123`.)

**A login.** `ENABLE_AUTH=true`, `ALLOWED_EMAILS`, a `SESSION_SECRET_KEY`, and
at least one provider. Register `<your app>/api/auth/callback` as the redirect
URI with each provider; it is the same for all of them.

```env
# Any OpenID Connect provider, by its issuer URL
OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_NAME=Microsoft
# GitHub (an OAuth App), which isn't OIDC
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
# Google
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

| Provider           | `OIDC_ISSUER_URL`                                            |
| ------------------ | ------------------------------------------------------------ |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0`         |
| Keycloak           | `https://<host>/realms/<realm>`                              |
| Authentik          | `https://<host>/application/o/<app-slug>/`                   |
| Authelia           | `https://<host>`                                             |
| Auth0              | `https://<tenant>.auth0.com/`                                |
| GitLab             | `https://gitlab.com`                                         |

Only an email the provider has verified (`email_verified`) is matched against
`ALLOWED_EMAILS`. Entra ID doesn't send that claim: with a single-tenant issuer,
where only your admins set addresses, `OIDC_REQUIRE_VERIFIED_EMAIL=false` lets it
in. Never turn it off with a provider where anyone can sign up with any address.

## Every setting

All settings are environment variables. See [.env.example](../.env.example)
and [backend/.env.example](../backend/.env.example) for annotated examples.

| Variable                | Default                  | Description                                                      |
| ----------------------- | ------------------------ | ---------------------------------------------------------------- |
| `VAULT_PATH`            | `./vault`                | Where the vault is read from / cloned to (`/vault` in Compose)    |
| `VAULT_DIR`             | a named volume           | Compose only: the host folder mounted as the vault                |
| `REPO_URL`              | —                        | Git repository holding the vault                                  |
| `GIT_ENABLED`           | on if `REPO_URL` is set  | Pull, commit and push the vault; off, it is a plain folder        |
| `GIT_SYNC_INTERVAL`     | `300`                    | Seconds between pulls (`0` disables periodic sync)                |
| `VAULT_WATCH_INTERVAL`  | `10`                     | Seconds between checks for notes changed on disk (a pull, Obsidian): open pages then reload their tree (`0` disables) |
| `NOTE_TAG_IGNORE`       | `private`                | Notes with this tag are hidden                                    |
| `HOME_NOTE`             | found in the vault       | The note the app opens on (its path without `.md`); else the first of `RealmKeeper`, `index`, `Home`, `README`, `Welcome` at the vault's top, else its first note |
| `STORAGE_BACKEND`       | `s3` if `S3_ENDPOINT_URL` is set, else `local` | Where documents, images and audio go               |
| `STORAGE_LOCAL_PATH`    | `./data` (`/data` in Compose) | The folder for `local` (formerly `DOCS_LOCAL_PATH`, still read) |
| `DATA_DIR`              | a named volume           | Compose only: a host folder for `/data` instead                   |
| `S3_ENDPOINT_URL`       | —                        | S3-compatible endpoint (empty with `s3`: AWS itself)              |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | —              | Object storage credentials                                        |
| `S3_BUCKET_NAME`        | `realm-keeper-audio`     | Bucket for audio, images and assets                               |
| `S3_REGION`             | `us-east-1`              | Bucket region                                                     |
| `ENABLE_AUTH`           | `true`                   | `false` disables login entirely                                   |
| `OIDC_ISSUER_URL`       | —                        | Any OpenID Connect provider's issuer (or its discovery URL)       |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | —        | Its client                                                        |
| `OIDC_NAME`             | `SSO`                    | The provider's name on its button                                 |
| `OIDC_SCOPES`           | `openid email profile`   | Scopes asked for                                                  |
| `OIDC_REQUIRE_VERIFIED_EMAIL` | `true`             | Only match emails the provider says it verified                  |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | —    | A GitHub OAuth App                                                |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | —    | A Google OAuth client                                             |
| `ALLOWED_EMAILS`        | —                        | Comma-separated emails allowed to log in; each one's position sets their dice colour |
| `SESSION_SECRET_KEY`    | random per start         | Signs session cookies — set it in production                      |
| `SESSION_COOKIE_SECURE` | `false`                  | `true` when served over HTTPS                                     |
| `FRONTEND_URL`          | `http://localhost:5173`  | Where to redirect after login                                     |
| `CORS_ALLOWED_ORIGINS`  | `http://localhost:5173`  | Comma-separated allowed origins                                   |
| `LOG_LEVEL`             | `INFO`                   | Backend log level                                                 |
| `LOG_DIR`               | `/app/logs`              | Where `app.log` and `error.log` are written (rotated at 10 MB, 3 kept) |
| `VITE_DEFAULT_PAGE`     | —                        | Frontend build arg: fixes the home note at build time, over `HOME_NOTE` |
| `VITE_API_URL`          | empty                    | Backend URL; leave empty when nginx proxies `/api` and `/ws`      |

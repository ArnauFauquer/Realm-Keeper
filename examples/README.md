# Examples

Ready-to-run Docker Compose setups, from the simplest to a full server. They
use the published images (`ghcr.io/arnaufauquer/realm-keeper/{backend,frontend}`),
version 0.5.0 or later, so nothing is built. Each folder also works copied on
its own, once `VAULT_DIR` points at your notes: without it, it shows the
[sample-vault](sample-vault) beside it.

| Example | Notes | Files (maps, sheets, images, music) | Login |
| ------- | ----- | ----------------------------------- | ----- |
| [01-minimal](01-minimal) | a folder (your Obsidian vault) | a Docker volume | none |
| [02-minio](02-minio) | a folder | MinIO, or any S3 bucket | none |
| [03-dex-local-users](03-dex-local-users) | a folder | a Docker volume | local users and passwords (Dex) |
| [04-git-vault](04-git-vault) | a git repository, pulled and pushed | a Docker volume | none |
| [05-github-google-login](05-github-google-login) | a folder | a Docker volume | GitHub and/or Google |
| [06-server-https](06-server-https) | a git repository | MinIO | any OpenID Connect provider, behind HTTPS (Caddy) |

```bash
cd examples/01-minimal
docker compose up -d
```

Then open http://localhost:8080. Until you point it at your own notes, it shows
the sample campaign in [sample-vault](sample-vault).

## Settings they share

- `VAULT_DIR`: the folder with your notes (an Obsidian vault works as it is).
  The app reads and writes the `.md` files in place and leaves `.obsidian` alone;
  what you change in Obsidian shows in the app within seconds. The container
  runs as UID 1000, which must be able to write the folder (on Linux, usually
  your own user; otherwise `sudo chown -R 1000 <folder>`).
- `RK_PORT`: the port the app is served on (8080).
- `REALM_KEEPER_VERSION`: the release to run (`latest`, or a version such as `0.5.0`).

Put them in a `.env` file beside the `docker-compose.yml` (each folder has an
`.env.example`).

## Mixing them

Each part is one group of settings on the backend, so any notes, any files and
any login go together:

- **Notes in a folder:** mount it at `/vault` (`VAULT_PATH=/vault`), no `REPO_URL`.
- **Notes in git:** `REPO_URL` (a token in the URL for a private repository);
  `GIT_ENABLED=true` without `REPO_URL` for a mounted folder that is already a clone.
- **Files in a folder:** `STORAGE_BACKEND=local`, `STORAGE_LOCAL_PATH=/data`.
- **Files in S3:** `STORAGE_BACKEND=s3` and `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION` (leave the endpoint empty for AWS itself).
- **No login:** `ENABLE_AUTH=false`. Anyone who can reach the app can edit everything.
- **A login:** `ENABLE_AUTH=true`, `ALLOWED_EMAILS`, `SESSION_SECRET_KEY`, and one
  or more of `OIDC_*`, `GITHUB_*`, `GOOGLE_*`. The redirect URI to register is
  always `<app address>/api/auth/callback`.

[docs/configuration.md](../docs/configuration.md) lists every setting.

## Backups

What to keep is what is in the volumes: the vault folder (or its repository) and
`/data` (or the bucket). For `01`, for example:

```bash
docker compose stop
docker run --rm -v 01-minimal_data:/data -v "$PWD":/backup alpine tar czf /backup/realm-keeper-data.tgz -C /data .
docker compose start
```

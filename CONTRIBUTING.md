# Contributing to Realm Keeper

Thanks for your interest! Bug reports, ideas and pull requests are all
welcome. By taking part you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and suggesting features

Open an [issue](https://github.com/ArnauFauquer/Realm-Keeper/issues) with:

- what you did, what you expected and what happened,
- the version (see [VERSION](VERSION)) and how you run it (Docker Compose,
  Kubernetes, local dev),
- relevant logs or screenshots.

For features, describe the problem it solves at the table before the
solution. For anything large, open an issue to discuss it before writing
code.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Development setup

The quickest way to get everything running is Docker Compose:

```bash
cp .env.example .env
docker compose up --build
```

Add `ENABLE_AUTH=false` to `.env` to skip Google OAuth while developing.

To work on one side with hot reload, see
[Development without Docker](README.md#development-without-docker) in the
README. You'll still need an S3-compatible bucket for images and audio; the
MinIO service from `docker-compose.yml` works on its own:

```bash
docker compose up minio minio-init
```

## Making changes

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change.
3. Match the style of the surrounding code: naming, comment density and
   idioms.
4. Add or update tests when you change behavior.
5. Update the README when you add a feature, an environment variable or a
   note syntax.

### Reuse the shared modules

Charts, Vistas, the asset library and the player are built on the same
building blocks. Extend these instead of duplicating them:

- Backend: `services/folder_tree.py` (folders), `services/document_store.py`
  (one JSON document per item, committed to Git), `services/storage_service.py`
  (S3).
- Frontend: `FolderGallery.vue`, `DocumentModalHeader.vue`, `DocumentEmbed.vue`
  and the composables in `src/composables/`.

### Keep the architecture simple

Realm Keeper deliberately has no database: notes and JSON documents live in
the Git vault, binaries live in object storage, and the backend runs as a
single replica. Proposals that add a database or require multiple replicas
should be discussed in an issue first.

## Checks

Backend:

```bash
cd backend
pip install pytest ruff
pytest
ruff check .
```

Frontend:

```bash
cd frontend
npx vitest run
npm run build
```

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: let a vista's background be panned vertically
fix: cap note image height so tall portraits don't dwarf landscape images
chore: bump dependencies
```

Use `feat`, `fix`, `refactor`, `docs`, `test` or `chore`, and describe the
change from the user's point of view where possible.

Don't edit `VERSION` or the image tags in `.argocd/` — CI bumps them on every
merge to `main`.

## Pull requests

- Describe what changed and why, and link the related issue.
- Include screenshots or a short recording for UI changes.
- Make sure the checks above pass.

## License

Realm Keeper is licensed under [MIT-0](LICENSE). By contributing, you agree
that your contributions are licensed under the same terms.

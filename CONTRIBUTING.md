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

`.env.example` runs without a login (`ENABLE_AUTH=false`), Git or S3: notes in
a folder, everything else in a Docker volume.

To work on one side with hot reload, see
[Development without Docker](README.md#development-without-docker) in the
README. Images and audio go to a folder (`STORAGE_LOCAL_PATH`) unless you set
`STORAGE_BACKEND=s3`; to work against S3, the MinIO service from
`docker-compose.yml` works on its own:

```bash
docker compose --profile s3 up minio minio-init
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

Charts, vistas, encounters and battlemaps are built on one document layer, and
the asset library and the player share the folder UI. Extend these instead of
duplicating them (see [ARCHITECTURE.md](ARCHITECTURE.md#adding-a-new-kind-of-document)
for a new kind of document):

- Backend: `services/doc_type.py` (what a kind of document is),
  `services/doc_collection.py` (folders and documents over a store),
  `routes/doc_router.py` (the routes of a kind), `services/sync_hub.py` (live
  documents) and `services/storage_service.py` (S3).
- Frontend: `utils/docTypes.js`, `api/docs.js`, `DocumentModal.vue`,
  `FolderGallery.vue`, `DocumentModalHeader.vue`, `DocumentEmbed.vue` and the
  composables in `src/composables/`.

### Use the design tokens

All frontend styling builds on `frontend/src/styles/`:

- `tokens.css` holds every colour, radius, spacing step, shadow, easing and
  z-index layer. Use `var(--…)` instead of literal values; only data-driven
  colours (pins, graph nodes, callout types, dice themes) stay literal.
- `base.css` holds the shared `rk-` primitives: `rk-btn`, `rk-icon-btn`,
  `rk-input`, `rk-field`, `rk-scrim` / `rk-dialog`, `rk-spinner`,
  `rk-skeleton`, `rk-empty` and `rk-alert`. Compose them in markup and keep
  only layout rules in a component's scoped styles.
- Corners use the five radius tokens only (`sm`, `md`, `lg`, `xl`, `full`),
  and stacking uses the `--z-*` layers only.
- The brand (nebula palette, the cyan-violet-pink logo gradient, Space
  Grotesk) is fixed: don't change those tokens without discussing it first.

### Keep the architecture simple

Realm Keeper deliberately has no database: notes live in the Git vault, JSON
documents and binaries live in object storage, and the backend runs as a
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
change from the user's point of view where possible. The prefix matters:
releases and the changelog are generated from it.

Don't edit `VERSION`, `CHANGELOG.md` or the image tags in `.argocd/` —
[release-please](https://github.com/googleapis/release-please) updates them
in its release PR.

## Pull requests

- Describe what changed and why, and link the related issue.
- Include screenshots or a short recording for UI changes.
- Make sure the checks above pass.

## License

Realm Keeper is licensed under [MIT-0](LICENSE). By contributing, you agree
that your contributions are licensed under the same terms.

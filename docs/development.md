# Development

## With Docker Compose

**To work on it**, from this checkout (requires Docker with Compose 2.24 or later):

```bash
cp .env.example .env
docker compose up --build
```

- App: http://localhost:5173
- API docs: http://localhost:8000/docs

The settings come from `.env`: see [configuration](configuration.md).

## Without Docker

Backend (Python 3.11):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

Frontend (Node 20):

```bash
cd frontend
npm install
npm run dev
```

Tests:

```bash
cd backend && pip install pytest && pytest
```

```bash
cd frontend && npx vitest
```

## Deployment

`.argocd/` holds Kubernetes manifests (deployments, services, PDBs, Traefik
ingress, a vault PVC and a Ceph object bucket claim) meant to be synced by
Argo CD.

Releases are managed by
[release-please](https://github.com/googleapis/release-please): on every
push to `main` it keeps a release PR open that bumps `VERSION`, the image
tags in `.argocd/` and `CHANGELOG.md`, based on the Conventional Commits
merged since the last release. Merging that PR tags `vX.Y.Z` and builds both
images to `ghcr.io/arnaufauquer/realm-keeper/{backend,frontend}`.

The backend runs as a single replica: the vault lives on a `ReadWriteOnce`
volume, Git writes are serialized in-process and live documents are held in that
one process's memory.

## Project structure

```
Realm-Keeper/
├── backend/            FastAPI app
│   ├── main.py         App setup, vault clone/pull loop
│   ├── config/         Settings, logging, cache headers
│   ├── models/         Pydantic models (notes, sheets, charts, vistas, characters, adversaries, encounters, battlemaps)
│   ├── routes/         notes, sheets, observatory, charts, vistas, characters, adversaries, encounters, battlemaps, sync, player, screen, auth
│   ├── services/       Markdown + sheet parsing, Git commits, S3 storage, the Observatory's documents and images (observatory, doc_*, sync_hub, sheet_*)
│   ├── scripts/        One-time tools (migrate_to_observatory.py, sheets_to_documents.py)
│   └── tests/
├── frontend/           Vue 3 + Vite app, served by nginx in production
│   └── src/
│       ├── views/      Home, NoteView, ScreenView
│       ├── components/ Sidebar, the Observatory, document modal (charts, vistas, characters, adversaries, encounters, battlemaps), sheets, graph, player, dice
│       ├── composables/
│       ├── dice/       three.js + cannon-es dice simulation
│       └── api/
├── .argocd/            Kubernetes manifests
├── .github/workflows/  CI: tests on every pull request; version bump, image build and push
└── docker-compose.yml  Local stack with MinIO
```

See [ARCHITECTURE.md](../ARCHITECTURE.md) for more detail.

## Tech stack

- **Backend:** FastAPI, Pydantic, python-markdown, python-frontmatter, boto3,
  Authlib, Git
- **Frontend:** Vue 3, Vue Router, markdown-it, Mermaid, D3, three.js,
  cannon-es, Axios
- **Infrastructure:** Docker, nginx, MinIO / Ceph RGW, Kubernetes, Argo CD,
  GitHub Actions

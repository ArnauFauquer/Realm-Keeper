# Realm Keeper - Markdown Notes

A minimalist web application to visualize your Markdown notes as a navigable knowledge base.

## 🚀 Features

- ✅ Note links support `[[note]]`
- ✅ Directory structure navigation
- ✅ Note search
- ✅ Git repository synchronization
- ✅ Markdown rendering
- ✅ Tags and metadata
- ✅ Cache for better performance
- ✅ Knowledge graph visualization
- ✅ LightRAG-powered AI chat assistant

## Project Structure

```
Realm-Keeper/
├── backend/           # FastAPI backend
│   ├── main.py
│   ├── requirements.txt
│   ├── models/        # Data models
│   ├── routes/        # API endpoints
│   ├── services/      # Business logic
│   └── Dockerfile
├── frontend/          # Vue frontend
│   ├── src/
│   │   ├── components/
│   │   ├── views/
│   │   ├── router/
│   │   └── App.vue
│   ├── package.json
│   └── Dockerfile
├── kubernetes/        # Kubernetes deployment configs
└── docker-compose.yml
```

## Getting Started

### Vault Configuration

**Option 1: Local folder (simplest)**

```bash
# Copy your .md files to ./backend/vault/
# The application will read directly from this folder
cp -r /path/to/your/notes/*.md backend/vault/
```

**Option 2: Git repository with synchronization**

> 📖 **See full guide**: [GITHUB_TOKEN_SETUP.md](./GITHUB_TOKEN_SETUP.md)

1. Create a GitHub token with `repo` permissions
2. Configure in `.env`: `REPO_URL=https://TOKEN@github.com/user/repo.git`
3. Sync from the UI using the "Sync Vault" button

### Running the Application

1. Install frontend dependencies:
```bash
cd frontend
npm install
```

2. Start the services:
```bash
docker-compose up --build
```

3. Access the application:
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000
   - API Docs: http://localhost:8000/docs

### Development without Docker

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

### Core
- `GET /` - Welcome message
- `GET /health` - Health check

### Notes
- `GET /api/notes` - List all notes with metadata
- `GET /api/notes?search=query` - Search notes by title
- `GET /api/note/{path}` - Get a specific note (maintains directory structure)
- `GET /api/tags` - List all available tags

### Graph
- `GET /api/graph/all` - Get full knowledge graph data

### Chat (LightRAG)
- `GET /api/chat/status` - Get LightRAG status
- `POST /api/chat/query` - Query the knowledge base
- `POST /api/chat/index` - Index vault into knowledge base
- `DELETE /api/chat/index` - Delete the index

### Vault Management
- `POST /api/sync` - Sync vault with Git repository
- `GET /api/vault/info` - Vault information

## 📁 Directory Structure

Notes maintain the directory structure:

```
vault/
├── Characters/
│   ├── Hero.md
│   └── Villain.md
├── Locations/
│   └── City.md
└── Index.md
```

Corresponding URLs:
- `/note/Characters/Hero`
- `/note/Locations/City`

## 🔗 Note Links

The parser automatically converts:
- `[[Note]]` → `/note/Note`
- `[[Folder/Note]]` → `/note/Folder/Note`
- `[[Note|Text]]` → Custom display text

## Tech Stack

**Backend:**
- FastAPI
- GitPython
- python-markdown
- python-frontmatter
- LightRAG

**Frontend:**
- Vue 3
- Vue Router
- D3.js (graph visualization)
- Markdown-it
- Axios

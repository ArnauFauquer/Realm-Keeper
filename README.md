# Realm Keeper - Markdown Wiki

Una aplicación web minimalista para visualizar tus notas de Markdown como una wiki navegable.

## 🚀 Características

- ✅ Soporte para wikilinks `[[nota]]`
- ✅ Navegación por estructura de directorios
- ✅ Búsqueda de notas
- ✅ Sincronización con repositorio Git
- ✅ Renderizado de Markdown
- ✅ Tags y metadata
- ✅ Cache para mejor rendimiento

## Project Structure

```
Realm-Keeper/
├── backend/           # FastAPI backend
│   ├── main.py
│   ├── requirements.txt
│   ├── models/        # Modelos de datos
│   ├── routes/        # Endpoints API
│   ├── services/      # Lógica de negocio
│   └── Dockerfile
├── frontend/          # Vue frontend
│   ├── src/
│   │   ├── components/
│   │   ├── views/
│   │   ├── router/
│   │   └── App.vue
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

## Getting Started

### Configuración del Vault

**Opción 1: Carpeta local (más simple)**

```bash
# Copiar tus archivos .md a ./backend/vault/
# La aplicación leerá directamente de esta carpeta
cp -r /ruta/a/tus/notas/*.md backend/vault/
```

**Opción 2: Repositorio Git con sincronización**

> 📖 **Ver guía completa**: [GITHUB_TOKEN_SETUP.md](./GITHUB_TOKEN_SETUP.md)

1. Crear un token de GitHub con permisos `repo`
2. Configurar en `.env`: `REPO_URL=https://TOKEN@github.com/user/repo.git`
3. Sincronizar desde la UI con el botón "Sincronizar Vault"

### Running the Application

1. Instalar dependencias del frontend:
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

### Development sin Docker

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
- `GET /api/notes` - Lista todas las notas con metadata
- `GET /api/notes?search=query` - Buscar notas por título
- `GET /api/note/{path}` - Obtiene una nota específica (mantiene estructura de directorios)

### Vault Management
- `POST /api/sync` - Sincroniza el vault con repositorio Git
- `GET /api/vault/info` - Información del vault

## 📁 Estructura de Directorios

Las notas mantienen la estructura de directorios:

```
vault/
├── Personajes/
│   ├── Héroe.md
│   └── Villano.md
├── Lugares/
│   └── Ciudad.md
└── Índice.md
```

URLs correspondientes:
- `/note/Personajes/Héroe`
- `/note/Lugares/Ciudad`

## 🔗 Wikilinks

El parser convierte automáticamente:
- `[[Nota]]` → `/note/Nota`
- `[[Carpeta/Nota]]` → `/note/Carpeta/Nota`
- `[[Nota|Texto]]` → Texto personalizado

## Stack Tecnológico

**Backend:**
- FastAPI
- GitPython
- python-markdown
- python-frontmatter

**Frontend:**
- Vue 3
- Vue Router
- Markdown-it
- Axios

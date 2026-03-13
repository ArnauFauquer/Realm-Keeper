# Realm Keeper Architecture

## Overview
Realm Keeper translates Obsidian/Markdown vaults to an interactive web platform. It leverages FastAPI for backend processing and Vue 3 for a fluid frontend.

## Components

### 1. Backend (FastAPI + Python)
- **`MarkdownService`**: Core handler managing parsing, caching, and IO access to notes. Employs memory caching to avoid repetitive disk access (solves N+1 issues).
- **`MarkdownParser`**: Handles extracting frontmatter, parsing tags, converting wiki-links to web links, and parsing Markdown to HTML tokens. Employs `_note_index` that invalidates during synchronization.
- **`git_sync`**: Reconstructs the vault local directory against a remote Git repository on a schedule or via explicit webhooks calling `sync_repository`.

### 2. Frontend (Vue 3 + Vite)
- **`useNotes.js` Composable**: Fetches, filters, and paginates through parsed vault data. Abstracting logic previously contained in gigantic components.
- **Node Tree / Graph View**: Renders the relationship mapping between extracted wiki-links and Markdown metadata computed using D3.js.

## Security Integrations
- Hardened Assets Endpoints preventing `Path Traversal` and Sandbox Escaping (`.resolve()` bounded paths).
- Secret encapsulation on Kubernetes using `Opaque` secrets over plain ConfigMaps.
- Kubernetes workload identities (`runAsNonRoot: true` & `allowPrivilegeEscalation: false`).

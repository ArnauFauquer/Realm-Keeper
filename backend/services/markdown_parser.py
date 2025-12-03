import re
import markdown
import frontmatter
from typing import Dict, List, Tuple
from pathlib import Path


class MarkdownParser:
    """Parser para convertir Markdown a HTML"""
    
    def __init__(self, vault_path: Path = None):
        self.md = markdown.Markdown(extensions=['extra', 'codehilite', 'tables'])
        self.wikilink_pattern = re.compile(r'\[\[([^\]|]+)(\|([^\]]+))?\]\]')
        self.image_wikilink_pattern = re.compile(r'!\[\[([^\]]+)\]\]')
        self.tag_pattern = re.compile(r'#([\w\-\/]+)')
        self.vault_path = vault_path
        self._note_index = None
    
    def _build_note_index(self):
        """Construye un índice de nombre de archivo -> path completo"""
        if self._note_index is not None or not self.vault_path:
            return
        
        self._note_index = {}
        self._note_index_lower = {}  # Índice en minúsculas para búsqueda case-insensitive
        
        for md_file in self.vault_path.rglob('*.md'):
            if any(part.startswith('.') for part in md_file.parts):
                continue
            
            # Nombre del archivo sin extensión
            filename = md_file.stem
            # Path relativo sin extensión
            relative_path = md_file.relative_to(self.vault_path).with_suffix('')
            resolved_path = str(relative_path).replace('\\', '/')
            
            # Guardar tanto el nombre simple como el path completo (case-sensitive)
            self._note_index[filename] = resolved_path
            self._note_index[resolved_path] = resolved_path
            
            # También en minúsculas para búsqueda case-insensitive
            self._note_index_lower[filename.lower()] = resolved_path
            self._note_index_lower[resolved_path.lower()] = resolved_path
    
    def _resolve_wikilink(self, link: str) -> str:
        """Resuelve un wikilink a su path completo (case-insensitive)"""
        if not self.vault_path:
            return link
        
        self._build_note_index()
        
        # Primero intentar búsqueda exacta (case-sensitive)
        if link in self._note_index:
            return self._note_index[link]
        
        # Si no se encuentra, buscar case-insensitive
        link_lower = link.lower()
        if link_lower in self._note_index_lower:
            return self._note_index_lower[link_lower]
        
        # Si no se encuentra, devolver el link original
        return link
    
    def parse_file(self, file_path: Path) -> Tuple[Dict, str, List[str], List[str]]:
        """
        Parse un archivo markdown
        Returns: (frontmatter, content, tags, wikilinks)
        """
        with open(file_path, 'r', encoding='utf-8') as f:
            post = frontmatter.load(f)
        
        # Extraer frontmatter
        fm = dict(post.metadata) if post.metadata else {}
        
        # Contenido
        content = post.content
        
        # Extraer tags
        tags = self._extract_tags(content, fm)
        
        # Extraer wikilinks
        wikilinks = self._extract_wikilinks(content)
        
        # Convertir image wikilinks a markdown images
        content = self._convert_image_wikilinks(content)
        
        # Convertir wikilinks a links normales
        content = self._convert_wikilinks(content)
        
        return fm, content, tags, wikilinks
    
    def _extract_tags(self, content: str, frontmatter: Dict) -> List[str]:
        """Extrae tags del contenido y frontmatter"""
        tags = set()
        
        # Tags del frontmatter
        if 'tags' in frontmatter:
            fm_tags = frontmatter['tags']
            if isinstance(fm_tags, list):
                tags.update(fm_tags)
            elif isinstance(fm_tags, str):
                tags.add(fm_tags)
        
        # Tags inline (#tag)
        inline_tags = self.tag_pattern.findall(content)
        tags.update(inline_tags)
        
        return sorted(list(tags))
    
    def _extract_wikilinks(self, content: str) -> List[str]:
        """Extrae todos los wikilinks del contenido y los resuelve a paths"""
        matches = self.wikilink_pattern.findall(content)
        # matches son tuplas: (link, '|text' o '', text o '')
        # Resolver cada wikilink a su path completo
        resolved_links = []
        for match in matches:
            link_text = match[0]
            resolved_path = self._resolve_wikilink(link_text)
            resolved_links.append(resolved_path)
        return resolved_links
    
    def _convert_wikilinks(self, content: str) -> str:
        """Convierte [[wikilink]] a formato de link para el frontend"""
        from urllib.parse import quote
        
        def replace_wikilink(match):
            link = match.group(1)
            display_text = match.group(3) if match.group(3) else link
            
            # Resolver el wikilink a su path completo
            resolved_link = self._resolve_wikilink(link)
            
            # URL-encode cada segmento del path (preservando slashes)
            encoded_path = '/'.join(quote(segment, safe='') for segment in resolved_link.split('/'))
            
            # Convertir a formato que el frontend pueda manejar
            return f'[{display_text}](/note/{encoded_path})'
        
        return self.wikilink_pattern.sub(replace_wikilink, content)
    
    def _convert_image_wikilinks(self, content: str) -> str:
        """Convierte ![[image.jpg]] a formato markdown ![](url)"""
        from urllib.parse import quote
        
        def replace_image(match):
            image_name = match.group(1)
            # Images are served from /assets endpoint
            encoded_name = quote(image_name, safe='')
            return f'![{image_name}](/assets/{encoded_name})'
        
        return self.image_wikilink_pattern.sub(replace_image, content)
    
    def to_html(self, content: str) -> str:
        """Convierte markdown a HTML"""
        return self.md.convert(content)

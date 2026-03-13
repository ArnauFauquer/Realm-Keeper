import re
import markdown
import frontmatter
from typing import Dict, List, Tuple
from pathlib import Path


class MarkdownParser:
    def __init__(self, vault_path: Path = None):
        self.md = markdown.Markdown(extensions=['extra', 'codehilite', 'tables'])
        self.wikilink_pattern = re.compile(r'\[\[([^\]|]+)(\|([^\]]+))?\]\]')
        self.image_wikilink_pattern = re.compile(r'!\[\[([^\]]+)\]\]')
        self.tag_pattern = re.compile(r'#([\w\-\/]+)')
        self.vault_path = vault_path
        self._note_index = None
    
    def _build_note_index(self):
        """
        Builds an in-memory index mapping note bases and logical paths to their exact
        resolved relative paths. This enables fast O(1) wiki-link resolution without disk I/O.
        Index is invalidated on git syncs to prevent stale references.
        """
        if self._note_index is not None or not self.vault_path:
            return
            
        self._note_index = {}
        self._note_index_lower = {}
        
        for md_file in self.vault_path.rglob('*.md'):
            if any(part.startswith('.') for part in md_file.parts):
                continue
                
            filename = md_file.stem
            relative_path = md_file.relative_to(self.vault_path).with_suffix('')
            resolved_path = str(relative_path).replace('\\', '/')
            
            self._note_index[filename] = resolved_path
            self._note_index[resolved_path] = resolved_path
            
            self._note_index_lower[filename.lower()] = resolved_path
            self._note_index_lower[resolved_path.lower()] = resolved_path
            
    def invalidate_index(self):
        self._note_index = None
        self._note_index_lower = None
            
    def _resolve_wikilink(self, link: str) -> str:
        if not self.vault_path:
            return link
            
        self._build_note_index()
        
        if link in self._note_index:
            return self._note_index[link]
            
        link_lower = link.lower()
        if link_lower in self._note_index_lower:
            return self._note_index_lower[link_lower]
            
        return link
        
    def parse_file(self, file_path: Path) -> Tuple[Dict, str, List[str], List[str]]:
        with open(file_path, 'r', encoding='utf-8') as f:
            post = frontmatter.load(f)
            
        fm = dict(post.metadata) if post.metadata else {}
        content = post.content
        tags = self._extract_tags(content, fm)
        wikilinks = self._extract_wikilinks(content)
        content = self._convert_image_wikilinks(content)
        content = self._convert_wikilinks(content)
        
        return fm, content, tags, wikilinks
        
    def _extract_tags(self, content: str, frontmatter: Dict) -> List[str]:
        tags = set()
        
        if 'tags' in frontmatter:
            fm_tags = frontmatter['tags']
            if isinstance(fm_tags, list):
                tags.update(fm_tags)
            elif isinstance(fm_tags, str):
                tags.add(fm_tags)
                
        inline_tags = self.tag_pattern.findall(content)
        tags.update(inline_tags)
        
        return sorted(list(tags))
        
    def _extract_wikilinks(self, content: str) -> List[str]:
        """
        Parses Markdown content using regex to pull Obsidian-style wikilinks [[NoteName]],
        and delegates their resolution through the note index to translate missing or
        ambiguous names into exact relative repository paths.
        """
        matches = self.wikilink_pattern.findall(content)
        resolved_links = []
        for match in matches:
            link_text = match[0]
            resolved_path = self._resolve_wikilink(link_text)
            resolved_links.append(resolved_path)
        return resolved_links
        
    def _convert_wikilinks(self, content: str) -> str:
        from urllib.parse import quote
        
        def replace_wikilink(match):
            link = match.group(1)
            display_text = match.group(3) if match.group(3) else link
            resolved_link = self._resolve_wikilink(link)
            encoded_path = '/'.join(quote(segment, safe='') for segment in resolved_link.split('/'))
            return f'[{display_text}](/note/{encoded_path})'
            
        return self.wikilink_pattern.sub(replace_wikilink, content)
        
    def _convert_image_wikilinks(self, content: str) -> str:
        from urllib.parse import quote
        
        def replace_image(match):
            image_name = match.group(1)
            encoded_name = quote(image_name, safe='')
            return f'![{image_name}](/assets/{encoded_name})'
            
        return self.image_wikilink_pattern.sub(replace_image, content)

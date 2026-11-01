import pytest
from pathlib import Path
import tempfile
from services.markdown_parser import MarkdownParser

@pytest.fixture
def temp_vault():
    with tempfile.TemporaryDirectory() as d:
        vault_path = Path(d)
        
        # Create some test files
        (vault_path / "test1.md").write_text("---\ntags: [test, draft]\n---\n# Test 1\n[[test2]]")
        (vault_path / "test2.md").write_text("# Test 2\nSome content")
        
        yield vault_path

def test_parser_extracts_frontmatter_and_links(temp_vault):
    parser = MarkdownParser(vault_path=temp_vault)
    
    # Force index build
    parser._build_note_index()
    
    fm, content, tags, wikilinks = parser.parse_file(temp_vault / "test1.md")
    assert "test" in tags
    assert "draft" in tags
    # wikilink [[test2]] should be extracted
    assert "test2" in wikilinks
    
def test_parser_invalidates_index(temp_vault):
    parser = MarkdownParser(vault_path=temp_vault)
    parser._build_note_index()
    assert parser._note_index is not None
    
    parser.invalidate_index()
    assert parser._note_index is None

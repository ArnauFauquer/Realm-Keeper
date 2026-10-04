"""Fenced code blocks in markdown (``` / ~~~), found line by line.

Used to pull ```sheet blocks out of a note's raw body and to keep a block's
contents out of tag detection: YAML such as `color: #ff0000`, or a mermaid
`style A fill:#f9f`, would otherwise read as the tags "ff0000" / "f9f" — and
a `#private` inside a block would hide the whole note.

A block inside a blockquote (every callout is one) is found too: its `>`
markers are not part of its content.
"""
import re
from typing import Iterator, List, NamedTuple, Optional

_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*([^`\n]*?)[ \t]*$")
_QUOTE_RE = re.compile(r"^ {0,3}> ?")


class FencedBlock(NamedTuple):
    lang: str      # first word of the info string, lowercased ("" if none)
    info: str      # the whole info string
    content: str   # the lines between the fences, joined with "\n"
    start: int     # index of the opening fence line
    end: int       # index of the last line the block takes (its closing fence, if any)


def _unquote(line: str, depth: int) -> Optional[str]:
    """`line` without `depth` levels of `>` markers, or None if it has fewer
    (the blockquote has ended)."""
    for _ in range(depth):
        marker = _QUOTE_RE.match(line)
        if not marker:
            return None
        line = line[marker.end():]
    return line


def iter_fenced_blocks(text: str) -> Iterator[FencedBlock]:
    lines = text.splitlines()
    n = len(lines)
    i = 0
    while i < n:
        depth, rest = 0, lines[i]
        while (marker := _QUOTE_RE.match(rest)):
            rest, depth = rest[marker.end():], depth + 1
        opening = _OPEN_RE.match(rest)
        if not opening:
            i += 1
            continue
        fence, info = opening.group(1), opening.group(2).strip()
        # A fence closes with the same character, at least as long as the opener.
        closing = re.compile(rf"^ {{0,3}}{re.escape(fence[0])}{{{len(fence)},}}[ \t]*$")
        body: List[str] = []
        j = i + 1
        closed = False
        while j < n:
            inner = _unquote(lines[j], depth)
            if inner is None:
                break
            if closing.match(inner):
                closed = True
                break
            body.append(inner)
            j += 1
        yield FencedBlock(
            lang=info.split(None, 1)[0].lower() if info else "",
            info=info,
            content="\n".join(body),
            start=i,
            end=j if closed else j - 1,
        )
        i = j + 1 if closed else j


def extract_fenced_blocks(text: str, lang: str) -> List[str]:
    """Contents of every fenced block whose language is `lang`, in order."""
    lang = lang.lower()
    return [block.content for block in iter_fenced_blocks(text) if block.lang == lang]


def strip_fenced_blocks(text: str) -> str:
    """`text` without its fenced blocks (fence lines included)."""
    lines = text.splitlines()
    for block in iter_fenced_blocks(text):
        for index in range(block.start, block.end + 1):
            lines[index] = ""
    return "\n".join(lines)

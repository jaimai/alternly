"""Articles de blog : fichiers markdown avec frontmatter simple (clé: valeur)."""
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import markdown

CONTENT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "content" / "blog"


@dataclass
class Article:
    slug: str
    title: str
    description: str
    date: date
    body_md: str


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    _, _, rest = text.partition("---")
    meta_raw, sep, body = rest.partition("---")
    if not sep:
        return {}, text
    meta: dict[str, str] = {}
    for line in meta_raw.strip().splitlines():
        key, _, value = line.partition(":")
        if key.strip():
            meta[key.strip()] = value.strip()
    return meta, body.strip()


def load_articles(content_dir: Path = CONTENT_DIR) -> list[Article]:
    if not content_dir.is_dir():
        return []
    articles: list[Article] = []
    for path in sorted(content_dir.glob("*.md")):
        meta, body = _parse_frontmatter(path.read_text(encoding="utf-8"))
        if meta.get("draft", "").lower() == "true":
            continue
        try:
            published = date.fromisoformat(meta.get("date", ""))
        except ValueError:
            continue  # article sans date valide : ignoré plutôt que de casser le blog
        articles.append(
            Article(
                slug=path.stem,
                title=meta.get("title", path.stem),
                description=meta.get("description", ""),
                date=published,
                body_md=body,
            )
        )
    articles.sort(key=lambda a: a.date, reverse=True)
    return articles


def render_article(article: Article) -> str:
    return markdown.markdown(article.body_md, extensions=["extra", "toc"])

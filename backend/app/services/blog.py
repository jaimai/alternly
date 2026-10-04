"""Articles de blog : fichiers markdown avec frontmatter simple (clé: valeur)."""
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import markdown

CONTENT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "content" / "blog"
# Guides en anglais (parents américains), servis sous /en/blog.
CONTENT_DIR_EN = CONTENT_DIR.parent / "blog-en"


@dataclass
class Article:
    slug: str
    title: str
    description: str
    date: date
    body_md: str
    # Questions/réponses de la section « Questions fréquentes » (données structurées FAQPage).
    faq: list[tuple[str, str]] = field(default_factory=list)


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
            value = value.strip()
            # Valeur entre guillemets (titre contenant « : ») : on retire les guillemets.
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            meta[key.strip()] = value
    return meta, body.strip()


FAQ_HEADINGS = {"questions fréquentes", "faq", "frequently asked questions"}


def _plain(md: str) -> str:
    """Markdown → texte brut d'une ligne (liens, gras, italique retirés)."""
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", md)
    text = re.sub(r"[*_`>]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_faq(body_md: str) -> list[tuple[str, str]]:
    """Paires (question, réponse) : chaque `### …` de la section `## Questions fréquentes`."""
    faq: list[tuple[str, str]] = []
    in_section = False
    question: str | None = None
    answer: list[str] = []
    for line in body_md.splitlines() + ["## "]:
        if line.startswith("## "):
            if question and answer:
                faq.append((question, _plain(" ".join(answer))))
            question, answer = None, []
            in_section = line[3:].strip().lower() in FAQ_HEADINGS
        elif in_section and line.startswith("### "):
            if question and answer:
                faq.append((question, _plain(" ".join(answer))))
            question, answer = _plain(line[4:]), []
        elif in_section and question:
            answer.append(line)
    return faq


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
                faq=extract_faq(body),
            )
        )
    articles.sort(key=lambda a: a.date, reverse=True)
    return articles


def render_article(article: Article) -> str:
    return markdown.markdown(article.body_md, extensions=["extra", "toc"])

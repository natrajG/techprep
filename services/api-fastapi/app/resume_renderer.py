"""Renders a structured, schema-validated resume (see `resume_rebuild.RebuiltResume`) into an
ATS-safe single-column document — PDF via WeasyPrint, DOCX via python-docx — and re-extracts
text from the generated PDF to confirm it is actually machine-parseable before it is ever shown
to the user as "ready".

No headless browser: WeasyPrint is pure-Python/Cairo and renders plain HTML/CSS directly to PDF.
"""

import html
import io

from docx import Document
from docx.shared import Pt
from pypdf import PdfReader
from weasyprint import HTML

_CSS = """
@page { size: A4; margin: 1.6cm; }
body { font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 10.5pt; line-height: 1.35; }
h1 { font-size: 16pt; margin: 0 0 2pt; }
.contact { font-size: 9.5pt; color: #333; margin-bottom: 10pt; }
h2 { font-size: 11.5pt; text-transform: uppercase; letter-spacing: 0.5pt;
     border-bottom: 1pt solid #333; margin: 12pt 0 4pt; padding-bottom: 2pt; }
.entry-title { font-weight: bold; }
.entry-meta { float: right; font-style: italic; color: #444; }
ul { margin: 2pt 0 6pt; padding-left: 14pt; }
li { margin-bottom: 2pt; }
p { margin: 2pt 0; }
"""


def _esc(value: str) -> str:
    return html.escape(value or "", quote=False)


def render_html(data: dict) -> str:
    """`data` follows the RebuiltResume schema: name, contact, summary, experience[], education[],
    certifications[], skills[]."""
    parts = [f"<html><head><meta charset='utf-8'><style>{_CSS}</style></head><body>"]
    parts.append(f"<h1>{_esc(data.get('name', ''))}</h1>")
    parts.append(f"<div class='contact'>{_esc(data.get('contact', ''))}</div>")

    if data.get("summary"):
        parts.append("<h2>Professional Summary</h2>")
        parts.append(f"<p>{_esc(data['summary'])}</p>")

    if data.get("experience"):
        parts.append("<h2>Experience</h2>")
        for job in data["experience"]:
            parts.append(
                f"<p><span class='entry-title'>{_esc(job.get('title', ''))} — {_esc(job.get('company', ''))}</span>"
                f"<span class='entry-meta'>{_esc(job.get('dates', ''))}</span></p>"
            )
            bullets = job.get("bullets") or []
            if bullets:
                parts.append("<ul>" + "".join(f"<li>{_esc(b)}</li>" for b in bullets) + "</ul>")

    if data.get("education"):
        parts.append("<h2>Education</h2>")
        for edu in data["education"]:
            parts.append(
                f"<p><span class='entry-title'>{_esc(edu.get('degree', ''))}, {_esc(edu.get('institution', ''))}</span>"
                f"<span class='entry-meta'>{_esc(edu.get('dates', ''))}</span></p>"
            )

    if data.get("certifications"):
        parts.append("<h2>Certifications</h2>")
        parts.append("<ul>" + "".join(f"<li>{_esc(c)}</li>" for c in data["certifications"]) + "</ul>")

    if data.get("skills"):
        parts.append("<h2>Skills</h2>")
        parts.append(f"<p>{_esc(', '.join(data['skills']))}</p>")

    parts.append("</body></html>")
    return "".join(parts)


def render_pdf(data: dict) -> bytes:
    return HTML(string=render_html(data)).write_pdf()


def render_docx(data: dict) -> bytes:
    doc = Document()
    style = doc.styles["Normal"]
    style.font.size = Pt(10.5)

    doc.add_heading(data.get("name", ""), level=0)
    if data.get("contact"):
        doc.add_paragraph(data["contact"])

    if data.get("summary"):
        doc.add_heading("Professional Summary", level=1)
        doc.add_paragraph(data["summary"])

    if data.get("experience"):
        doc.add_heading("Experience", level=1)
        for job in data["experience"]:
            heading = f"{job.get('title', '')} — {job.get('company', '')} ({job.get('dates', '')})"
            p = doc.add_paragraph()
            p.add_run(heading).bold = True
            for bullet in job.get("bullets") or []:
                doc.add_paragraph(bullet, style="List Bullet")

    if data.get("education"):
        doc.add_heading("Education", level=1)
        for edu in data["education"]:
            doc.add_paragraph(f"{edu.get('degree', '')}, {edu.get('institution', '')} ({edu.get('dates', '')})")

    if data.get("certifications"):
        doc.add_heading("Certifications", level=1)
        for cert in data["certifications"]:
            doc.add_paragraph(cert, style="List Bullet")

    if data.get("skills"):
        doc.add_heading("Skills", level=1)
        doc.add_paragraph(", ".join(data["skills"]))

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def reparse_pdf_text(pdf_bytes: bytes) -> str:
    """Export-then-reparse validation: confirms the generated PDF is actually text-extractable
    (not a pure-image render an ATS parser couldn't read), the same way the free analyzer
    already receives resume text."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages).strip()

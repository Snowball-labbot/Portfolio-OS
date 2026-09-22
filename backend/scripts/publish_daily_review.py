from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from sqlalchemy import select

from backend.database import SessionLocal
from backend.models import ResearchDocument, User
from backend.research.service import get_root_folder


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish or update a daily portfolio review.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--date", required=True, type=date.fromisoformat)
    parser.add_argument("--title", required=True)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--tag", action="append", default=[])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    content = args.file.read_text(encoding="utf-8").strip()
    if not content:
        raise SystemExit(f"Report is empty: {args.file}")

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == args.email.lower()))
        if not user:
            raise SystemExit(f"User not found: {args.email}")

        folder = get_root_folder(db, user.id, "briefs")
        document = db.scalar(
            select(ResearchDocument).where(
                ResearchDocument.user_id == user.id,
                ResearchDocument.document_type == "brief",
                ResearchDocument.as_of_date == args.date,
            )
        )
        action = "Updated" if document else "Published"
        if not document:
            document = ResearchDocument(user_id=user.id)
            db.add(document)

        document.folder_id = folder.id
        document.document_type = "brief"
        document.title = args.title
        document.summary = args.summary
        document.content_markdown = content
        document.tags = list(dict.fromkeys(["每日简报", "持仓复盘", *args.tag]))
        document.source_url = None
        document.as_of_date = args.date
        document.status = "published"
        db.commit()
        db.refresh(document)

    print(f"{action} daily review: {document.id} {args.title}")


if __name__ == "__main__":
    main()

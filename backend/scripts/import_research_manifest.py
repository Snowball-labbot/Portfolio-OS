import argparse
import json
from datetime import date
from pathlib import Path

from sqlalchemy import select

from ..database import SessionLocal
from ..models import ResearchDocument, ResearchFolder, User
from ..research.service import ensure_root_folders


def get_or_create_folder(
    db,
    *,
    user_id: str,
    parent_id: str,
    name: str,
    description: str | None = None,
    sort_order: int = 0,
) -> ResearchFolder:
    folder = db.scalar(
        select(ResearchFolder).where(
            ResearchFolder.user_id == user_id,
            ResearchFolder.parent_id == parent_id,
            ResearchFolder.name == name,
        )
    )
    if folder is None:
        folder = ResearchFolder(
            user_id=user_id,
            parent_id=parent_id,
            name=name,
            kind="custom",
            description=description,
            sort_order=sort_order,
        )
        db.add(folder)
        db.flush()
    else:
        folder.description = description or folder.description
        folder.sort_order = sort_order
    return folder


def main() -> None:
    parser = argparse.ArgumentParser(description="Import research Markdown files from a JSON manifest.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    scope = payload.get("scope", "industry")
    parent_name = payload["parent_folder"]
    parent_description = payload.get("parent_description")

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
        if user is None:
            raise SystemExit(f"User not found: {args.email}")
        roots = ensure_root_folders(db, user.id)
        root = next((folder for folder in roots if folder.kind == scope), None)
        if root is None:
            raise SystemExit(f"Research root not found: {scope}")
        parent = get_or_create_folder(
            db,
            user_id=user.id,
            parent_id=root.id,
            name=parent_name,
            description=parent_description,
        )

        imported = 0
        for index, item in enumerate(payload.get("documents", [])):
            folder = get_or_create_folder(
                db,
                user_id=user.id,
                parent_id=parent.id,
                name=item["folder"],
                description=item.get("folder_description"),
                sort_order=index,
            )
            content_path = manifest_path.parent / item["file"]
            content = content_path.read_text(encoding="utf-8")
            document = db.scalar(
                select(ResearchDocument).where(
                    ResearchDocument.user_id == user.id,
                    ResearchDocument.folder_id == folder.id,
                    ResearchDocument.title == item["title"],
                )
            )
            if document is None:
                document = ResearchDocument(
                    user_id=user.id,
                    folder_id=folder.id,
                    title=item["title"],
                )
                db.add(document)
            document.document_type = item.get("document_type", "company")
            document.summary = item.get("summary")
            document.content_markdown = content
            document.tags = item.get("tags", [])
            document.source_url = item.get("source_url")
            document.as_of_date = date.fromisoformat(item["as_of_date"]) if item.get("as_of_date") else None
            document.status = item.get("status", "published")
            imported += 1
        db.commit()
        print(f"Imported {imported} research documents for {user.email}.")


if __name__ == "__main__":
    main()

import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import UploadFile
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.models import ResearchAttachment, ResearchDocument, ResearchFolder, User
from backend.routers.research import (
    confirm_research_import,
    organize_research_import_route,
    preview_research_import,
)
from backend.schemas import ResearchImportConfirmIn, ResearchImportOrganizeIn
from backend.research.document_import import (
    DocumentImportError,
    MAX_IMPORT_BYTES,
    extract_research_file,
    organize_research_import,
)


class ResearchDocumentImportTests(TestCase):
    def test_markdown_is_decoded_and_metadata_is_suggested(self) -> None:
        result = extract_research_file(
            "半导体研究.md",
            "text/markdown",
            "# AI 芯片行业观察\n\nGPU 需求和先进封装是核心变量。\n\n## 证据\n\n财报数据待核实。".encode("utf-8"),
        )

        self.assertEqual(result["extraction_method"], "text")
        self.assertIn("GPU 需求", result["extracted_text"])
        self.assertEqual(len(result["sha256"]), 64)

    def test_unsupported_or_oversized_files_are_rejected(self) -> None:
        with self.assertRaises(DocumentImportError):
            extract_research_file("research.xlsx", "application/vnd.ms-excel", b"data")
        with self.assertRaises(DocumentImportError):
            extract_research_file("research.md", "text/markdown", b"x" * (MAX_IMPORT_BYTES + 1))

    def test_unconfigured_agnes_keeps_original_text_with_provenance(self) -> None:
        with patch(
            "backend.research.document_import.load_ai_config",
            return_value=SimpleNamespace(api_key="", base_url="https://api.agnes-ai.cn/v1"),
        ):
            result = organize_research_import(
                filename="macro-note.md",
                extraction_method="text",
                text="# 利率观察\n\n等待数据确认。",
                scope="macro",
            )

        self.assertFalse(result["ai_used"])
        self.assertIn("来源文件：macro-note.md", result["content_markdown"])
        self.assertTrue(result["warnings"])

    def test_import_routes_create_a_draft_and_mark_attachment_imported(self) -> None:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        db = Session(engine)
        try:
            user = User(email="import@example.com", password_hash="test", role="user")
            db.add(user)
            db.flush()
            folder = ResearchFolder(user_id=user.id, name="半导体", kind="industry")
            db.add(folder)
            db.flush()

            preview = asyncio.run(preview_research_import(
                UploadFile(file=BytesIO("# NVDA 研究\n\n数据待验证。".encode("utf-8")), filename="nvda.md"),
                "industry",
                user,
                db,
            ))
            draft = organize_research_import_route(
                preview["attachment_id"],
                ResearchImportOrganizeIn(folder_id=folder.id, document_type="industry"),
                user,
                db,
            )
            document = confirm_research_import(
                preview["attachment_id"],
                ResearchImportConfirmIn(
                    folder_id=folder.id,
                    document_type="industry",
                    title=draft["title"],
                    summary=draft["summary"],
                    content_markdown=draft["content_markdown"],
                    tags=draft["tags"],
                ),
                user,
                db,
            )

            attachment = db.scalar(select(ResearchAttachment).where(ResearchAttachment.id == preview["attachment_id"]))
            self.assertIsInstance(document, ResearchDocument)
            self.assertEqual(document.status, "draft")
            self.assertIn("来源文件：nvda.md", document.content_markdown)
            self.assertEqual(attachment.status, "imported")
            self.assertEqual(attachment.document_id, document.id)
        finally:
            db.close()
            engine.dispose()

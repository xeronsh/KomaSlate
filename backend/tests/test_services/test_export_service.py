"""导出服务单元测试"""
from __future__ import annotations

import pytest
from app.schemas.export import ExportResponse, ExportCompletedEventData


class TestExportSchemas:
    """导出 Schema 测试"""

    def test_export_response_processing(self):
        resp = ExportResponse(
            export_id="abc123",
            project_id=1,
            format="pdf",
            status="processing",
        )
        assert resp.status == "processing"
        assert resp.download_url is None

    def test_export_response_completed(self):
        resp = ExportResponse(
            export_id="abc123",
            project_id=1,
            format="webtoon",
            status="completed",
            download_url="/static/exports/test.png",
        )
        assert resp.status == "completed"
        assert resp.download_url == "/static/exports/test.png"

    def test_export_completed_event_data(self):
        data = ExportCompletedEventData(
            export_id="abc123",
            format="pdf",
            download_url="/static/exports/test.pdf",
            status="completed",
        )
        assert data.status == "completed"
        assert data.error is None

    def test_export_completed_event_data_failed(self):
        data = ExportCompletedEventData(
            export_id="abc123",
            format="webtoon",
            status="failed",
            error="Download failed",
        )
        assert data.status == "failed"
        assert data.error == "Download failed"


class TestFontUtils:
    """字体工具测试"""

    def test_get_chinese_font_path_system(self):
        from app.services.font_utils import get_chinese_font_path
        # Reset cache
        import app.services.font_utils as fu
        fu._cached_font_path = None

        path = get_chinese_font_path()
        # 系统有 Noto Sans CJK，应该能找到
        assert isinstance(path, str)

    def test_get_reportlab_font_name(self):
        from app.services.font_utils import get_reportlab_font_name
        import app.services.font_utils as fu
        fu._cached_font_path = None

        name = get_reportlab_font_name()
        assert isinstance(name, str)
        assert len(name) > 0

    def test_get_pillow_font_path(self):
        from app.services.font_utils import get_pillow_font_path
        import app.services.font_utils as fu
        fu._cached_font_path = None

        path = get_pillow_font_path()
        assert isinstance(path, str)


class TestExportService:
    """导出服务测试"""

    @pytest.fixture
    def service(self):
        from app.services.export_service import ExportService
        return ExportService()

    def test_export_service_init(self, service):
        assert service._http_client is None

    @pytest.mark.asyncio
    async def test_export_webtoon_requires_shots(self, service):
        from app.models.project import Project

        project = Project(id=1, title="Empty Project", style="anime")

        with pytest.raises(ValueError, match="没有可导出的分镜"):
            await service.export_webtoon(project, [])

    @pytest.mark.asyncio
    async def test_download_image_empty_url(self, service):
        result = await service._download_image("")
        assert result is None

    @pytest.mark.asyncio
    async def test_download_image_none_url(self, service):
        result = await service._download_image(None)
        assert result is None

    @pytest.mark.asyncio
    async def test_download_image_invalid_url(self, service):
        result = await service._download_image("not-a-url")
        assert result is None

    def test_load_pil_image_invalid(self, service):
        result = service._load_pil_image(b"not-an-image")
        assert result is None

    @pytest.mark.asyncio
    async def test_export_pdf_escapes_xml_characters(self, service, monkeypatch, tmp_path):
        """BE-07: ReportLab Paragraph escapes XML chars (<Hero>&\"Dialogue\") without SAX errors."""
        import app.services.export_service as exp_mod
        from app.models.project import Project, Shot

        monkeypatch.setattr(exp_mod, "EXPORTS_DIR", tmp_path)
        project = Project(
            id=1,
            title="<Title>&\"Test\"",
            style="anime",
            summary="<Hero>&\"Summary\" with <tag>",
        )
        shot = Shot(
            id=1,
            project_id=1,
            order=1,
            description="desc",
            dialogue='<Hero>&"Dialogue"',
        )
        url = await service.export_pdf(project, [shot], [])
        assert url.startswith("/static/exports/")
        pdf_file = tmp_path / url.removeprefix("/static/exports/")
        assert pdf_file.is_file() and pdf_file.stat().st_size > 0

    @pytest.mark.asyncio
    async def test_export_editorial_pack_streams_files(self, service, monkeypatch, tmp_path):
        """BE-07: editorial pack streams local files via ZipFile.write without dict buffer."""
        import zipfile
        import app.services.export_service as exp_mod
        from app.models.project import Project, Shot

        static_dir = tmp_path / "static"
        exports_dir = static_dir / "exports"
        videos_dir = static_dir / "videos"
        videos_dir.mkdir(parents=True)
        clip = videos_dir / "clip1.mp4"
        clip.write_bytes(b"MP4STREAM" * 100)

        monkeypatch.setattr(exp_mod, "EXPORTS_DIR", exports_dir)
        monkeypatch.setattr(exp_mod, "get_local_path", lambda u: clip if u == "/static/videos/clip1.mp4" else None)

        project = Project(id=2, title="Stream", style="anime")
        shot = Shot(id=10, project_id=2, order=1, description="s1", video_url="/static/videos/clip1.mp4")
        url = await service.export_editorial_pack(project, [shot], [])
        zip_path = exports_dir / url.removeprefix("/static/exports/")
        with zipfile.ZipFile(zip_path) as zf:
            assert "shots/01_shot_10_clip.mp4" in zf.namelist()
            assert zf.read("shots/01_shot_10_clip.mp4") == b"MP4STREAM" * 100

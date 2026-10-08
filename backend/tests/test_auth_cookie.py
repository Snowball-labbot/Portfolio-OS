from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from backend.dependencies import session_cookie_kwargs


class AuthCookieTests(TestCase):
    def test_cookie_supports_same_origin_marketplace_runtime(self) -> None:
        options = session_cookie_kwargs()
        self.assertEqual(options["samesite"], "lax")
        self.assertFalse(options["secure"])
        self.assertTrue(options["httponly"])
        self.assertEqual(options["path"], "/")

    def test_cookie_supports_cross_site_embedding_when_configured(self) -> None:
        """The marketplace launcher can request None + Secure for iframe hosts."""
        with patch("backend.dependencies.get_settings") as get_settings:
            get_settings.return_value = SimpleNamespace(
                session_cookie_name="asset_session",
                session_cookie_secure=True,
                session_cookie_samesite="none",
                session_days=14,
            )
            options = session_cookie_kwargs()
        self.assertEqual(options["samesite"], "none")
        self.assertTrue(options["secure"])
        self.assertTrue(options["httponly"])
        self.assertEqual(options["max_age"], 14 * 24 * 60 * 60)

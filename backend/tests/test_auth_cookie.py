from unittest import TestCase

from backend.dependencies import session_cookie_kwargs


class AuthCookieTests(TestCase):
    def test_cookie_supports_same_origin_marketplace_runtime(self) -> None:
        options = session_cookie_kwargs()
        self.assertEqual(options["samesite"], "lax")
        self.assertFalse(options["secure"])
        self.assertTrue(options["httponly"])
        self.assertEqual(options["path"], "/")

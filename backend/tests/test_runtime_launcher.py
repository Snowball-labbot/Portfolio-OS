import os
from unittest import TestCase
from unittest.mock import patch

from marketplace_runtime.launcher import resolve_cookie_policy


class CookiePolicyTests(TestCase):

    def test_defaults_keep_the_historical_policy(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(resolve_cookie_policy(None, None), ("lax", False))

    def test_embedded_policy_pairs_samesite_none_with_secure(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(resolve_cookie_policy("none", None), ("none", True))
            self.assertEqual(resolve_cookie_policy("none", True), ("none", True))

    def test_environment_configures_the_policy(self) -> None:
        with patch.dict(
            os.environ,
            {"SESSION_COOKIE_SAMESITE": "none", "SESSION_COOKIE_SECURE": "true"},
            clear=True,
        ):
            self.assertEqual(resolve_cookie_policy(None, None), ("none", True))

    def test_flags_win_over_the_environment(self) -> None:
        with patch.dict(
            os.environ,
            {"SESSION_COOKIE_SAMESITE": "strict", "SESSION_COOKIE_SECURE": "true"},
            clear=True,
        ):
            self.assertEqual(resolve_cookie_policy("lax", False), ("lax", False))

    def test_samesite_none_without_secure_is_rejected(self) -> None:
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(SystemExit):
            resolve_cookie_policy("none", False)

    def test_unknown_samesite_is_rejected(self) -> None:
        with patch.dict(os.environ, {"SESSION_COOKIE_SAMESITE": "sometimes"}, clear=True), self.assertRaises(SystemExit):
            resolve_cookie_policy(None, None)

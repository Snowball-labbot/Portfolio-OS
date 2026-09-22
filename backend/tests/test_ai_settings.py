import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from backend.ai_settings import RuntimeAIConfig, delete_ai_config, load_ai_config, save_ai_config


class AISettingsTests(TestCase):
    def test_saved_key_is_encrypted_and_can_be_loaded(self) -> None:
        secret = "unit-test-api-secret-123456"
        with TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {
                "PORTFOLIO_OS_DATA_DIR": directory,
                "PORTFOLIO_OS_ALLOW_INSECURE_KEYSTORE": "true",
            },
        ):
            saved = save_ai_config(RuntimeAIConfig(
                provider="agnes",
                base_url="https://api.agnes-ai.cn/v1",
                api_key=secret,
                model="agnes-2.5-flash",
                vision_model="agnes-2.5-flash",
            ))
            credential_file = Path(directory) / "config" / "ai-credentials.json"
            raw = credential_file.read_text(encoding="utf-8")

            self.assertTrue(saved.configured)
            self.assertNotIn(secret, raw)
            self.assertEqual(load_ai_config().api_key, secret)
            delete_ai_config()
            self.assertFalse(credential_file.exists())

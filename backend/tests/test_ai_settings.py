import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from backend.ai_settings import RuntimeAIConfig, delete_ai_config, load_ai_config, save_ai_config
from backend.research import briefing


def _config(**overrides) -> RuntimeAIConfig:
    fields = {
        "provider": "agnes",
        "base_url": "https://api.agnes-ai.cn/v1",
        "api_key": "unit-test-api-secret-123456",
        "model": "agnes-2.5-flash",
        "vision_model": "agnes-2.5-flash",
    }
    fields.update(overrides)
    return RuntimeAIConfig(**fields)


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


class ResearchAIGateTests(TestCase):
    def test_any_openai_compatible_endpoint_is_accepted(self) -> None:
        with patch.object(briefing, "load_ai_config", return_value=_config(
            provider="openai-compatible",
            base_url="https://api.openai.com/v1",
            model="gpt-4.1-mini",
            vision_model="gpt-4.1-mini",
        )):
            self.assertTrue(briefing.ai_is_configured())
            self.assertTrue(briefing.agnes_is_configured())

    def test_missing_credentials_are_reported_as_unconfigured(self) -> None:
        with patch.object(briefing, "load_ai_config", return_value=_config(api_key="")):
            self.assertFalse(briefing.ai_is_configured())

from functools import cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", hide_input_in_errors=True
    )

    auth_secret: SecretStr = SecretStr("")
    auth_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]
    app_url: str | None = None
    github_client_id: str = ""
    github_client_secret: SecretStr = SecretStr("")
    allowed_github_user_ids: str = ""
    database_url: str = ""
    old_database_url: str = ""
    typesafe_base_url: str = "https://api.typesafe.ai"
    typesafe_api_key: SecretStr = SecretStr("")
    typesafe_pipeline_base_urls: str = ""
    langfuse_public_key: str = ""
    langfuse_secret_key: SecretStr = SecretStr("")
    langfuse_base_url: str = "https://cloud.langfuse.com"
    langfuse_project_id: str = ""

    def allows_github(self, github_id: str) -> bool:
        return bool(github_id) and github_id in {
            part.strip() for part in self.allowed_github_user_ids.split(",")
        }

    def pipeline_base_urls(self) -> list[str]:
        return [
            value
            for part in self.typesafe_pipeline_base_urls.split(",")
            if (value := part.strip())
        ]

    def signing_key(self) -> str:
        key = self.auth_secret.get_secret_value()
        if len(key) < 32:
            raise RuntimeError("Set AUTH_SECRET to at least 32 characters")
        return key


@cache
def settings() -> Settings:
    return Settings()

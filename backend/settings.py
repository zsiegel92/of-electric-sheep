from functools import cache
from typing import Self

from pydantic import HttpUrl, PostgresDsn, SecretStr, TypeAdapter, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MIN_SECRET_LENGTH = 32
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", hide_input_in_errors=True)

    auth_secret: SecretStr
    database_url: PostgresDsn
    auth_origins: list[str]
    github_client_id: str = ""
    github_client_secret: SecretStr = SecretStr("")

    @model_validator(mode="after")
    def validate_credentials(self) -> Self:
        if (
            not self.auth_origins
            or len(self.auth_secret.get_secret_value()) < MIN_SECRET_LENGTH
        ):
            raise ValueError(
                "Set AUTH_ORIGINS and an AUTH_SECRET of at least 32 characters"
            )
        if bool(self.github_client_id) != bool(
            self.github_client_secret.get_secret_value()
        ):
            raise ValueError("Set both GitHub OAuth credentials")
        for value in self.auth_origins:
            origin = TypeAdapter(HttpUrl).validate_python(value)
            if value != str(origin).removesuffix("/") or origin.path != "/":
                raise ValueError(
                    "AUTH_ORIGINS must contain exact origins without a path"
                )
            if (
                origin.username is not None
                or origin.password is not None
                or origin.query is not None
                or origin.fragment is not None
                or (origin.scheme == "http" and origin.host not in LOCAL_HOSTS)
            ):
                raise ValueError("AUTH_ORIGINS must use HTTPS except on loopback")
        return self


@cache
def settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue] - fields come from the environment

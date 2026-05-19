from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./realhack_pilot.db"
    app_env: str = "dev"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    llm_provider: str = "openai"

    openai_api_key: str = ""
    openai_model_fast: str = "gpt-4o-mini"
    openai_model_smart: str = "gpt-4o"

    anthropic_api_key: str = ""
    anthropic_model_fast: str = "claude-haiku-4-5-20251001"
    anthropic_model_smart: str = "claude-sonnet-4-6"

    # Microsoft Graph integration
    graph_mode: str = "mock"  # "mock" or "graph"
    azure_tenant_id: str = ""
    azure_client_id: str = ""
    azure_client_secret: str = ""
    graph_mail_from: str = ""
    graph_parent_team_id: str = ""

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

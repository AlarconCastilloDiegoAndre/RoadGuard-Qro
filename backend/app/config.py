from typing import List, Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "RoadGuard Qro API"
    VERSION: str = "1.0.0"
    ENVIRONMENT: str = "production"

    # Server binding (Hugging Face Spaces runs on port 7860)
    HOST: str = "0.0.0.0"
    PORT: int = 7860

    # Model configuration
    MODEL_PATH: str = "models/model_int8.onnx"
    FALLBACK_MODEL_PATH: str = "models/model.onnx"
    CONFIDENCE_THRESHOLD: float = 0.25
    IOU_THRESHOLD: float = 0.45
    INPUT_SIZE: int = 640
    MAX_CONCURRENT_INFERENCES: int = 2

    # Upload & safety constraints
    MAX_IMAGE_SIZE_BYTES: int = 307200  # 300 KB max per compressed frame
    MAX_BATCH_SIZE: int = 15

    # Supabase credentials (Service Role for backend operations)
    SUPABASE_URL: str = "https://placeholder-project.supabase.co"
    SUPABASE_SERVICE_ROLE_KEY: str = "placeholder-service-role-key"
    SUPABASE_JWT_SECRET: Optional[str] = None

    # Allowed CORS Origins (Vercel & Cloudflare Pages)
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://road-guard-qro.vercel.app",
        "https://roadguard-qro.vercel.app",
        "https://road-guard-qro.pages.dev",
        "https://roadguard.pages.dev",
    ]
    CORS_ORIGIN_REGEX: str = r"^https:\/\/.*(\.vercel\.app|\.pages\.dev)$"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()

---
title: RoadGuard Qro Inference API
emoji: 🛣️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# RoadGuard Qro — Inference API (Hugging Face Space)

FastAPI microservice executing quantized ONNX Runtime road damage detection and PostGIS spatial deduplication.

## Environment Variables (Space Secrets)

Configure these in **Settings -> Variables and secrets**:

| Secret Key | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase Project URL (`https://xyz.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for PostGIS RPC and Storage uploads |
| `SUPABASE_JWT_SECRET` | (Optional) For HS256 JWT signature verification |
| `ENVIRONMENT` | `production` |

## Local Development (Docker)

```bash
docker build -t roadguard-api -f backend/Dockerfile .
docker run -p 7860:7860 --env-file backend/.env roadguard-api
```

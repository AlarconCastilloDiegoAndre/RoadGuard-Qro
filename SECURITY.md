# Security Policy

This repository is public. Secrets (Supabase service-role key, JWT secrets, Hugging Face tokens,
Kaggle tokens) must **only** live in the secret stores of GitHub Actions, Hugging Face Spaces,
Vercel / Cloudflare Pages, or local `.env` files that are git-ignored.

## Reporting a vulnerability

Please do not open a public issue. Email the maintainer at **alarconcastilloda@gmail.com** with a
description and reproduction steps. You will receive a response within 7 days.

## Security model (summary)

- Every table in Supabase has Row Level Security enabled and is scoped by `municipality_id`.
- The service-role key is used exclusively by the backend (FastAPI) and never shipped to browsers.
- Every API request is authenticated with a Supabase-issued JWT that the backend verifies.
- CORS is restricted to the deployed frontend origins.
- Full camera frames are discarded after inference; only small crops of detected damage are stored.

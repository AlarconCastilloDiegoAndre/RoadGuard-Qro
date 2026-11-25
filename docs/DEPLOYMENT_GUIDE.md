# RoadGuard Qro — Zero-Cost Cloud Deployment Manual

This guide explains how to connect and deploy every component of RoadGuard Qro using **100% free tiers**
with **no credit card required**.

---

## 1. Supabase (Database, Auth, Storage)

1. Open your Supabase Dashboard: [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Open your `roadguard-qro` project.
3. In the left sidebar, click **SQL Editor** -> **New query**.
4. Paste the entire content of [`supabase/migrations/20241124000000_init_roadguard.sql`](../supabase/migrations/20241124000000_init_roadguard.sql) and click **Run**.
5. (Optional) Run [`supabase/seed.sql`](../supabase/seed.sql) to add sample Querétaro data.
6. Go to **Project Settings** (gear icon) -> **API** to copy:
   - `Project URL`
   - `anon public key`
   - `service_role key` (keep secret)

---

## 2. Hugging Face Spaces (FastAPI Backend Container)

1. Go to [https://huggingface.co/new-space](https://huggingface.co/new-space).
2. Settings:
   - **Space name**: `roadguard-api`
   - **License**: `agpl-3.0`
   - **SDK**: **Docker** -> **Blank**
   - **Space Hardware**: **CPU basic • 2 vCPU • 16 GB • Free**
3. Create Space.
4. Go to **Settings** -> **Variables and secrets**:
   - Add Secret `SUPABASE_URL`: Your Supabase URL.
   - Add Secret `SUPABASE_SERVICE_ROLE_KEY`: Your service role key.
   - Add Variable `ENVIRONMENT`: `production`.
5. *(Automated Deploy via GitHub)*:
   - In GitHub: Go to repo **Settings** -> **Secrets and variables** -> **Actions**.
   - Add secret `HF_TOKEN`: Your Hugging Face Write token.
   - Any commit to `backend/` will push and rebuild the container automatically!

---

## 3. Vercel / Cloudflare Pages (Frontend Next.js)

### Option A: Vercel (Academic presentation)
1. Go to [https://vercel.com/new](https://vercel.com/new).
2. Select your `RoadGuard-Qro` repository.
3. Configure project:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Next.js`
4. Add Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase Anon Key
   - `NEXT_PUBLIC_API_URL`: Your Hugging Face Space URL (e.g. `https://AlarconCastilloDiegoAndre-roadguard-api.hf.space`)
5. Click **Deploy**.

### Option B: Cloudflare Pages (Commercial GovTech production)
1. Go to Cloudflare Dashboard -> **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**.
2. Select `RoadGuard-Qro`.
3. Build settings:
   - **Framework preset**: `Next.js (Static HTML Export)`
   - **Root directory**: `frontend`
   - **Build command**: `npm run build`
   - **Build output directory**: `out`
4. Add the same environment variables as above and click **Save and Deploy**.

---

## 4. Google Colab (YOLO11n Model Training)

1. Open [`ml/03_train_yolo.ipynb`](../ml/03_train_yolo.ipynb) in Google Colab using the badge at the top of the notebook.
2. Select Runtime: **Change runtime type** -> **T4 GPU** (Free).
3. Click **Runtime** -> **Run all**.
4. Checkpoints are automatically saved to your Google Drive (`MyDrive/RoadGuard/runs`).
5. Run [`ml/04_export_onnx.ipynb`](../ml/04_export_onnx.ipynb) to generate `model_int8.onnx` and copy it to `backend/models/`.

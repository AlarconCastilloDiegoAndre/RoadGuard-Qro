# Supabase Database Configuration & Setup Guide

This directory contains the database schema, PostGIS spatial indexing, stored procedures,
and Row Level Security (RLS) policies for RoadGuard Qro.

## How to Apply to your Supabase Project (100% Free)

1. Open your Supabase Dashboard: [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Select your `roadguard-qro` project.
3. In the left navigation bar, click on **SQL Editor**.
4. Click **New query** (or `+`).
5. Copy the entire contents of:
   - [`migrations/20241124000000_init_roadguard.sql`](migrations/20241124000000_init_roadguard.sql)
6. Paste it into the SQL editor and click **Run** (green button).
7. *(Optional for demo)*: Paste and run [`seed.sql`](seed.sql) to populate initial fleet vehicles
   and sample potholes located in Santiago de Querétaro.

## Database Highlights

- **Multi-tenant RLS**: Every table is filtered by `municipality_id = current_user_municipality_id()`.
- **Spatial Deduplication**: The `upsert_road_damage()` procedure clusters detections of the same
  damage type within an 8-meter radius using `ST_DWithin`.
- **Automatic Confirmation**: When a pothole or crack is observed by $\ge 2$ distinct vehicles or
  multiple times, its status transitions from `'reported'` to `'confirmed'`.
- **Storage**: Configures the `damage-crops` bucket with a 300 KB file limit and restricted access.

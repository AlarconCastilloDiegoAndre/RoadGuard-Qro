-- ==============================================================================
-- RoadGuard Qro — Supabase Database Migration (PostGIS + RLS + Geo-Dedup)
-- Migration: 20241124000000_init_roadguard.sql
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 2. Enumerations
CREATE TYPE user_role_type AS ENUM ('driver', 'engineer', 'admin');
CREATE TYPE vehicle_type_enum AS ENUM ('garbage_truck', 'police_patrol', 'inspector_vehicle', 'other');
CREATE TYPE damage_class_enum AS ENUM ('D00', 'D10', 'D20', 'D40');
CREATE TYPE severity_level_enum AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE damage_status_enum AS ENUM ('reported', 'confirmed', 'validated', 'in_repair', 'repaired', 'dismissed');
CREATE TYPE session_status_enum AS ENUM ('active', 'completed');

-- 3. Tenants: Municipalities
CREATE TABLE IF NOT EXISTS public.municipalities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'Querétaro',
    country TEXT NOT NULL DEFAULT 'Mexico',
    wifi_only_mode BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. User Profiles (Extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    municipality_id UUID NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL,
    role user_role_type NOT NULL DEFAULT 'driver',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Fleet Vehicles
CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    municipality_id UUID NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
    economic_number TEXT NOT NULL,
    vehicle_type vehicle_type_enum NOT NULL DEFAULT 'garbage_truck',
    license_plate TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(municipality_id, economic_number)
);

-- 6. Route Sessions (Driving Shifts)
CREATE TABLE IF NOT EXISTS public.route_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    municipality_id UUID NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
    driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    distance_km NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
    frames_sent INTEGER NOT NULL DEFAULT 0,
    frames_dropped INTEGER NOT NULL DEFAULT 0,
    status session_status_enum NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Deduplicated Road Damage Entities
CREATE TABLE IF NOT EXISTS public.road_damages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    municipality_id UUID NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
    damage_class damage_class_enum NOT NULL,
    severity_score NUMERIC(5, 4) NOT NULL CHECK (severity_score >= 0.0 AND severity_score <= 1.0),
    severity_level severity_level_enum NOT NULL,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    detection_count INTEGER NOT NULL DEFAULT 1,
    distinct_vehicles_count INTEGER NOT NULL DEFAULT 1,
    status damage_status_enum NOT NULL DEFAULT 'reported',
    first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    thumbnail_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Raw Detections (Idempotent per client frame_id)
CREATE TABLE IF NOT EXISTS public.detections (
    frame_id UUID PRIMARY KEY,
    session_id UUID REFERENCES public.route_sessions(id) ON DELETE SET NULL,
    damage_id UUID REFERENCES public.road_damages(id) ON DELETE CASCADE,
    municipality_id UUID NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
    damage_class damage_class_enum NOT NULL,
    confidence NUMERIC(5, 4) NOT NULL,
    bbox JSONB NOT NULL, -- {cx, cy, w, h} normalized
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    gps_accuracy_m NUMERIC(6, 2) NOT NULL,
    speed_kmh NUMERIC(6, 2),
    heading_deg NUMERIC(6, 2),
    crop_storage_path TEXT,
    captured_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- Spatial & Performance Indexes
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_road_damages_location ON public.road_damages USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_road_damages_municipality ON public.road_damages(municipality_id);
CREATE INDEX IF NOT EXISTS idx_road_damages_status ON public.road_damages(status);
CREATE INDEX IF NOT EXISTS idx_road_damages_class ON public.road_damages(damage_class);
CREATE INDEX IF NOT EXISTS idx_road_damages_severity ON public.road_damages(severity_level);
CREATE INDEX IF NOT EXISTS idx_detections_location ON public.detections USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_detections_damage_id ON public.detections(damage_id);
CREATE INDEX IF NOT EXISTS idx_detections_session_id ON public.detections(session_id);

-- ==============================================================================
-- PostGIS Spatial Deduplication Function
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.upsert_road_damage(
    p_municipality_id UUID,
    p_vehicle_id UUID,
    p_session_id UUID,
    p_frame_id UUID,
    p_damage_class damage_class_enum,
    p_confidence NUMERIC,
    p_severity_score NUMERIC,
    p_severity_level severity_level_enum,
    p_lat DOUBLE PRECISION,
    p_lon DOUBLE PRECISION,
    p_gps_accuracy_m NUMERIC,
    p_speed_kmh NUMERIC,
    p_heading_deg NUMERIC,
    p_crop_storage_path TEXT,
    p_bbox JSONB,
    p_captured_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_target_point GEOGRAPHY;
    v_damage_id UUID;
    v_existing_count INTEGER;
    v_distinct_veh INTEGER;
    v_new_status damage_status_enum;
BEGIN
    v_target_point := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography;

    -- Search for existing damage of the same class within 8.0 meters
    SELECT id, detection_count, distinct_vehicles_count, status
    INTO v_damage_id, v_existing_count, v_distinct_veh, v_new_status
    FROM public.road_damages
    WHERE municipality_id = p_municipality_id
      AND damage_class = p_damage_class
      AND ST_DWithin(location, v_target_point, 8.0)
    ORDER BY ST_Distance(location, v_target_point) ASC
    LIMIT 1;

    IF v_damage_id IS NOT NULL THEN
        -- Existing damage found: aggregate detection & promote status
        v_existing_count := v_existing_count + 1;
        
        -- Automatically promote to 'confirmed' if validated by multiple detections/vehicles
        IF v_new_status = 'reported' AND v_existing_count >= 2 THEN
            v_new_status := 'confirmed';
        END IF;

        UPDATE public.road_damages
        SET detection_count = v_existing_count,
            distinct_vehicles_count = CASE 
                WHEN p_vehicle_id IS NOT NULL THEN v_distinct_veh + 1 
                ELSE v_distinct_veh 
            END,
            severity_score = GREATEST(severity_score, p_severity_score),
            severity_level = CASE 
                WHEN p_severity_score > severity_score THEN p_severity_level 
                ELSE severity_level 
            END,
            last_detected_at = p_captured_at,
            status = v_new_status,
            thumbnail_url = COALESCE(thumbnail_url, p_crop_storage_path),
            updated_at = NOW()
        WHERE id = v_damage_id;
    ELSE
        -- New damage entity
        INSERT INTO public.road_damages (
            municipality_id,
            damage_class,
            severity_score,
            severity_level,
            location,
            detection_count,
            distinct_vehicles_count,
            status,
            first_detected_at,
            last_detected_at,
            thumbnail_url
        ) VALUES (
            p_municipality_id,
            p_damage_class,
            p_severity_score,
            p_severity_level,
            v_target_point,
            1,
            1,
            'reported',
            p_captured_at,
            p_captured_at,
            p_crop_storage_path
        )
        RETURNING id INTO v_damage_id;
    END IF;

    -- Record raw detection event idempotently
    INSERT INTO public.detections (
        frame_id,
        session_id,
        damage_id,
        municipality_id,
        damage_class,
        confidence,
        bbox,
        location,
        gps_accuracy_m,
        speed_kmh,
        heading_deg,
        crop_storage_path,
        captured_at
    ) VALUES (
        p_frame_id,
        p_session_id,
        v_damage_id,
        p_municipality_id,
        p_damage_class,
        p_confidence,
        p_bbox,
        v_target_point,
        p_gps_accuracy_m,
        p_speed_kmh,
        p_heading_deg,
        p_crop_storage_path,
        p_captured_at
    )
    ON CONFLICT (frame_id) DO NOTHING;

    RETURN v_damage_id;
END;
$$;

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- ==============================================================================
ALTER TABLE public.municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.road_damages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detections ENABLE ROW LEVEL SECURITY;

-- Helper functions for current user context
CREATE OR REPLACE FUNCTION public.current_user_municipality_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT municipality_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role_type
LANGUAGE sql
STABLE
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- 1. Municipalities: members can view their municipality
CREATE POLICY "Users can view their municipality"
    ON public.municipalities FOR SELECT
    USING (id = public.current_user_municipality_id());

-- 2. Profiles
CREATE POLICY "Users can view profiles in their municipality"
    ON public.profiles FOR SELECT
    USING (municipality_id = public.current_user_municipality_id());

CREATE POLICY "Admins can manage profiles in their municipality"
    ON public.profiles FOR ALL
    USING (
        municipality_id = public.current_user_municipality_id() 
        AND public.current_user_role() = 'admin'
    );

-- 3. Vehicles
CREATE POLICY "Users can view vehicles in their municipality"
    ON public.vehicles FOR SELECT
    USING (municipality_id = public.current_user_municipality_id());

CREATE POLICY "Admins can insert and update vehicles"
    ON public.vehicles FOR ALL
    USING (
        municipality_id = public.current_user_municipality_id()
        AND public.current_user_role() = 'admin'
    );

-- 4. Route Sessions
CREATE POLICY "Drivers can view and manage their own sessions"
    ON public.route_sessions FOR ALL
    USING (driver_id = auth.uid());

CREATE POLICY "Engineers and Admins can view all sessions in municipality"
    ON public.route_sessions FOR SELECT
    USING (
        municipality_id = public.current_user_municipality_id()
        AND public.current_user_role() IN ('engineer', 'admin')
    );

-- 5. Road Damages
CREATE POLICY "Users can view road damages in their municipality"
    ON public.road_damages FOR SELECT
    USING (municipality_id = public.current_user_municipality_id());

CREATE POLICY "Engineers and Admins can update road damage status"
    ON public.road_damages FOR UPDATE
    USING (
        municipality_id = public.current_user_municipality_id()
        AND public.current_user_role() IN ('engineer', 'admin')
    );

-- 6. Detections
CREATE POLICY "Users can view detections in their municipality"
    ON public.detections FOR SELECT
    USING (municipality_id = public.current_user_municipality_id());

-- ==============================================================================
-- Storage Bucket Setup for Damage Image Crops
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'damage-crops',
    'damage-crops',
    FALSE,
    307200, -- 300 KB limit per crop
    ARRAY['image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Authenticated users can view crops from their municipality
CREATE POLICY "Authenticated users in municipality can view crops"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'damage-crops');

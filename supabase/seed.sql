-- ==============================================================================
-- RoadGuard Qro — Development & Demonstration Seed Data
-- ==============================================================================

-- 1. Seed Municipality: Municipio de Querétaro
INSERT INTO public.municipalities (id, name, state, country, wifi_only_mode)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Municipio de Querétaro',
    'Querétaro',
    'Mexico',
    FALSE
)
ON CONFLICT (id) DO NOTHING;

-- 2. Seed Vehicles: Municipal fleet (garbage trucks and inspection units)
INSERT INTO public.vehicles (id, municipality_id, economic_number, vehicle_type, license_plate)
VALUES 
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'REC-104', 'garbage_truck', 'SS-4819-A'),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'REC-108', 'garbage_truck', 'SS-5120-B'),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'OBR-012', 'inspector_vehicle', 'UM-9021-C')
ON CONFLICT (id) DO NOTHING;

-- 3. Seed Realistic Road Damages in Querétaro (5 de Febrero, Bernardo Quintana, Constituyentes)
-- Coordinates around Downtown Querétaro: Lat ~20.58 to 20.62, Lon ~ -100.38 to -100.42
INSERT INTO public.road_damages (
    id,
    municipality_id,
    damage_class,
    severity_score,
    severity_level,
    location,
    detection_count,
    distinct_vehicles_count,
    status,
    first_detected_at,
    last_detected_at
) VALUES
    -- Pothole near Av. 5 de Febrero & Zaragoza
    (
        'd0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'D40',
        0.8850,
        'critical',
        ST_SetSRID(ST_MakePoint(-100.4082, 20.5861), 4326)::geography,
        4,
        2,
        'confirmed',
        NOW() - INTERVAL '3 days',
        NOW() - INTERVAL '2 hours'
    ),
    -- Severe alligator cracking on Bernardo Quintana near Los Arcos
    (
        'd0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000001',
        'D20',
        0.7200,
        'high',
        ST_SetSRID(ST_MakePoint(-100.3755, 20.5982), 4326)::geography,
        2,
        1,
        'validated',
        NOW() - INTERVAL '5 days',
        NOW() - INTERVAL '1 day'
    ),
    -- Transverse crack on Av. Constituyentes
    (
        'd0000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000001',
        'D10',
        0.4400,
        'medium',
        ST_SetSRID(ST_MakePoint(-100.3950, 20.5835), 4326)::geography,
        1,
        1,
        'reported',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
    ),
    -- Pothole on Carretera a San Luis Potosí near Juriquilla
    (
        'd0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000001',
        'D40',
        0.7950,
        'critical',
        ST_SetSRID(ST_MakePoint(-100.4480, 20.6920), 4326)::geography,
        5,
        3,
        'in_repair',
        NOW() - INTERVAL '7 days',
        NOW() - INTERVAL '4 hours'
    )
ON CONFLICT (id) DO NOTHING;

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Filter, Download, RefreshCw, Camera, Radio, Trash2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchRoadDamagesFromAPI, updateRoadDamageStatusAPI, deleteRoadDamageAPI, RoadDamageDTO } from '@/lib/api';

type RoadDamage = RoadDamageDTO;

// Fallback seed data for Santiago de Querétaro
const INITIAL_DEMO_DAMAGES: RoadDamage[] = [
  {
    id: 'd0000000-0000-0000-0000-000000000001',
    damage_class: 'D40',
    severity_score: 0.885,
    severity_level: 'critical',
    detection_count: 5,
    distinct_vehicles_count: 3,
    status: 'confirmed',
    last_detected_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    lat: 20.5861,
    lon: -100.4082,
    is_live: false,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000002',
    damage_class: 'D20',
    severity_score: 0.72,
    severity_level: 'high',
    detection_count: 3,
    distinct_vehicles_count: 2,
    status: 'validated',
    last_detected_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    lat: 20.5982,
    lon: -100.3755,
    is_live: false,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000004',
    damage_class: 'D40',
    severity_score: 0.795,
    severity_level: 'critical',
    detection_count: 4,
    distinct_vehicles_count: 2,
    status: 'in_repair',
    last_detected_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    lat: 20.692,
    lon: -100.448,
    is_live: false,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000003',
    damage_class: 'D10',
    severity_score: 0.44,
    severity_level: 'medium',
    detection_count: 1,
    distinct_vehicles_count: 1,
    status: 'reported',
    last_detected_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    lat: 20.5835,
    lon: -100.395,
    is_live: false,
  },
];

const CLASS_LABELS = {
  D40: 'Bache (D40)',
  D20: 'Piel de Cocodrilo (D20)',
  D10: 'Grieta Transversal (D10)',
  D00: 'Grieta Longitudinal (D00)',
};

const SEVERITY_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export default function MunicipalDashboard() {
  const [damages, setDamages] = useState<RoadDamage[]>(INITIAL_DEMO_DAMAGES);
  const [selectedDamage, setSelectedDamage] = useState<RoadDamage | null>(INITIAL_DEMO_DAMAGES[0]);
  const [filterClass, setFilterClass] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [mapReady, setMapReady] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // Fetch live damages from FastAPI backend (which merges Supabase PostGIS + live route captures)
  const fetchDamages = useCallback(async (showSpinner: boolean = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const apiDamages = await fetchRoadDamagesFromAPI();
      if (apiDamages && apiDamages.length > 0) {
        // Filter out indoor fallback test coordinate (20.5888, -100.3899)
        const cleaned = apiDamages.filter(
          (item) => !(Math.abs(item.lat - 20.5888) < 0.0001 && Math.abs(item.lon - (-100.3899)) < 0.0001)
        );
        const list = cleaned.length > 0 ? cleaned : INITIAL_DEMO_DAMAGES;
        setDamages(list);
        setSelectedDamage((prev) => {
          if (!prev) return list[0];
          const updated = list.find((item) => item.id === prev.id);
          return updated || list[0];
        });
        setLastSyncTime(new Date().toLocaleTimeString());
        return;
      }
    } catch {
      // Fallback
    } finally {
      if (showSpinner) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDamages(true);
    // Poll every 8 seconds for live motorcycle detections
    const interval = setInterval(() => {
      fetchDamages(false);
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchDamages]);

  // Initialize MapLibre GL
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    let isMounted = true;

    import('maplibre-gl').then((maplibregl) => {
      if (!isMounted || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE,
        center: [-100.392, 20.595],
        zoom: 12.5,
      });

      map.addControl(new maplibregl.NavigationControl(), 'top-right');

      map.on('load', () => {
        if (!isMounted) return;
        setMapReady(true);
        map.resize();
      });

      const handleResize = () => map.resize();
      window.addEventListener('resize', handleResize);

      mapInstanceRef.current = map;
    });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Filter pipeline
  const filteredDamages = damages.filter((d) => {
    if (filterClass !== 'all' && d.damage_class !== filterClass) return false;
    if (filterSeverity !== 'all' && d.severity_level !== filterSeverity) return false;
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    return true;
  });

  // Render Markers whenever Map is ready OR Filtered damages update
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    import('maplibre-gl').then((maplibregl) => {
      filteredDamages.forEach((d) => {
        const el = document.createElement('div');
        el.className = 'damage-marker-pin';
        const size = d.is_live ? '24px' : '20px';
        el.style.width = size;
        el.style.height = size;
        el.style.borderRadius = '50%';
        el.style.backgroundColor = SEVERITY_COLORS[d.severity_level];
        el.style.border = d.is_live ? '3px solid #38bdf8' : '2.5px solid #ffffff';
        el.style.boxShadow = `0 0 14px ${SEVERITY_COLORS[d.severity_level]}, 0 2px 5px rgba(0,0,0,0.6)`;
        el.style.cursor = 'pointer';

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedDamage(d);
          map.flyTo({ center: [d.lon, d.lat], zoom: 16 });
        });

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([d.lon, d.lat])
          .addTo(map);

        markersRef.current.push(marker);
      });
    });
  }, [mapReady, filteredDamages]);

  // Export CSV for Public Works asphalt budget
  const exportCSV = () => {
    const headers = ['ID', 'Origen', 'Clase', 'Severidad_Score', 'Nivel', 'Veces_Detectado', 'Unidades', 'Estado', 'Latitud', 'Longitud', 'Ultima_Deteccion'];
    const rows = filteredDamages.map((d) => [
      d.id,
      d.is_live ? 'RUTA_EN_VIVO' : 'SEED_DEMO',
      d.damage_class,
      d.severity_score,
      d.severity_level,
      d.detection_count,
      d.distinct_vehicles_count,
      d.status,
      d.lat,
      d.lon,
      d.last_detected_at,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `roadguard_qro_reporte_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Update Status in Backend API, Supabase & Local State
  const updateStatus = async (damageId: string, newStatus: RoadDamage['status']) => {
    setDamages((prev) =>
      prev.map((d) => (d.id === damageId ? { ...d, status: newStatus } : d))
    );
    if (selectedDamage && selectedDamage.id === damageId) {
      setSelectedDamage((prev) => (prev ? { ...prev, status: newStatus } : null));
    }
    await updateRoadDamageStatusAPI(damageId, newStatus);
    try {
      await supabase.from('road_damages').update({ status: newStatus }).eq('id', damageId);
    } catch {
      // Handled by backend API
    }
  };

  // Delete false positive / test capture
  const deleteDamage = async (damageId: string) => {
    setDamages((prev) => {
      const remaining = prev.filter((d) => d.id !== damageId);
      setSelectedDamage(remaining[0] || null);
      return remaining;
    });
    await deleteRoadDamageAPI(damageId);
    try {
      await supabase.from('road_damages').delete().eq('id', damageId);
    } catch {
      // Handled by backend API
    }
  };

  const liveCount = damages.filter((d) => d.is_live).length;

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Top Navigation */}
      <header className="h-14 border-b border-slate-800 bg-slate-900 px-4 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-bold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
            RoadGuard <span className="text-sky-400 font-extrabold text-xs bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800">DASHBOARD</span>
          </Link>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="text-xs text-slate-400 hidden sm:inline">
            Secretaría de Obras Públicas • {liveCount > 0 ? `${liveCount} captura(s) en vivo` : 'Monitoreo activo'}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchDamages(true)}
            className="px-3 py-1.5 text-xs font-semibold text-sky-300 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-800/80 rounded-lg flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Actualizar {lastSyncTime ? `(${lastSyncTime})` : ''}
          </button>
          <button
            onClick={exportCSV}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center gap-1.5 transition"
          >
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </button>
          <Link
            href="/capture"
            className="px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg flex items-center gap-1.5 transition"
          >
            Modo Chofer
          </Link>
        </div>
      </header>

      {/* Main Split Layout: Filter & Table on Left, Map on Right */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Control & Prioritization Panel */}
        <div className="w-full md:w-96 bg-slate-900/95 border-r border-slate-800 flex flex-col overflow-hidden shrink-0 z-10">
          {/* Filters Bar */}
          <div className="p-3 border-b border-slate-800 space-y-2 bg-slate-900">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
              <span className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-sky-400" /> Filtros ({filteredDamages.length} daños)
              </span>
              <button
                onClick={() => {
                  setFilterClass('all');
                  setFilterSeverity('all');
                  setFilterStatus('all');
                }}
                className="text-sky-400 hover:underline"
              >
                Limpiar
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <select
                value={filterClass}
                onChange={(e) => setFilterClass(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300"
              >
                <option value="all">Todas clases</option>
                <option value="D40">Baches (D40)</option>
                <option value="D20">Cocodrilo (D20)</option>
                <option value="D10">Transversal</option>
                <option value="D00">Longitudinal</option>
              </select>

              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300"
              >
                <option value="all">Severidad</option>
                <option value="critical">Crítica</option>
                <option value="high">Alta</option>
                <option value="medium">Media</option>
                <option value="low">Baja</option>
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300"
              >
                <option value="all">Estados</option>
                <option value="reported">Reportado</option>
                <option value="confirmed">Confirmado</option>
                <option value="validated">Validado</option>
                <option value="in_repair">En reparación</option>
                <option value="repaired">Reparado</option>
              </select>
            </div>
          </div>

          {/* Damage Items Priority List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {filteredDamages.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  setSelectedDamage(item);
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.flyTo({ center: [item.lon, item.lat], zoom: 16 });
                  }
                }}
                className={`p-3 cursor-pointer transition flex items-center justify-between ${
                  selectedDamage?.id === item.id ? 'bg-sky-950/50 border-l-4 border-sky-400' : 'hover:bg-slate-800/40'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: SEVERITY_COLORS[item.severity_level] }}
                    />
                    <span className="font-bold text-xs text-white">{CLASS_LABELS[item.damage_class]}</span>
                    {item.is_live && (
                      <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                        <Radio className="w-2.5 h-2.5 animate-pulse" /> EN VIVO
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                    <span>Score: {(item.severity_score * 100).toFixed(0)}%</span>
                    <span>•</span>
                    <span>{item.detection_count} det.</span>
                    <span>•</span>
                    <span className="font-mono text-[10px]">
                      {item.lat.toFixed(4)}, {item.lon.toFixed(4)}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Selected Item Detail Inspector */}
          {selectedDamage && (
            <div className="p-4 bg-slate-950 border-t border-slate-800 shrink-0 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase">Detalle del Daño</span>
                <span
                  className="text-xs font-black uppercase px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: `${SEVERITY_COLORS[selectedDamage.severity_level]}20`,
                    color: SEVERITY_COLORS[selectedDamage.severity_level],
                  }}
                >
                  Severidad {selectedDamage.severity_level}
                </span>
              </div>

              {/* Cropped Road Damage Thumbnail Photo */}
              {selectedDamage.thumbnail_url && (
                <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black h-28 flex items-center justify-center">
                  <img
                    src={selectedDamage.thumbnail_url}
                    alt="Recorte del pavimento"
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-1.5 left-2 bg-slate-950/85 text-[10px] text-sky-300 px-2 py-0.5 rounded flex items-center gap-1 border border-slate-800">
                    <Camera className="w-3 h-3" /> Evidencia capturada en ruta
                  </span>
                </div>
              )}

              <div className="text-xs text-slate-400 space-y-1">
                <p>📍 Coord: {selectedDamage.lat.toFixed(5)}, {selectedDamage.lon.toFixed(5)}</p>
                <p>
                  🚛 Confirmaciones: {selectedDamage.detection_count} detección(es) ({selectedDamage.distinct_vehicles_count} unidad)
                </p>
                <p>🕒 Última detección: {new Date(selectedDamage.last_detected_at).toLocaleString()}</p>
              </div>

              {/* Status Action Buttons for Engineers */}
              <div className="pt-2 border-t border-slate-800 flex flex-wrap gap-1.5">
                <button
                  onClick={() => updateStatus(selectedDamage.id, 'validated')}
                  className="px-2 py-1 text-[11px] font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-600/30"
                >
                  Validar
                </button>
                <button
                  onClick={() => updateStatus(selectedDamage.id, 'in_repair')}
                  className="px-2 py-1 text-[11px] font-semibold bg-amber-600/20 text-amber-400 border border-amber-500/30 rounded hover:bg-amber-600/30"
                >
                  Asignar Cuadrilla
                </button>
                <button
                  onClick={() => updateStatus(selectedDamage.id, 'repaired')}
                  className="px-2 py-1 text-[11px] font-semibold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-600/30"
                >
                  Marcar Reparado
                </button>
                <button
                  onClick={() => updateStatus(selectedDamage.id, 'dismissed')}
                  className="px-2 py-1 text-[11px] font-semibold bg-rose-600/20 text-rose-400 border border-rose-500/30 rounded hover:bg-rose-600/30"
                >
                  Descartar
                </button>
                <button
                  onClick={() => deleteDamage(selectedDamage.id)}
                  className="px-2 py-1 text-[11px] font-semibold bg-rose-950 text-rose-300 border border-rose-700/60 rounded hover:bg-rose-900 flex items-center gap-1 ml-auto"
                  title="Eliminar registro permanentemente"
                >
                  <Trash2 className="w-3 h-3" /> Eliminar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Map Canvas */}
        <div className="flex-1 relative bg-slate-950 min-h-[450px] w-full h-full">
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />

          {/* Map Loading indicator */}
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-20">
              <div className="flex items-center gap-2 text-sky-400 font-semibold text-sm">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Cargando mapa de Querétaro...
              </div>
            </div>
          )}

          {/* Map Legend */}
          <div className="absolute bottom-4 right-4 bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs shadow-xl backdrop-blur z-20">
            <span className="font-bold text-white block mb-2">Severidad del Daño</span>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-slate-300">Crítica (&gt; 75%) — Asfalto roto / Bache</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-orange-500" />
                <span className="text-slate-300">Alta (&gt; 55%) — Piel de cocodrilo</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-slate-300">Media (&gt; 35%) — Grieta transversal</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-slate-300">Baja (&lt; 35%) — Grieta longitudinal</span>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
                <span className="w-3 h-3 rounded-full bg-red-500 border-2 border-sky-400" />
                <span className="text-sky-300 font-semibold">Borde Azul = Captura en Vivo</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

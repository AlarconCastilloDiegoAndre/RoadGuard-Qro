'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Filter, Download, RefreshCw, Camera, Radio, Trash2,
  Plus, Minus, Compass, Crosshair, Layers, Map as MapIcon, List
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  fetchRoadDamagesFromAPI,
  updateRoadDamageStatusAPI,
  deleteRoadDamageAPI,
  RoadDamageDTO
} from '@/lib/api';

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

const CLASS_LABELS: Record<RoadDamage['damage_class'], string> = {
  D40: 'Bache (D40)',
  D20: 'Piel de Cocodrilo (D20)',
  D10: 'Grieta Transversal (D10)',
  D00: 'Grieta Longitudinal (D00)',
};

const SEVERITY_COLORS: Record<RoadDamage['severity_level'], string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
};

type TileStyleKey = 'dark' | 'streets' | 'satellite';

const TILE_PROVIDERS: Record<TileStyleKey, { label: string; getUrl: (z: number, x: number, y: number) => string }> = {
  dark: {
    label: 'Oscuro',
    getUrl: (z, x, y) => `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
  },
  streets: {
    label: 'Calles OSM',
    getUrl: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
  satellite: {
    label: 'Satélite',
    getUrl: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  },
};

// Web Mercator (EPSG:3857) projection helpers (zero WebGL required — works in Brave with strict shields!)
function latLonToWorldPx(lat: number, lon: number, zoom: number) {
  const scale = 256 * Math.pow(2, zoom);
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function worldPxToLatLon(x: number, y: number, zoom: number) {
  const scale = 256 * Math.pow(2, zoom);
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {
    lat: Math.max(-85, Math.min(85, lat)),
    lon: Math.max(-180, Math.min(180, lon)),
  };
}

export default function MunicipalDashboard() {
  const [damages, setDamages] = useState<RoadDamage[]>(INITIAL_DEMO_DAMAGES);
  const [selectedDamage, setSelectedDamage] = useState<RoadDamage | null>(INITIAL_DEMO_DAMAGES[0]);
  const [filterClass, setFilterClass] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('map');

  // 2D Slippy Map viewport state
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number }>({ lat: 20.605, lon: -100.415 });
  const [mapZoom, setMapZoom] = useState<number>(12);
  const [tileStyle, setTileStyle] = useState<TileStyleKey>('dark');
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 900, h: 650 });

  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ dragging: boolean; startX: number; startY: number; startCenter: { lat: number; lon: number } }>({
    dragging: false,
    startX: 0,
    startY: 0,
    startCenter: { lat: 20.605, lon: -100.415 },
  });
  const hasAutoCenteredLiveRef = useRef<string | null>(null);

  // Measure map container size
  useEffect(() => {
    const updateSize = () => {
      if (mapViewportRef.current) {
        const rect = mapViewportRef.current.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          setViewportSize({ w: rect.width, h: rect.height });
        }
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    const timer = setTimeout(updateSize, 200);
    return () => {
      window.removeEventListener('resize', updateSize);
      clearTimeout(timer);
    };
  }, [mobileTab]);

  // Fetch live damages from FastAPI backend
  const fetchDamages = useCallback(async (showSpinner: boolean = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const apiDamages = await fetchRoadDamagesFromAPI();
      if (apiDamages && apiDamages.length > 0) {
        setDamages(apiDamages);
        setSelectedDamage((prev) => {
          if (!prev) return apiDamages[0];
          const updated = apiDamages.find((item) => item.id === prev.id);
          return updated || apiDamages[0];
        });

        // Automatically fly to the newest live detection the first time it appears
        const newestLive = apiDamages.find((d) => d.is_live);
        if (newestLive && hasAutoCenteredLiveRef.current !== newestLive.id) {
          hasAutoCenteredLiveRef.current = newestLive.id;
          setMapCenter({ lat: newestLive.lat, lon: newestLive.lon });
          setMapZoom(15);
          setSelectedDamage(newestLive);
        }

        setLastSyncTime(new Date().toLocaleTimeString());
        return;
      }
    } catch {
      // Retain local list
    } finally {
      if (showSpinner) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDamages(true);
    const interval = setInterval(() => {
      fetchDamages(false);
    }, 6000);
    return () => clearInterval(interval);
  }, [fetchDamages]);

  // Filter pipeline
  const filteredDamages = useMemo(() => {
    return damages.filter((d) => {
      if (filterClass !== 'all' && d.damage_class !== filterClass) return false;
      if (filterSeverity !== 'all' && d.severity_level !== filterSeverity) return false;
      if (filterStatus !== 'all' && d.status !== filterStatus) return false;
      return true;
    });
  }, [damages, filterClass, filterSeverity, filterStatus]);

  // Fly to a specific coordinate
  const flyToDamage = (d: RoadDamage, targetZoom: number = 16) => {
    setSelectedDamage(d);
    setMapCenter({ lat: d.lat, lon: d.lon });
    setMapZoom(targetZoom);
  };

  // Mouse & Touch drag handlers for panning the map
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startCenter: { ...mapCenter },
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.dragging) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    const startWorld = latLonToWorldPx(
      dragStateRef.current.startCenter.lat,
      dragStateRef.current.startCenter.lon,
      mapZoom
    );
    const nextLatLon = worldPxToLatLon(startWorld.x - dx, startWorld.y - dy, mapZoom);
    setMapCenter(nextLatLon);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current.dragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    setMapZoom((z) => Math.max(4, Math.min(18, z + delta)));
  };

  // Compute visible 256x256 raster tiles and marker pixel coordinates
  const { tiles, markerPositions } = useMemo(() => {
    const z = Math.round(mapZoom);
    const maxTileIdx = Math.pow(2, z) - 1;
    const centerWorld = latLonToWorldPx(mapCenter.lat, mapCenter.lon, z);
    const halfW = viewportSize.w / 2;
    const halfH = viewportSize.h / 2;

    const minTx = Math.floor((centerWorld.x - halfW) / 256) - 1;
    const maxTx = Math.floor((centerWorld.x + halfW) / 256) + 1;
    const minTy = Math.floor((centerWorld.y - halfH) / 256) - 1;
    const maxTy = Math.floor((centerWorld.y + halfH) / 256) + 1;

    const tileList: Array<{ key: string; url: string; left: number; top: number }> = [];
    const provider = TILE_PROVIDERS[tileStyle];

    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        if (ty < 0 || ty > maxTileIdx) continue;
        const wrappedTx = ((tx % (maxTileIdx + 1)) + (maxTileIdx + 1)) % (maxTileIdx + 1);
        const left = Math.round(halfW + tx * 256 - centerWorld.x);
        const top = Math.round(halfH + ty * 256 - centerWorld.y);
        tileList.push({
          key: `${tileStyle}-${z}-${wrappedTx}-${ty}`,
          url: provider.getUrl(z, wrappedTx, ty),
          left,
          top,
        });
      }
    }

    const markers = filteredDamages.map((d) => {
      const pt = latLonToWorldPx(d.lat, d.lon, z);
      return {
        damage: d,
        x: Math.round(halfW + (pt.x - centerWorld.x)),
        y: Math.round(halfH + (pt.y - centerWorld.y)),
      };
    });

    return { tiles: tileList, markerPositions: markers };
  }, [mapCenter, mapZoom, viewportSize, tileStyle, filteredDamages]);

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
    } catch {}
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
    } catch {}
  };

  const liveDamages = damages.filter((d) => d.is_live);

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Top Navigation */}
      <header className="h-14 border-b border-slate-800 bg-slate-900 px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-bold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
            RoadGuard <span className="text-sky-400 font-extrabold text-xs bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800">DASHBOARD</span>
          </Link>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="text-xs text-slate-400 hidden sm:inline">
            Secretaría de Obras Públicas •{' '}
            {liveDamages.length > 0 ? (
              <span className="text-emerald-400 font-bold">{liveDamages.length} bache(s) detectado(s) en vivo</span>
            ) : (
              'Monitoreo activo'
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {liveDamages.length > 0 && (
            <button
              onClick={() => {
                flyToDamage(liveDamages[0], 16);
                setMobileTab('map');
              }}
              className="px-2.5 py-1.5 text-xs font-bold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-600/60 rounded-lg flex items-center gap-1.5 transition"
            >
              <Crosshair className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              Ir a Captura en Vivo
            </button>
          )}
          <button
            onClick={() => fetchDamages(true)}
            className="px-2.5 py-1.5 text-xs font-semibold text-sky-300 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-800/80 rounded-lg flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Actualizar</span> {lastSyncTime ? `(${lastSyncTime})` : ''}
          </button>
          <button
            onClick={exportCSV}
            className="px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center gap-1.5 transition"
          >
            <Download className="w-3.5 h-3.5" /> <span className="hidden sm:inline">CSV</span>
          </button>
          <Link
            href="/capture"
            className="px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg flex items-center gap-1.5 transition"
          >
            Modo Chofer
          </Link>
        </div>
      </header>

      {/* Mobile Tab Switcher (List vs Map on phone screens) */}
      <div className="flex md:hidden border-b border-slate-800 bg-slate-900 shrink-0 text-xs font-bold">
        <button
          onClick={() => setMobileTab('map')}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition ${
            mobileTab === 'map'
              ? 'border-sky-400 text-sky-400 bg-sky-950/30'
              : 'border-transparent text-slate-400'
          }`}
        >
          <MapIcon className="w-4 h-4" /> Ver Mapa ({filteredDamages.length})
        </button>
        <button
          onClick={() => setMobileTab('list')}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition ${
            mobileTab === 'list'
              ? 'border-sky-400 text-sky-400 bg-sky-950/30'
              : 'border-transparent text-slate-400'
          }`}
        >
          <List className="w-4 h-4" /> Lista y Evidencia ({filteredDamages.length})
        </button>
      </div>

      {/* Main Split Layout: Filter & Table on Left, Map on Right */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Control & Prioritization Panel */}
        <div
          className={`w-full md:w-96 bg-slate-900/95 border-r border-slate-800 flex-col overflow-hidden shrink-0 z-10 ${
            mobileTab === 'list' ? 'flex flex-1' : 'hidden md:flex'
          }`}
        >
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
                  flyToDamage(item, 16);
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
                      <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
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
                <div className="text-right flex flex-col items-end gap-1">
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {item.status}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      flyToDamage(item, 16);
                      setMobileTab('map');
                    }}
                    className="md:hidden text-[10px] text-sky-400 font-semibold underline"
                  >
                    Ver en mapa →
                  </button>
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

        {/* ==================== RIGHT 2D INTERACTIVE MAP (BRAVE & MOBILE COMPATIBLE) ==================== */}
        <div
          ref={mapViewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          className={`flex-1 relative bg-slate-950 overflow-hidden select-none cursor-grab active:cursor-grabbing ${
            mobileTab === 'map' ? 'flex' : 'hidden md:flex'
          }`}
          style={{ touchAction: 'none' }}
        >
          {/* Raster Map Tiles Layer */}
          <div className="absolute inset-0 pointer-events-none">
            {tiles.map((t) => (
              <img
                key={t.key}
                src={t.url}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: `${t.left}px`,
                  top: `${t.top}px`,
                  width: '256px',
                  height: '256px',
                  maxWidth: 'none',
                }}
                className="select-none pointer-events-none transition-opacity duration-150"
              />
            ))}
          </div>

          {/* Interactive Pothole & Crack Markers Layer */}
          <div className="absolute inset-0 pointer-events-none">
            {markerPositions.map(({ damage: d, x, y }) => {
              // Skip markers far outside current viewport
              if (x < -100 || x > viewportSize.w + 100 || y < -100 || y > viewportSize.h + 100) {
                return null;
              }
              const isSelected = selectedDamage?.id === d.id;
              const color = SEVERITY_COLORS[d.severity_level];

              return (
                <div
                  key={d.id}
                  style={{
                    position: 'absolute',
                    left: `${x}px`,
                    top: `${y}px`,
                    transform: 'translate(-50%, -50%)',
                    zIndex: isSelected ? 40 : d.is_live ? 30 : 20,
                  }}
                  className="pointer-events-auto"
                >
                  {/* Animated Radar Pulse Ring for Live Detections */}
                  {d.is_live && (
                    <span
                      className="absolute -inset-3 rounded-full animate-ping opacity-60 pointer-events-none"
                      style={{ backgroundColor: color }}
                    />
                  )}

                  {/* Marker Pin Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDamage(d);
                      setMapCenter({ lat: d.lat, lon: d.lon });
                    }}
                    style={{
                      backgroundColor: color,
                      borderColor: d.is_live ? '#38bdf8' : '#ffffff',
                      boxShadow: `0 0 16px ${color}, 0 3px 8px rgba(0,0,0,0.8)`,
                    }}
                    className={`relative rounded-full border-2 flex items-center justify-center transition-transform ${
                      isSelected ? 'w-7 h-7 scale-125 ring-4 ring-white/40' : d.is_live ? 'w-6 h-6' : 'w-5 h-5'
                    } hover:scale-125`}
                    title={`${CLASS_LABELS[d.damage_class]} • ${(d.severity_score * 100).toFixed(0)}%`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  </button>

                  {/* Floating Label Badge for Selected or Live Marker */}
                  {(isSelected || d.is_live) && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDamage(d);
                      }}
                      className="mt-1.5 -translate-x-1/2 left-1/2 relative whitespace-nowrap px-2 py-0.5 rounded-md bg-slate-950/90 border border-slate-700 text-[10px] font-bold text-white shadow-lg flex items-center gap-1 cursor-pointer"
                    >
                      {d.is_live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                      <span>{d.damage_class}</span>
                      <span className="text-slate-400">({(d.severity_score * 100).toFixed(0)}%)</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Top-Left Map Layer Switcher & Quick Center Controls */}
          <div className="absolute top-3 left-3 z-30 flex flex-wrap items-center gap-1.5">
            <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-xl p-1 flex items-center gap-1 shadow-xl">
              <Layers className="w-3.5 h-3.5 text-sky-400 ml-1.5 mr-0.5" />
              {(['dark', 'streets', 'satellite'] as TileStyleKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTileStyle(key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                    tileStyle === key
                      ? 'bg-sky-600 text-white shadow'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {TILE_PROVIDERS[key].label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setMapCenter({ lat: 20.605, lon: -100.415 });
                setMapZoom(12);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-900/90 backdrop-blur border border-slate-800 text-xs font-bold text-slate-200 hover:bg-slate-800 shadow-xl flex items-center gap-1.5"
            >
              <Compass className="w-3.5 h-3.5 text-sky-400" />
              Vista General Qro
            </button>
          </div>

          {/* Top-Right Zoom Controls */}
          <div className="absolute top-3 right-3 z-30 flex flex-col bg-slate-900/90 backdrop-blur border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <button
              type="button"
              onClick={() => setMapZoom((z) => Math.min(18, z + 1))}
              className="p-2.5 text-white hover:bg-slate-800 border-b border-slate-800 transition"
              title="Acercar"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setMapZoom((z) => Math.max(4, z - 1))}
              className="p-2.5 text-white hover:bg-slate-800 transition"
              title="Alejar"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          {/* Bottom-Left Selected Damage Mini-Card on Mobile Map View */}
          {selectedDamage && (
            <div className="md:hidden absolute bottom-3 left-3 right-3 z-30 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl p-3 shadow-2xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {selectedDamage.thumbnail_url && (
                  <img
                    src={selectedDamage.thumbnail_url}
                    alt="Evidencia"
                    className="w-12 h-12 rounded-lg object-cover border border-slate-700 shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: SEVERITY_COLORS[selectedDamage.severity_level] }}
                    />
                    <span className="font-bold text-xs text-white truncate">
                      {CLASS_LABELS[selectedDamage.damage_class]}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
                    {selectedDamage.lat.toFixed(5)}, {selectedDamage.lon.toFixed(5)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileTab('list')}
                className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-bold shrink-0"
              >
                Ver Detalle
              </button>
            </div>
          )}

          {/* Bottom-Right Map Legend */}
          <div className="hidden sm:block absolute bottom-4 right-4 bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs shadow-xl backdrop-blur z-20">
            <span className="font-bold text-white block mb-2">Severidad del Daño</span>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-slate-300">Crítica (&gt; 75%) — Bache severo</span>
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
                <span className="w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-sky-400 animate-pulse" />
                <span className="text-sky-300 font-semibold">Pulso Azul = Captura en Vivo</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Camera, Play, Square, Wifi, WifiOff, Battery,
  Smartphone, CheckCircle2, AlertCircle, RefreshCw, Crosshair, Sliders
} from 'lucide-react';
import { calculateDistanceMeters } from '@/lib/geo';
import { enqueueFrame, getQueueCount, getQueuedFrames, removeFrames, QueuedFrame } from '@/lib/queue';
import { uploadFrameBatch, pingBackendHealth } from '@/lib/api';

// Default fallback coordinates (Downtown Santiago de Querétaro) if indoor testing without GPS
const DEFAULT_QRO_COORDS = { lat: 20.5888, lon: -100.3899, acc: 15 };

export default function DriverCapturePWA() {
  const [isActive, setIsActive] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsStatusMsg, setGpsStatusMsg] = useState<string>('GPS en espera');
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [queueCount, setQueueCount] = useState<number>(0);
  const [framesCapturedTotal, setFramesCapturedTotal] = useState<number>(0);
  const [framesSentTotal, setFramesSentTotal] = useState<number>(0);
  const [damagesDetectedTotal, setDamagesDetectedTotal] = useState<number>(0);

  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [backendReady, setBackendReady] = useState<boolean>(false);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [lastCaptureNote, setLastCaptureNote] = useState<string>('Listo para iniciar ruta (soporta vertical y horizontal)');

  // Adjustable ROI percentage (bottom % of frame used for road surface)
  const [roiPercent, setRoiPercent] = useState<number>(75);
  // Auto-capture every 4 seconds in addition to every 15 meters
  const [autoTimeCapture, setAutoTimeCapture] = useState<boolean>(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Mutable refs to avoid stale closures inside Geolocation & Interval callbacks
  const isActiveRef = useRef<boolean>(false);
  const roiPercentRef = useRef<number>(75);
  const autoTimeCaptureRef = useRef<boolean>(true);
  const lastCaptureCoordsRef = useRef<{ lat: number; lon: number; time: number } | null>(null);
  const lastRawGpsRef = useRef<{ lat: number; lon: number; time: number; speedKmh: number } | null>(null);
  const latestGpsRef = useRef<{ lat: number; lon: number; acc: number; speed: number; heading: number | null }>({
    lat: DEFAULT_QRO_COORDS.lat,
    lon: DEFAULT_QRO_COORDS.lon,
    acc: DEFAULT_QRO_COORDS.acc,
    speed: 0,
    heading: null,
  });
  const isUploadingRef = useRef<boolean>(false);

  useEffect(() => {
    roiPercentRef.current = roiPercent;
  }, [roiPercent]);

  useEffect(() => {
    autoTimeCaptureRef.current = autoTimeCapture;
  }, [autoTimeCapture]);

  // Drain offline queue to FastAPI backend
  const flushQueueNow = useCallback(async () => {
    if (isUploadingRef.current || !navigator.onLine) return;
    isUploadingRef.current = true;
    try {
      const frames = await getQueuedFrames(6);
      if (frames.length === 0) {
        isUploadingRef.current = false;
        return;
      }

      const res = await uploadFrameBatch(frames);
      if (res.success) {
        setBackendReady(true);
        await removeFrames(frames.map((f) => f.id));
        const remaining = await getQueueCount();
        setQueueCount(remaining);
        setFramesSentTotal((prev) => prev + frames.length);

        const newDetections = res.data?.total_detections || 0;
        if (newDetections > 0) {
          setDamagesDetectedTotal((prev) => prev + newDetections);
          setLastCaptureNote(`✅ Lote enviado: +${newDetections} daño(s) vial(es) registrado(s) en mapa`);
        } else {
          setLastCaptureNote(`✅ Lote de ${frames.length} frame(s) procesado por el servidor`);
        }
      } else {
        setLastCaptureNote(`⏳ Servidor despertando (${res.errorMsg || 'reintentando'})... cola guardada`);
      }
    } catch {
      // Keep items in IndexedDB queue
    } finally {
      isUploadingRef.current = false;
    }
  }, []);

  // Capture frame from live video, crop bottom ROI %, compress to JPEG, enqueue & trigger upload
  const captureAndQueueFrame = useCallback((reasonNote?: string) => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    if (vw === 0 || vh === 0) return;

    const keepFraction = Math.max(0.4, Math.min(1.0, roiPercentRef.current / 100));
    const roiTop = Math.floor(vh * (1.0 - keepFraction));
    const roiHeight = vh - roiTop;

    // Target 640px width preserving aspect ratio of the cropped ROI
    const targetWidth = 640;
    const targetHeight = Math.max(120, Math.floor(targetWidth * (roiHeight / vw)));

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, roiTop, vw, roiHeight, 0, 0, targetWidth, targetHeight);

    const gps = latestGpsRef.current;

    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const frameId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const queuedItem: QueuedFrame = {
          id: frameId,
          blob,
          latitude: gps.lat,
          longitude: gps.lon,
          gpsAccuracyM: gps.acc,
          speedKmh: gps.speed,
          headingDeg: gps.heading,
          capturedAt: new Date().toISOString(),
        };

        await enqueueFrame(queuedItem);
        const count = await getQueueCount();
        setQueueCount(count);
        setFramesCapturedTotal((prev) => prev + 1);
        if (reasonNote) {
          setLastCaptureNote(reasonNote);
        }
        // Trigger immediate upload attempt
        flushQueueNow();
      },
      'image/jpeg',
      0.68
    );
  }, [flushQueueNow]);

  // Process incoming GPS position (compatible with iPhone Safari where speed is often null)
  const processGpsPosition = useCallback((pos: GeolocationPosition) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const acc = Math.max(1, Math.round(pos.coords.accuracy || 15));
    const now = Date.now();

    // Calculate speed: use hardware speed if available, else compute from delta distance / delta time
    let speedKmh = 0;
    if (pos.coords.speed !== null && pos.coords.speed !== undefined && pos.coords.speed >= 0) {
      speedKmh = pos.coords.speed * 3.6;
    } else if (lastRawGpsRef.current) {
      const dtSec = (now - lastRawGpsRef.current.time) / 1000.0;
      if (dtSec >= 0.8 && dtSec < 30.0) {
        const distM = calculateDistanceMeters(lastRawGpsRef.current.lat, lastRawGpsRef.current.lon, lat, lon);
        // Ignore tiny GPS jitter under 1.5m
        const rawSpeed = distM > 1.5 ? (distM / dtSec) * 3.6 : 0;
        // Smooth with previous reading
        speedKmh = Math.min(140, lastRawGpsRef.current.speedKmh * 0.4 + rawSpeed * 0.6);
      }
    }

    const roundedSpeed = Math.round(speedKmh);
    lastRawGpsRef.current = { lat, lon, time: now, speedKmh };

    latestGpsRef.current = {
      lat,
      lon,
      acc,
      speed: roundedSpeed,
      heading: pos.coords.heading,
    };

    setGpsAccuracy(acc);
    setCurrentSpeed(roundedSpeed);
    setCurrentCoords({ lat, lon });
    setGpsError(null);
    setGpsStatusMsg(`GPS activo (${lat.toFixed(4)}, ${lon.toFixed(4)})`);

    if (!isActiveRef.current) return;

    // Distance-based trigger: capture immediately on first GPS fix, then every 15 meters
    if (!lastCaptureCoordsRef.current) {
      lastCaptureCoordsRef.current = { lat, lon, time: now };
      captureAndQueueFrame(`📸 Captura inicial en (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
      return;
    }

    const distFromLastCapture = calculateDistanceMeters(
      lastCaptureCoordsRef.current.lat,
      lastCaptureCoordsRef.current.lon,
      lat,
      lon
    );

    if (distFromLastCapture >= 15.0) {
      lastCaptureCoordsRef.current = { lat, lon, time: now };
      captureAndQueueFrame(`📸 Captura por distancia (+${distFromLastCapture.toFixed(0)} m recorridos)`);
    }
  }, [captureAndQueueFrame]);

  // Start robust GPS watcher with automatic iOS fallback
  const startGpsTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsError('Tu navegador no soporta geolocalización.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setGpsStatusMsg('Buscando señal GPS...');

    const startWatcher = (highAccuracy: boolean) => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => processGpsPosition(pos),
        (err) => {
          console.warn('Geolocation error:', err.code, err.message);
          if (err.code === 1) {
            setGpsError(
              'Permiso de ubicación denegado en iPhone. Ve a Configuración → Privacidad → Localización → Sitios web de Safari → Mientras se usa.'
            );
            setGpsStatusMsg('GPS sin permiso (usando coord. Querétaro de respaldo)');
          } else if (highAccuracy) {
            // Fallback to cellular/Wi-Fi triangulation if satellite lock times out
            setGpsStatusMsg('Cambiando a GPS asistido por red celular...');
            if (watchIdRef.current !== null) {
              navigator.geolocation.clearWatch(watchIdRef.current);
            }
            startWatcher(false);
          } else {
            setGpsStatusMsg('Señal GPS débil — capturando con última ubicación conocida');
          }
        },
        {
          enableHighAccuracy: highAccuracy,
          maximumAge: 2000,
          timeout: highAccuracy ? 12000 : 20000,
        }
      );
    };

    // Immediate one-shot poll + continuous watcher
    navigator.geolocation.getCurrentPosition(
      (pos) => processGpsPosition(pos),
      () => {},
      { enableHighAccuracy: false, maximumAge: 10000, timeout: 6000 }
    );

    startWatcher(true);
  }, [processGpsPosition]);

  // Initial setup: network status, battery, backend wakeup ping, queue count
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      flushQueueNow();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      }).catch(() => {});
    }

    getQueueCount().then(setQueueCount);

    // Wake up Render free tier immediately when page opens
    pingBackendHealth().then((status) => {
      setBackendReady(status.online);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushQueueNow]);

  // Fast background queue uploader (every 4 seconds) + health ping
  useEffect(() => {
    const uploadInterval = setInterval(() => {
      flushQueueNow();
    }, 4000);

    const healthInterval = setInterval(() => {
      pingBackendHealth().then((st) => setBackendReady(st.online));
    }, 25000);

    return () => {
      clearInterval(uploadInterval);
      clearInterval(healthInterval);
    };
  }, [flushQueueNow]);

  // Periodic auto-capture timer (every 4 seconds while route is active & autoTimeCapture is enabled)
  useEffect(() => {
    if (!isActive) return;

    const timer = setInterval(() => {
      if (!isActiveRef.current || !autoTimeCaptureRef.current) return;
      const now = Date.now();
      const lastTime = lastCaptureCoordsRef.current?.time || 0;
      if (now - lastTime >= 3800) {
        const gps = latestGpsRef.current;
        lastCaptureCoordsRef.current = { lat: gps.lat, lon: gps.lon, time: now };
        captureAndQueueFrame(
          `📸 Auto-captura (${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}) • ±${gps.acc}m`
        );
      }
    }, 4000);

    return () => clearInterval(timer);
  }, [isActive, captureAndQueueFrame]);

  // Screen Wake Lock API
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Ignore on unsupported iOS versions
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  // Start Driving Route (Triggers GPS & Camera simultaneously within iOS user gesture)
  const startRoute = async () => {
    setGpsError(null);
    isActiveRef.current = true;
    setIsActive(true);
    setLastCaptureNote('Iniciando cámara y GPS...');

    // 1. Trigger GPS tracking synchronously inside user tap gesture (critical for iPhone Safari!)
    startGpsTracking();

    // 2. Wake up backend
    pingBackendHealth().then((st) => setBackendReady(st.online));

    // 3. Request Rear Camera in wide 16:9 HD
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
      }

      await requestWakeLock();
      setLastCaptureNote('Ruta activa: capturando pavimento automáticamente');

      // Take first snapshot 1.2s after camera stream stabilizes
      setTimeout(() => {
        if (isActiveRef.current) {
          captureAndQueueFrame('📸 Primera captura de ruta registrada');
        }
      }, 1200);
    } catch (err: any) {
      console.error('Failed to start camera:', err);
      isActiveRef.current = false;
      setIsActive(false);
      alert(
        'No se pudo abrir la cámara trasera. Asegúrate de estar en HTTPS y permitir el acceso a la Cámara en Safari.'
      );
    }
  };

  // Stop Driving Route & Flush Remaining Queue Immediately
  const stopRoute = async () => {
    isActiveRef.current = false;
    setIsActive(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    releaseWakeLock();
    lastCaptureCoordsRef.current = null;
    setLastCaptureNote('Ruta finalizada. Subiendo frames pendientes al servidor...');
    await flushQueueNow();
  };

  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex flex-col landscape:flex-row bg-slate-950 select-none">
      {/* ==================== MAIN CAMERA VIEWPORT ==================== */}
      <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center min-h-[240px]">
        {/* Top Floating Status Pill over Camera */}
        <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex items-center justify-between pointer-events-none">
          <Link
            href="/"
            className="pointer-events-auto px-3 py-1.5 rounded-full bg-slate-900/85 backdrop-blur border border-slate-700/80 text-xs font-bold text-white flex items-center gap-2 shadow-lg"
          >
            <span className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-400 animate-ping' : 'bg-sky-500'}`} />
            RoadGuard <span className="text-sky-400">Moto/Flotilla</span>
          </Link>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur border flex items-center gap-1.5 ${
                backendReady
                  ? 'bg-emerald-950/85 border-emerald-700/70 text-emerald-300'
                  : 'bg-amber-950/85 border-amber-700/70 text-amber-300'
              }`}
            >
              {backendReady ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> IA Lista
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" /> Conectando IA
                </>
              )}
            </span>

            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur border flex items-center gap-1 ${
                isOnline
                  ? 'bg-slate-900/85 border-slate-700 text-emerald-400'
                  : 'bg-amber-950/85 border-amber-700 text-amber-300'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {batteryLevel !== null ? `${batteryLevel}%` : ''}
            </span>
          </div>
        </div>

        {/* GPS Permission / Diagnostic Alert Banner */}
        {gpsError && (
          <div className="absolute top-14 left-3 right-3 z-30 bg-rose-950/95 border border-rose-500 text-rose-100 p-3 rounded-xl text-xs shadow-xl flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">Aviso de GPS en iPhone:</p>
              <p className="mt-0.5 text-rose-200 leading-relaxed">{gpsError}</p>
            </div>
          </div>
        )}

        {/* Live Video Element (Always mounted so iOS Safari can bind stream reliably) */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${!isActive ? 'opacity-0 pointer-events-none absolute' : 'opacity-100'}`}
        />

        {/* Hidden processing canvas */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Inactive Placeholder */}
        {!isActive && (
          <div className="text-center p-6 text-slate-400 max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-sky-400 shadow-inner">
              <Camera className="w-8 h-8" />
            </div>
            <p className="font-bold text-white text-base">Modo Horizontal y Vertical Listo</p>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Puedes girar tu iPhone **horizontalmente** en el soporte de tu moto para aprovechar todo el ancho del carril sin desperdiciar imagen.
            </p>
          </div>
        )}

        {/* Adjustable ROI Overlay Guideline */}
        {isActive && (
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-end">
            <div
              style={{ height: `${roiPercent}%` }}
              className="border-t-2 border-dashed border-sky-400/90 bg-sky-500/5 relative transition-all duration-200"
            >
              <div className="absolute -top-6 left-3 right-3 flex items-center justify-between text-[10px] font-bold">
                <span className="uppercase text-sky-300 bg-slate-950/90 px-2.5 py-0.5 rounded-full border border-sky-500/40 shadow">
                  ▼ Zona Capturada de Asfalto (ROI {roiPercent}%)
                </span>
                <span className="text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded-full">
                  ▲ Zona superior descartada (evita placas/cielo)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Floating Coordinates & Note Bar over Video */}
        <div className="absolute bottom-2 left-2.5 right-2.5 z-20 pointer-events-none flex flex-col gap-1">
          <div className="px-3 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur border border-slate-800/90 text-[11px] text-slate-200 flex items-center justify-between gap-2 shadow">
            <span className="truncate font-medium">{lastCaptureNote}</span>
            <span className="text-sky-400 font-mono text-[10px] shrink-0">
              {currentCoords
                ? `${currentCoords.lat.toFixed(4)}, ${currentCoords.lon.toFixed(4)}`
                : gpsStatusMsg}
            </span>
          </div>
        </div>
      </div>

      {/* ==================== TELEMETRY & CONTROLS PANEL ==================== */}
      {/* Bottom panel in Portrait, Right Sidebar in Landscape! */}
      <div className="w-full landscape:w-72 landscape:h-full bg-slate-900 border-t landscape:border-t-0 landscape:border-l border-slate-800 p-3 flex flex-col justify-between gap-2.5 shrink-0 z-20 overflow-y-auto">
        {/* Telemetry Metrics Grid */}
        <div className="grid grid-cols-4 landscape:grid-cols-2 gap-2 text-center">
          <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Velocidad</span>
            <span className="text-lg landscape:text-xl font-black text-white">
              {currentSpeed}
              <span className="text-[10px] font-normal text-slate-400 ml-0.5">km/h</span>
            </span>
          </div>

          <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">GPS Precisión</span>
            <span
              className={`text-lg landscape:text-xl font-black ${
                gpsAccuracy !== null && gpsAccuracy <= 25
                  ? 'text-emerald-400'
                  : gpsAccuracy !== null
                  ? 'text-amber-400'
                  : 'text-slate-500'
              }`}
            >
              {gpsAccuracy !== null ? `±${gpsAccuracy}m` : 'Activo'}
            </span>
          </div>

          <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Enviadas / Cola</span>
            <span className="text-lg landscape:text-xl font-black text-sky-400">
              {framesSentTotal}
              <span className="text-xs text-slate-500 font-normal"> / {queueCount}</span>
            </span>
          </div>

          <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Daños IA</span>
            <span className="text-lg landscape:text-xl font-black text-rose-400">
              {damagesDetectedTotal}
            </span>
          </div>
        </div>

        {/* Adjustable ROI & Capture Mode Controls */}
        <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-2.5 flex flex-wrap landscape:flex-col items-center justify-between gap-2 text-xs">
          <div className="flex items-center justify-between w-full gap-2">
            <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5 text-sky-400" /> Alto de Imagen (ROI):
            </span>
            <div className="flex items-center gap-1">
              {[60, 75, 85, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setRoiPercent(pct)}
                  className={`px-2 py-0.5 rounded font-bold text-[11px] transition ${
                    roiPercent === pct
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between w-full pt-1.5 border-t border-slate-800/80">
            <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoTimeCapture}
                onChange={(e) => setAutoTimeCapture(e.target.checked)}
                className="rounded accent-sky-500 w-3.5 h-3.5"
              />
              <span>Auto-captura continua (cada 4s + cada 15m)</span>
            </label>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex landscape:flex-col gap-2">
          {!isActive ? (
            <button
              onClick={startRoute}
              className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-extrabold text-lg rounded-2xl shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2.5 transition"
            >
              <Play className="w-5 h-5 fill-current" />
              INICIAR RUTA
            </button>
          ) : (
            <>
              <button
                onClick={() => captureAndQueueFrame('📸 Captura manual tomada por el conductor')}
                className="px-4 py-3.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-bold text-sm rounded-2xl shadow-lg shadow-sky-600/20 flex items-center justify-center gap-2 transition shrink-0"
              >
                <Camera className="w-4 h-4" />
                Capturar Ahora ({framesCapturedTotal})
              </button>

              <button
                onClick={stopRoute}
                className="flex-1 py-3.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-extrabold text-base rounded-2xl shadow-lg shadow-rose-600/25 flex items-center justify-center gap-2 transition"
              >
                <Square className="w-4 h-4 fill-current" />
                FINALIZAR
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

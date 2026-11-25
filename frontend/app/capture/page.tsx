'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, Play, Square, Wifi, WifiOff, AlertTriangle, Shield, CheckCircle, Navigation, Battery } from 'lucide-react';
import { calculateDistanceMeters, isGPSReliable } from '@/lib/geo';
import { enqueueFrame, getQueueCount, getQueuedFrames, removeFrames, QueuedFrame } from '@/lib/queue';
import { uploadFrameBatch } from '@/lib/api';

export default function DriverCapturePWA() {
  const [isActive, setIsActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [lastCoords, setLastCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [queueCount, setQueueCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [framesCapturedTotal, setFramesCapturedTotal] = useState<number>(0);
  const [lastCaptureNote, setLastCaptureNote] = useState<string>('Esperando inicio de ruta');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const uploadTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Monitor Network & Battery status
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      });
    }

    getQueueCount().then(setQueueCount);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Periodic Queue Upload Worker (every 30 seconds or batch ready)
  useEffect(() => {
    uploadTimerRef.current = setInterval(async () => {
      if (!navigator.onLine) return;
      const frames = await getQueuedFrames(10);
      if (frames.length === 0) return;

      const res = await uploadFrameBatch(frames);
      if (res.success) {
        await removeFrames(frames.map((f) => f.id));
        const updated = await getQueueCount();
        setQueueCount(updated);
      }
    }, 30000);

    return () => {
      if (uploadTimerRef.current) clearInterval(uploadTimerRef.current);
    };
  }, []);

  // Screen Wake Lock API
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('Wake Lock failed:', err);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  // Start Driving Route
  const startRoute = async () => {
    try {
      // 1. Request Camera Access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      await requestWakeLock();

      // 2. Start GPS Tracking
      if ('geolocation' in navigator) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => handleGPSPosition(pos),
          (err) => console.error('GPS error:', err),
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
        );
      }

      setIsActive(true);
      setLastCaptureNote('Ruta activa: monitoreando cada 20 metros');
    } catch (err) {
      console.error('Failed to start route:', err);
      alert('Error al acceder a la cámara o GPS. Por favor concede los permisos en el navegador.');
    }
  };

  // Stop Driving Route
  const stopRoute = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    releaseWakeLock();
    setIsActive(false);
    setLastCoords(null);
    setLastCaptureNote('Ruta finalizada. Subiendo cola restante...');
  };

  // Handle GPS position updates and trigger distance-based frame capture
  const handleGPSPosition = (pos: GeolocationPosition) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const acc = pos.coords.accuracy;
    const speedKmh = pos.coords.speed !== null ? pos.coords.speed * 3.6 : null;

    setGpsAccuracy(Math.round(acc));
    setCurrentSpeed(speedKmh !== null ? Math.round(speedKmh) : null);

    const check = isGPSReliable(acc, speedKmh);
    if (!check.valid) {
      setLastCaptureNote(check.reason || 'GPS no confiable');
      return;
    }

    // Check distance travelled from last capture
    if (!lastCoords) {
      captureAndQueueFrame(lat, lon, acc, speedKmh, pos.coords.heading);
      setLastCoords({ lat, lon });
      return;
    }

    const distM = calculateDistanceMeters(lastCoords.lat, lastCoords.lon, lat, lon);
    if (distM >= 20.0) {
      captureAndQueueFrame(lat, lon, acc, speedKmh, pos.coords.heading);
      setLastCoords({ lat, lon });
      setLastCaptureNote(`Captura realizada tras recorrer ${distM.toFixed(1)} m`);
    }
  };

  // Capture frame from video, crop bottom 60% ROI (pavement), compress to JPEG, enqueue
  const captureAndQueueFrame = (
    lat: number,
    lon: number,
    acc: number,
    speed: number | null,
    heading: number | null
  ) => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;

    // Region of Interest: Crop only bottom 60% of vertical frame (road surface)
    const roiTop = Math.floor(vh * 0.40);
    const roiHeight = vh - roiTop;

    // Scale to standard 640px width
    const targetWidth = 640;
    const targetHeight = Math.floor(targetWidth * (roiHeight / vw));

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw bottom 60% ROI
    ctx.drawImage(video, 0, roiTop, vw, roiHeight, 0, 0, targetWidth, targetHeight);

    // Compress to JPEG with quality 0.6 (~25 KB)
    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const frameId = crypto.randomUUID();
        const queuedItem: QueuedFrame = {
          id: frameId,
          blob,
          latitude: lat,
          longitude: lon,
          gpsAccuracyM: acc,
          speedKmh: speed,
          headingDeg: heading,
          capturedAt: new Date().toISOString(),
        };

        await enqueueFrame(queuedItem);
        const count = await getQueueCount();
        setQueueCount(count);
        setFramesCapturedTotal((prev) => prev + 1);
      },
      'image/jpeg',
      0.6
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 max-w-lg mx-auto w-full select-none">
      {/* Top Status Bar */}
      <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
        <Link href="/" className="font-bold text-white flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse" />
          RoadGuard <span className="text-sky-400">Chofer</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-slate-300">
            {isOnline ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <Wifi className="w-3.5 h-3.5" /> En línea
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-400">
                <WifiOff className="w-3.5 h-3.5" /> Sin red (cola activa)
              </span>
            )}
          </div>
          {batteryLevel !== null && (
            <div className="flex items-center gap-1 text-slate-400">
              <Battery className="w-3.5 h-3.5" /> {batteryLevel}%
            </div>
          )}
        </div>
      </div>

      {/* Camera Live Preview */}
      <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center min-h-[320px]">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`w-full h-full object-cover ${!isActive ? 'hidden' : ''}`}
        />

        {/* Hidden processing canvas */}
        <canvas ref={canvasRef} className="hidden" />

        {!isActive && (
          <div className="text-center p-6 text-slate-400">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-500">
              <Camera className="w-8 h-8" />
            </div>
            <p className="font-semibold text-slate-200">Cámara inactiva</p>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">
              Coloca el teléfono en el soporte del tablero con vista al pavimento e inicia tu turno.
            </p>
          </div>
        )}

        {/* ROI Overlay Guideline */}
        {isActive && (
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-end">
            <div className="h-[60%] border-t-2 border-dashed border-sky-400/60 bg-sky-500/5 relative">
              <span className="absolute top-2 left-2 text-[10px] uppercase font-bold text-sky-400 bg-slate-900/80 px-2 py-0.5 rounded">
                Área de Pavimento (ROI 60%)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Telemetry HUD */}
      <div className="bg-slate-900/90 border-t border-slate-800 p-4 grid grid-cols-3 gap-2 text-center">
        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">Velocidad</span>
          <span className="text-xl font-black text-white">
            {currentSpeed !== null ? `${currentSpeed}` : '--'}
            <span className="text-xs font-normal text-slate-400 ml-0.5">km/h</span>
          </span>
        </div>

        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">GPS Precisión</span>
          <span className={`text-xl font-black ${gpsAccuracy && gpsAccuracy <= 15 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {gpsAccuracy !== null ? `±${gpsAccuracy}m` : '--'}
          </span>
        </div>

        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">Cola Offline</span>
          <span className="text-xl font-black text-sky-400">{queueCount}</span>
        </div>
      </div>

      {/* Note indicator */}
      <div className="px-4 py-2 bg-slate-900 text-center text-xs text-slate-400 border-t border-slate-800/60 truncate">
        {lastCaptureNote}
      </div>

      {/* Big Action Button (Safe for driving) */}
      <div className="p-4 bg-slate-950">
        {!isActive ? (
          <button
            onClick={startRoute}
            className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-extrabold text-xl rounded-2xl shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-3 transition"
          >
            <Play className="w-6 h-6 fill-current" />
            INICIAR RUTA
          </button>
        ) : (
          <button
            onClick={stopRoute}
            className="w-full py-5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-extrabold text-xl rounded-2xl shadow-xl shadow-rose-600/30 flex items-center justify-center gap-3 transition"
          >
            <Square className="w-6 h-6 fill-current" />
            FINALIZAR RUTA
          </button>
        )}
      </div>
    </div>
  );
}

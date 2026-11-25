'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Play, Square, RotateCcw, ArrowLeft, UploadCloud, CheckCircle } from 'lucide-react';
import { uploadFrameBatch } from '@/lib/api';
import { QueuedFrame } from '@/lib/queue';

// Simulated GPS path along Av. 5 de Febrero, Santiago de Querétaro
const SIMULATED_PATH = [
  { lat: 20.5840, lon: -100.4070, hasPothole: false },
  { lat: 20.5855, lon: -100.4075, hasPothole: true }, // Pothole 1
  { lat: 20.5870, lon: -100.4080, hasPothole: false },
  { lat: 20.5885, lon: -100.4085, hasPothole: true }, // Pothole 2
  { lat: 20.5900, lon: -100.4090, hasPothole: false },
  { lat: 20.5915, lon: -100.4095, hasPothole: false },
  { lat: 20.5930, lon: -100.4100, hasPothole: true }, // Pothole 3
];

export default function RouteSimulator() {
  const [isRunning, setIsRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const logMessage = (msg: string) => {
    setStatusLog((prev) => [ `[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 15) ]);
  };

  const drawRoadFrame = (hasPothole: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pavement asphalt background
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Road lines (dashed yellow)
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 6;
    ctx.setLineDash([30, 20]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();

    // Road borders (solid white)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(40, 0);
    ctx.lineTo(40, canvas.height);
    ctx.moveTo(canvas.width - 40, 0);
    ctx.lineTo(canvas.width - 40, canvas.height);
    ctx.stroke();

    // If step has simulated damage, draw asphalt pothole/crack
    if (hasPothole) {
      ctx.fillStyle = '#09090b';
      ctx.beginPath();
      ctx.ellipse(canvas.width * 0.6, canvas.height * 0.65, 45, 25, 0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  };

  const executeSimulationStep = async (idx: number) => {
    if (idx >= SIMULATED_PATH.length) {
      logMessage('Simulación completada. Toda la ruta fue procesada.');
      setIsRunning(false);
      return;
    }

    const currentPoint = SIMULATED_PATH[idx];
    setStepIndex(idx);
    drawRoadFrame(currentPoint.hasPothole);

    // Create frame blob
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const frameId = crypto.randomUUID();
      const mockQueued: QueuedFrame = {
        id: frameId,
        blob,
        latitude: currentPoint.lat,
        longitude: currentPoint.lon,
        gpsAccuracyM: 3.5,
        speedKmh: 45.0,
        headingDeg: 340.0,
        capturedAt: new Date().toISOString(),
      };

      logMessage(`Punto ${idx + 1}/${SIMULATED_PATH.length}: Coord (${currentPoint.lat.toFixed(4)}, ${currentPoint.lon.toFixed(4)}) - Daño: ${currentPoint.hasPothole ? 'SÍ (Bache D40)' : 'NO'}`);

      // Send to FastAPI inference API
      const res = await uploadFrameBatch([mockQueued]);
      if (res.success) {
        logMessage(`Backend procesó frame ${frameId.slice(0, 8)}... (${res.data?.total_detections || 0} daños detectados)`);
      } else {
        logMessage(`Aviso: Backend no disponible o respuesta demorada (cola offline preservada).`);
      }
    }, 'image/jpeg', 0.6);
  };

  useEffect(() => {
    if (isRunning) {
      executeSimulationStep(stepIndex);
      timerRef.current = setInterval(() => {
        setStepIndex((prev) => {
          const next = prev + 1;
          executeSimulationStep(next);
          return next;
        });
      }, 4000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  return (
    <div className="flex-1 max-w-4xl mx-auto p-6 w-full space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
          <ArrowLeft className="w-4 h-4" /> Volver al Inicio
        </Link>
        <div className="text-right">
          <span className="text-xs text-sky-400 font-bold bg-sky-950 px-2 py-0.5 rounded border border-sky-800">
            HERRAMIENTA DE PRUEBAS DESKTOP
          </span>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-white">Simulador de Ruta en Laboratorio</h1>
        <p className="text-sm text-slate-400 mt-1">
          Prueba el pipeline completo (Canvas → Compresión → GPS → FastAPI → PostGIS → Dashboard) desde tu computadora sin manejar un automóvil.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Road Animation Canvas */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center">
          <canvas
            ref={canvasRef}
            width={640}
            height={384}
            className="w-full h-auto rounded-xl border border-slate-700 bg-zinc-900 shadow-inner"
          />

          <div className="mt-4 flex gap-3 w-full">
            {!isRunning ? (
              <button
                onClick={() => {
                  setStepIndex(0);
                  setIsRunning(true);
                  logMessage('Iniciando simulación de ruta Av. 5 de Febrero...');
                }}
                className="flex-1 py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition"
              >
                <Play className="w-4 h-4" /> Correr Simulación
              </button>
            ) : (
              <button
                onClick={() => setIsRunning(false)}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition"
              >
                <Square className="w-4 h-4" /> Pausar
              </button>
            )}

            <button
              onClick={() => {
                setIsRunning(false);
                setStepIndex(0);
                setStatusLog([]);
              }}
              className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Live Simulation Console */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col h-[400px]">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-sky-400" /> Registro de Eventos en Tiempo Real
          </span>
          <div className="flex-1 bg-slate-900 rounded-xl p-3 font-mono text-xs overflow-y-auto space-y-1.5 text-slate-300">
            {statusLog.length === 0 ? (
              <span className="text-slate-600">Presiona "Correr Simulación" para comenzar...</span>
            ) : (
              statusLog.map((log, i) => (
                <div key={i} className="leading-relaxed">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

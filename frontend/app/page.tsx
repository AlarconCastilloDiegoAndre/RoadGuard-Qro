import Link from 'next/link';
import { Camera, MapPin, BarChart3, ShieldCheck, PlayCircle, Cpu, DollarSign } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 font-black text-xl">
              R
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight text-white">RoadGuard</span>
              <span className="text-sky-400 font-bold ml-1 text-sm bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800">QRO</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition"
            >
              Dashboard
            </Link>
            <Link
              href="/capture"
              className="px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg shadow-lg shadow-sky-600/20 transition flex items-center gap-2"
            >
              <Camera className="w-4 h-4" />
              App Chofer (PWA)
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-6xl mx-auto px-4 py-16 flex flex-col items-center text-center justify-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300 text-xs font-semibold mb-6">
          <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
          SaaS GovTech para Obras Públicas Municipales • Inversión Inicial $0
        </div>

        <h1 className="text-4xl md:text-6xl font-extrabold text-white tracking-tight max-w-4xl leading-tight">
          Auditoría Pasiva de Pavimento con{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">
            Visión Artificial
          </span>
        </h1>

        <p className="mt-6 text-lg md:text-xl text-slate-400 max-w-2xl leading-relaxed">
          Convierte las patrullas y camiones de basura en auditores automáticos del pavimento.
          Detección de baches y grietas en tiempo real, clasificación de severidad y mapa geoespacial
          para optimizar el presupuesto de asfalto.
        </p>

        {/* CTA Buttons */}
        <div className="mt-10 flex flex-wrap gap-4 justify-center">
          <Link
            href="/capture"
            className="px-6 py-3.5 text-base font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-xl shadow-lg shadow-sky-600/25 transition flex items-center gap-2.5"
          >
            <Camera className="w-5 h-5" />
            Iniciar App de Captura
          </Link>
          <Link
            href="/dashboard"
            className="px-6 py-3.5 text-base font-semibold text-slate-200 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-xl transition flex items-center gap-2.5"
          >
            <BarChart3 className="w-5 h-5 text-sky-400" />
            Ver Dashboard del Municipio
          </Link>
          <Link
            href="/simulator"
            className="px-6 py-3.5 text-base font-semibold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 rounded-xl transition flex items-center gap-2"
          >
            <PlayCircle className="w-5 h-5 text-indigo-400" />
            Simulador de Ruta (Desktop)
          </Link>
        </div>

        {/* Technical Highlights Grid */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 text-left w-full">
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mb-4">
              <Camera className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-lg">Cero Hardware Externo</h3>
            <p className="mt-2 text-sm text-slate-400">
              Funciona con el celular del chofer montado en el tablero. Captura por distancia (cada 20m),
              filtro de nitidez y cola offline en IndexedDB.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-4">
              <Cpu className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-lg">Deep Learning (YOLO11n)</h3>
            <p className="mt-2 text-sm text-slate-400">
              Red Neuronal Convolucional que supera a los algoritmos clásicos ante sombras, lluvia y baches
              asimétricos. Modelo cuantizado en INT8 (CPU 2 hilos).
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4">
              <MapPin className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-lg">Deduplicación PostGIS</h3>
            <p className="mt-2 text-sm text-slate-400">
              Clustering espacial en radio de 8 metros. Detecciones de diferentes patrullas confirman el bache
              automáticamente para el ingeniero de obras.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-8 text-center text-xs text-slate-500">
        <p>RoadGuard Qro • Código Abierto bajo Licencia AGPL-3.0 • Municipio de Querétaro</p>
      </footer>
    </div>
  );
}

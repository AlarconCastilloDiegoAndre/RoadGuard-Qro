# RoadGuard Qro — Frontend (Next.js PWA & Municipal Dashboard)

This web application contains two primary interfaces:
1. **/capture**: High-contrast, driver-friendly Progressive Web App (PWA) with camera stream,
   bottom 60% pavement ROI cropping, distance-based sampling (Haversine formula every 20 m),
   JPEG compression (~25 KB), and IndexedDB offline queueing.
2. **/dashboard**: Municipal Engineer Web Dashboard with interactive MapLibre GL map, OpenFreeMap
   vector tiles, severity markers, priority ranking table, and CSV asphalt budget export.
3. **/simulator**: Desktop lab simulator to test complete pipeline end-to-end without a vehicle.

## Zero-Cost Architecture ($0 Cloud Hosting)

The application is configured for **Static HTML/JS Export** (`output: 'export'` in `next.config.mjs`).
It contains zero server runtime dependencies and can be deployed for **$0 forever** to:
- **Vercel Hobby** (Academic evaluation)
- **Cloudflare Pages** (Commercial production GovTech deployment with unlimited bandwidth)

## Setup & Local Development

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:3000`.

## Production Build

```bash
npm run build
```

Generates pre-rendered HTML/CSS/JS in the `out/` directory, ready to drag-and-drop or deploy to
Vercel or Cloudflare Pages.

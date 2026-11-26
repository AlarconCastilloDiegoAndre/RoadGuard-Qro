import { QueuedFrame } from './queue';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://roadguard-qro.onrender.com';

export interface BatchUploadResponse {
  total_frames: number;
  processed_frames: number;
  total_detections: number;
  results: Array<{
    frame_id: string;
    latitude: number;
    longitude: number;
    detections: Array<{
      damage_class: string;
      confidence: number;
      severity_score: number;
      severity_level: string;
      damage_id?: string;
    }>;
  }>;
}

export interface RoadDamageDTO {
  id: string;
  damage_class: 'D00' | 'D10' | 'D20' | 'D40';
  severity_score: number;
  severity_level: 'low' | 'medium' | 'high' | 'critical';
  detection_count: number;
  distinct_vehicles_count: number;
  status: 'reported' | 'confirmed' | 'validated' | 'in_repair' | 'repaired' | 'dismissed';
  first_detected_at?: string;
  last_detected_at: string;
  thumbnail_url?: string;
  lat: number;
  lon: number;
  gps_accuracy_m?: number;
  speed_kmh?: number;
  is_live?: boolean;
}

/**
 * Pings the backend /health endpoint to wake up the free Render instance.
 */
export async function pingBackendHealth(): Promise<{ online: boolean; totalDamages?: number }> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return { online: false };
    const data = await res.json();
    return { online: true, totalDamages: data.total_damages_tracked };
  } catch {
    return { online: false };
  }
}

/**
 * Uploads a batch of queued frames to the FastAPI backend with retry/503 backoff support.
 */
export async function uploadFrameBatch(
  frames: QueuedFrame[],
  token?: string
): Promise<{ success: boolean; data?: BatchUploadResponse; retryAfterSec?: number; errorMsg?: string }> {
  if (frames.length === 0) return { success: true };

  const formData = new FormData();

  const metadataList = frames.map((f) => ({
    frame_id: f.id,
    latitude: f.latitude,
    longitude: f.longitude,
    gps_accuracy_m: f.gpsAccuracyM,
    speed_kmh: f.speedKmh,
    heading_deg: f.headingDeg,
    captured_at: f.capturedAt,
  }));

  formData.append('metadata_batch', JSON.stringify(metadataList));

  frames.forEach((f) => {
    formData.append('files', f.blob, `${f.id}.jpg`);
  });

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/v1/inference/batch`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (res.status === 503) {
      const retryHeader = res.headers.get('Retry-After');
      const retrySec = retryHeader ? parseInt(retryHeader, 10) : 5;
      return { success: false, retryAfterSec: retrySec, errorMsg: 'Servidor ocupado (503)' };
    }

    if (!res.ok) {
      return { success: false, errorMsg: `HTTP ${res.status}` };
    }

    const data: BatchUploadResponse = await res.json();
    return { success: true, data };
  } catch (err: any) {
    return { success: false, errorMsg: err?.message || 'Error de conexión con servidor' };
  }
}

/**
 * Fetches all deduplicated road damages from the backend API.
 */
export async function fetchRoadDamagesFromAPI(): Promise<RoadDamageDTO[] | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/damages`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Updates the workflow status of a road damage entity via the backend API.
 */
export async function updateRoadDamageStatusAPI(
  damageId: string,
  status: RoadDamageDTO['status']
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/damages/${damageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Permanently deletes a road damage entity (e.g. indoor test or false positive).
 */
export async function deleteRoadDamageAPI(damageId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/v1/damages/${damageId}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

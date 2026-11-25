import { QueuedFrame } from './queue';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7860';

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
    }>;
  }>;
}

/**
 * Uploads a batch of queued frames to the FastAPI backend with retry/503 backoff support.
 */
export async function uploadFrameBatch(
  frames: QueuedFrame[],
  token?: string
): Promise<{ success: boolean; data?: BatchUploadResponse; retryAfterSec?: number }> {
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
      return { success: false, retryAfterSec: retrySec };
    }

    if (!res.ok) {
      console.warn(`Batch upload failed with status ${res.status}`);
      return { success: false };
    }

    const data: BatchUploadResponse = await res.json();
    return { success: true, data };
  } catch (err) {
    console.warn('Network error uploading batch:', err);
    return { success: false };
  }
}

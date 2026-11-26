/**
 * Haversine formula: Calculates great-circle distance between two GPS coordinates in meters.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Validates GPS position against quality thresholds.
 * Relaxed accuracy threshold (up to 250 m) so cellular A-GPS on iPhone works immediately.
 */
export function isGPSReliable(
  accuracy: number,
  speedKmh?: number | null,
  requireMinSpeed: boolean = false
): { valid: boolean; reason?: string } {
  if (accuracy > 250.0) {
    return { valid: false, reason: `Señal GPS débil (±${Math.round(accuracy)} m)` };
  }
  if (requireMinSpeed && speedKmh !== undefined && speedKmh !== null && speedKmh < 5.0) {
    return { valid: false, reason: `Vehículo detenido (${speedKmh.toFixed(1)} km/h < 5 km/h)` };
  }
  return { valid: true };
}

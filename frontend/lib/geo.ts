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
 * Validates GPS position against strict quality thresholds.
 * Avoids captures when stationary or when GPS uncertainty exceeds 25 meters.
 */
export function isGPSReliable(
  accuracy: number,
  speedKmh?: number | null
): { valid: boolean; reason?: string } {
  if (accuracy > 25.0) {
    return { valid: false, reason: `GPS uncertainty too high (${Math.round(accuracy)} m > 25 m)` };
  }
  if (speedKmh !== undefined && speedKmh !== null && speedKmh < 8.0) {
    return { valid: false, reason: `Vehicle stationary/crawling (${speedKmh.toFixed(1)} km/h < 8 km/h)` };
  }
  return { valid: true };
}

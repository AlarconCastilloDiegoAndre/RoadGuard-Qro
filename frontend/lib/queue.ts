import { openDB, IDBPDatabase } from 'idb';

export interface QueuedFrame {
  id: string; // UUID
  blob: Blob;
  latitude: number;
  longitude: number;
  gpsAccuracyM: number;
  speedKmh: number | null;
  headingDeg: number | null;
  capturedAt: string; // ISO String
}

const DB_NAME = 'roadguard_offline_queue';
const STORE_NAME = 'frames';
const MAX_QUEUE_LIMIT = 500;

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
}

export async function enqueueFrame(frame: QueuedFrame): Promise<void> {
  try {
    const db = await getDB();
    const count = await db.count(STORE_NAME);

    // If queue exceeds safety limit (e.g. 500 frames ~12.5 MB), drop oldest frames
    if (count >= MAX_QUEUE_LIMIT) {
      const keys = await db.getAllKeys(STORE_NAME);
      if (keys.length > 0) {
        await db.delete(STORE_NAME, keys[0]);
      }
    }

    await db.put(STORE_NAME, frame);
  } catch (err) {
    console.error('Failed to enqueue frame in IndexedDB:', err);
  }
}

export async function getQueuedFrames(batchSize: number = 10): Promise<QueuedFrame[]> {
  try {
    const db = await getDB();
    const all = await db.getAll(STORE_NAME);
    return all.slice(0, batchSize);
  } catch (err) {
    console.error('Failed to fetch queued frames:', err);
    return [];
  }
}

export async function removeFrames(frameIds: string[]): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const id of frameIds) {
      await tx.store.delete(id);
    }
    await tx.done;
  } catch (err) {
    console.error('Failed to remove confirmed frames from queue:', err);
  }
}

export async function getQueueCount(): Promise<number> {
  try {
    const db = await getDB();
    return await db.count(STORE_NAME);
  } catch {
    return 0;
  }
}

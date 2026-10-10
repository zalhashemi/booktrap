import type { DeviceRecord, DeviceRepo } from './types';

/** Development and test storage. Data is lost when the process exits. */
export function createMemoryDeviceRepo(): DeviceRepo {
  const devices = new Map<string, DeviceRecord>();
  /** Like the database's deleted_devices: an erased id can't be registered again. */
  const deleted = new Set<string>();
  return {
    kind: 'memory',
    async find(id) {
      return devices.get(id) ?? null;
    },
    async insert(id, secretHash) {
      if (devices.has(id) || deleted.has(id)) return false;
      const now = new Date().toISOString();
      devices.set(id, { id, secretHash, createdAt: now, lastSeenAt: now });
      return true;
    },
    async touch(id, at) {
      const device = devices.get(id);
      if (device) device.lastSeenAt = at.toISOString();
    },
    async remove(id) {
      devices.delete(id);
      deleted.add(id);
    },
    async ping() {},
  };
}

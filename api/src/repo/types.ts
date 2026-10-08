export interface DeviceRecord {
  id: string;
  secretHash: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface DeviceRepo {
  readonly kind: 'supabase' | 'memory';
  find(id: string): Promise<DeviceRecord | null>;
  /** Inserts the device. Returns false (and writes nothing) if the id already exists. */
  insert(id: string, secretHash: string): Promise<boolean>;
  touch(id: string, at: Date): Promise<void>;
  ping(): Promise<void>;
}

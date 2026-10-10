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
  /** Deletes the device for good: its id can't be registered again. (In Postgres, LibraryStore.eraseDevice does this too.) */
  remove(id: string): Promise<void>;
  ping(): Promise<void>;
}

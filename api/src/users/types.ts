/**
 * Supabase Auth's users, as the API needs them: whether one is a guest, when they last visited, and
 * deleting them. Shelves themselves live in the LibraryStore.
 */
export interface UserDirectory {
  readonly kind: 'supabase' | 'memory';
  /** The database answers (readiness check). */
  ping(): Promise<void>;
  /** A guest is an anonymous user who hasn't added an email yet. Unknown users count as signed in. */
  isGuest(userId: string): Promise<boolean>;
  /** Notes a visit. An unclaimed guest shelf is deleted after 30 days without one. */
  touch(userId: string, at: Date): Promise<void>;
  /** Guests not seen since `before` (or created before it and never seen), oldest first. */
  inactiveGuests(before: Date, limit: number): Promise<string[]>;
  /** Deletes the user from Supabase Auth; whatever they still own goes with them. Unknown ids are ignored. */
  remove(userId: string): Promise<void>;
}

import { InstagramLogo, TiktokLogo } from '@phosphor-icons/react';
import type { SourcePlatform } from '@booktrap/shared';

const ICONS = { tiktok: TiktokLogo, instagram: InstagramLogo } as const;

/** A small platform mark for a source or a pasted link. Decorative: the label sits beside it. */
export function PlatformIcon({ platform, size = 18, className = '' }: { platform: SourcePlatform; size?: number; className?: string }) {
  const Icon = ICONS[platform];
  return <Icon size={size} weight="bold" className={`shrink-0 text-text-muted ${className}`} aria-hidden="true" />;
}

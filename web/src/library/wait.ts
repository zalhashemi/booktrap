/** A wait in words, rounded the way a person would say it ("about 4 minutes"). */
export function aboutWait(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 2) return 'about a minute';
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'about an hour' : `about ${hours} hours`;
}

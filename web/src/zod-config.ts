import { z } from 'zod';

// Imported first in main.tsx, before anything validates: with compiled validators on, Zod would probe
// `new Function`, which the Content-Security-Policy refuses (and reports).
z.config({ jitless: true });

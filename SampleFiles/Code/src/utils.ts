export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const VERSION = "1.0.0";

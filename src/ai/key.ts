/**
 * Bob's Anthropic API key lives in this browser's localStorage only: never in
 * the doc, so it never reaches a backup, an export or another device.
 */
const KEY = 'chronicle.anthropicKey';

export function readApiKey(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY, key.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* private window: the key works for this visit only */
  }
}

/** "sk-ant-…abcd", so Bob can tell which key is set without showing it. */
export function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '…';
}

import { useSyncExternalStore } from 'react';

/**
 * A new version of the app is waiting (the service worker found one). The
 * app never reloads by itself, so nothing Bob is in the middle of is lost;
 * it shows a banner and reloads when he says so.
 */
let ready = false;
let apply: () => Promise<void> = async () => location.reload();
const listeners = new Set<() => void>();

export function onUpdateReady(applyUpdate: () => Promise<void>) {
  apply = applyUpdate;
  ready = true;
  for (const l of listeners) l();
}

// Lets e2e tests announce an update without a real service worker release.
window.addEventListener('chronicle:update-ready', () => onUpdateReady(async () => location.reload()));

export function useUpdateReady(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => ready);
}

export const applyUpdate = () => apply();

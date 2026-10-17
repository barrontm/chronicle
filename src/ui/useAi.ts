import { useEffect, useState } from 'react';
import { KEY_CHANGED, readApiKey } from '../ai/key';

/** Whether the browser says it's online, kept up to date. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);
  return online;
}

/** Bob's Anthropic key on this device, updated when it's saved or forgotten anywhere in the app. */
export function useApiKey(): string {
  const [key, setKey] = useState(readApiKey);
  useEffect(() => {
    const on = () => setKey(readApiKey());
    window.addEventListener(KEY_CHANGED, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(KEY_CHANGED, on); window.removeEventListener('storage', on); };
  }, []);
  return key;
}

/** Short commit and build date, set in vite.config.ts. */
declare const __APP_VERSION__: string;

declare module '*.md?raw' {
  const text: string;
  export default text;
}

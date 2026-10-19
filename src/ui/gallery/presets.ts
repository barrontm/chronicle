/** Stable states of the app on the Classical Greece fixture, for `/#gallery` and `npm run shots -- --gallery`. */
export interface Preset {
  id: string;
  label: string;
  device: 'desktop' | 'phone';
  view: 'timeline' | 'map' | 'split';
  year: number;
  /** MapLibre camera. */
  camera?: { center: [number, number]; zoom: number };
  /** Zoom the timeline out to show everything once it has opened. */
  fit?: boolean;
  /** Open in the classic layout ("Use the classic layout"): the Timeline, Map and Both views, and the Add menu. */
  classic?: boolean;
}

const AEGEAN = { center: [24.5, 38.6] as [number, number], zoom: 5.8 };
const AEGEAN_PHONE = { center: [24.5, 38.6] as [number, number], zoom: 4.7 };
const WEST = { center: [19, 38.2] as [number, number], zoom: 4.6 };

export const PRESETS: Preset[] = [
  { id: 'timeline', label: 'Timeline', device: 'desktop', view: 'timeline', year: -430, fit: true, classic: true },
  { id: 'map-salamis', label: 'Map, 480 BCE', device: 'desktop', view: 'map', year: -479, camera: AEGEAN, classic: true },
  { id: 'map-war', label: 'Map, 431 BCE', device: 'desktop', view: 'map', year: -430, camera: AEGEAN, classic: true },
  { id: 'split-decelea', label: 'Split, 410 BCE', device: 'desktop', view: 'split', year: -409, camera: AEGEAN, classic: true },
  { id: 'map-colonies', label: 'Colonies, 600 BCE', device: 'desktop', view: 'map', year: -599, camera: WEST, classic: true },
  { id: 'map-macedon', label: 'Map, 336 BCE', device: 'desktop', view: 'map', year: -335, camera: AEGEAN, classic: true },
  { id: 'phone-timeline', label: 'Timeline on a phone', device: 'phone', view: 'timeline', year: -430, fit: true, classic: true },
  { id: 'next-timeline', label: 'Reader layout: timeline', device: 'desktop', view: 'split', year: -430, camera: AEGEAN, fit: true },
  { id: 'phone-map', label: 'Map on a phone, 431 BCE', device: 'phone', view: 'map', year: -430, camera: AEGEAN_PHONE, classic: true },
];

export const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 412, height: 860 } } as const;

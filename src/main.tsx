import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/600.css';
import '@fontsource/spectral-sc/600.css';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/600.css';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';
import './ui/styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { IdbStore } from './store/idbStore';
import { onUpdateReady } from './ui/updates';

// Dev only: `/#gallery` shows the app on the Classical Greece fixture. Dead code in production builds.
const galleryHash = import.meta.env.DEV && location.hash.startsWith('#gallery') ? location.hash : null;

// Never reload on its own: a new version waits until Bob chooses to reload (see ui/updates.ts).
const updateSW = registerSW({ immediate: true, onNeedRefresh: () => onUpdateReady(() => updateSW(true)) });

const root = createRoot(document.getElementById('root')!);
if (galleryHash) {
  void import('./ui/gallery/Gallery').then(({ Gallery }) => root.render(<StrictMode><Gallery hash={galleryHash} /></StrictMode>));
} else {
  root.render(
    <StrictMode>
      <App store={new IdbStore()} />
    </StrictMode>,
  );
}

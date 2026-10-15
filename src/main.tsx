import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/600.css';
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

// Never reload on its own: a new version waits until Bob chooses to reload (see ui/updates.ts).
const updateSW = registerSW({ immediate: true, onNeedRefresh: () => onUpdateReady(() => updateSW(true)) });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={new IdbStore()} />
  </StrictMode>,
);

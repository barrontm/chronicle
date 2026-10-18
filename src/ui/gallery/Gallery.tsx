import { useEffect, useMemo } from 'react';
import { parseDoc } from '../../model/doc';
import { MemoryStore } from '../../store/store';
import fixtureJson from '../../../tests/fixtures/greece/classical-greece.json?raw';
import { App } from '../App';
import { PRESETS, SIZES, type Preset } from './presets';

/**
 * Dev only (main.tsx loads this only when import.meta.env.DEV): the real app on the Classical Greece
 * fixture, in memory, so nothing touches Bob's saved data.
 *   #gallery            every preset in a frame
 *   #gallery/<preset>   one preset full size (what the screenshot script drives)
 */
export function Gallery({ hash }: { hash: string }) {
  const id = hash.replace(/^#gallery\/?/, '');
  const preset = PRESETS.find((p) => p.id === id);
  if (preset) return <Seeded preset={preset} />;
  return <Index />;
}

function Seeded({ preset }: { preset: Preset }) {
  const store = useMemo(() => {
    // The app reads these once when it mounts.
    try {
      localStorage.setItem('chronicle.view', JSON.stringify(preset.view));
      localStorage.setItem('chronicle.year', String(preset.year));
      localStorage.setItem('chronicle.mapView', JSON.stringify(preset.camera ?? { center: [20, 35], zoom: 1.6 }));
      localStorage.setItem('chronicle.mapFlows', JSON.stringify({ show: true, hiddenCauses: [] }));
      localStorage.removeItem('chronicle.mapData');
      localStorage.setItem('chronicle.uiNext', JSON.stringify(!!preset.next));
    } catch { /* the app falls back to its own defaults */ }
    const s = new MemoryStore();
    void s.save(parseDoc(fixtureJson));
    return s;
  }, [preset]);
  useEffect(() => (preset.fit ? fitTimelineWhenReady() : undefined), [preset]);
  return <App store={store} />;
}

/** Press More → Show everything once the timeline has drawn its entries (the app has no other hook for this). */
function fitTimelineWhenReady() {
  let stopped = false;
  const tick = (tries: number) => {
    if (stopped || tries > 60) return;
    const more = [...document.querySelectorAll('button')].find((b) => b.textContent === 'More');
    if (!more || !document.querySelector('.vis-item, [data-testid=timeline][data-ready]')) return void setTimeout(() => tick(tries + 1), 100);
    more.click();
    setTimeout(() => [...document.querySelectorAll('[role=menuitem]')].find((m) => m.textContent === 'Show everything')?.dispatchEvent(new MouseEvent('click', { bubbles: true })), 50);
  };
  tick(0);
  return () => { stopped = true; };
}

const SCALE = 0.42;

function Index() {
  return (
    <main style={{ padding: 16, fontFamily: 'var(--font-ui, system-ui)' }}>
      <h1 style={{ margin: '0 0 4px' }}>Gallery</h1>
      <p style={{ margin: '0 0 16px' }}>The app on the Classical Greece fixture (test data). Open a frame on its own with <code>#gallery/&lt;name&gt;</code>.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {PRESETS.map((p) => {
          const { width, height } = SIZES[p.device];
          return (
            <figure key={p.id} style={{ margin: 0 }}>
              <div style={{ width: width * SCALE, height: height * SCALE, overflow: 'hidden', border: '1px solid #8886', borderRadius: 6 }}>
                <iframe
                  title={p.label}
                  src={`${location.pathname}#gallery/${p.id}`}
                  loading="lazy"
                  style={{ width, height, border: 0, transform: `scale(${SCALE})`, transformOrigin: '0 0' }}
                />
              </div>
              <figcaption style={{ padding: '4px 0' }}><a href={`#gallery/${p.id}`}>{p.label}</a></figcaption>
            </figure>
          );
        })}
      </div>
    </main>
  );
}

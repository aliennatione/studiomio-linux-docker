import { App } from './app/app';
import { userPresets } from './devices/user-presets';
import { userRacks } from './devices/user-racks';

// the user's presets and racks before the devices (they're few files); without them, the app starts anyway
await Promise.all([
  userPresets.load().catch(e => console.warn('presets: couldn\'t read them', e)),
  userRacks.load().catch(e => console.warn('racks: couldn\'t read them', e)),
]);

const app = new App(document.getElementById('app')!);
// Expose demo loader (manual/API) instead of auto-loading to avoid blank screen
app.loadDemoProject = async () => {
  try {
    const r = await fetch(import.meta.env.BASE_URL + 'demo-techno.json');
    if (!r.ok) return false;
    const p = await r.json();
    app.store.load(p);
    return true;
  } catch (e) { console.warn('demo load failed', e); return false; }
};
import { registerEditCommands } from './remote/edit-commands';
registerEditCommands(app);
import { registerCommands } from './remote/command-registry';
registerCommands(app);

// in development the app is reachable from the console (and from the automated checks); in the
// installed app only the controllers, for diagnosis from F12: copy(studiomio.surfaces.report())
Object.assign(window, { studiomio: app });

// Remote control polling (best-effort; ignored if no token)
const token = import.meta.env.VITE_REMOTE_TOKEN;
if (token) {
  const bpm = 120; const intervalMs = (4 * 60000) / bpm;
  setInterval(async () => {
    try {
      const r = await fetch('/pending', { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (j.command) {
        try {
          const c = JSON.parse(j.command);
          if (c.action === 'reload') location.reload();
          else if (c.action === 'invoke' && typeof c.method === 'string') {
            const app = (window as any).studiomio;
            const fn = app?.[c.method];
            if (typeof fn === 'function') fn(...(c.args || []));
          } else if (c.action === 'set' && typeof c.path === 'string') {
            const app = (window as any).studiomio;
            const parts = c.path.split('.');
            let o = app;
            for (let i=0;i<parts.length-1;i++) o = o?.[parts[i]];
            if (o) o[parts[parts.length-1]] = c.value;
          } else if (c.action === 'command' && typeof c.name === 'string') {
            const app = (window as any).studiomio;
            const fn = app?.commands?.[c.name] || app?.[c.name];
            if (typeof fn === 'function') fn(...(c.args || []));
            else console.warn('unknown command', c.name);
          } else {
            console.log('remote command:', c);
          }
        } catch (e) { console.warn('bad command', e); }
      }
    } catch {}
  }, intervalMs);
}

// Expose control inventory for API parity
try {
  const app = (window as any).studiomio;
  if (app && !app.controls) {
    app.controls = () => Object.keys(app).filter(k => typeof app[k] === 'function' || typeof app[k] !== 'undefined');
  }
} catch {}

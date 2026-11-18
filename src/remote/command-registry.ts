// Remote control command registry: exposes the app's public surface as commands.
// Enumerates methods/properties up to depth 2 so the API can govern the app.

function enumerate(obj: any, prefix = '', depth = 0, out: Record<string, any> = {}): Record<string, any> {
  if (!obj || depth > 2) return out;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('_')) continue;
    const val = obj[key];
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'function') {
      out[name] = (...args: any[]) => val.apply(obj, args);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      enumerate(val, name, depth + 1, out);
    }
  }
  return out;
}

export function registerCommands(app: any) {
  const commands = enumerate(app);
  app.commands = commands;

  const token = import.meta.env.VITE_REMOTE_TOKEN;
  if (token) {
    fetch('/register', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ methods: Object.keys(commands), paths: [] }),
    }).catch(() => {});
  }
  return commands;
}

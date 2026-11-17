import * as edits from '../store/edits';

export function registerEditCommands(app: any) {
  console.log('registerEditCommands called');
  const store = app.store;
  const commands: Record<string, (...args: any[]) => any> = app.commands || (app.commands = {});
  for (const [name, fn] of Object.entries(edits)) {
    if (typeof fn !== 'function') continue;
    commands['edit.' + name] = (...args: any[]) => store.apply((fn as any)(...args));
  }
  // transport controls
  commands['transport.play'] = () => app.audio?.engine?.play?.();
  commands['transport.stop'] = () => app.audio?.engine?.stop?.();

  // register schema
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
EOF
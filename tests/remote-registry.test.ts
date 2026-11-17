import { describe, it, expect } from 'vitest';
import { registerCommands } from '../src/remote/command-registry';

describe('command registry', () => {
  it('enumerates methods and registers commands', () => {
    const app: any = {
      transport: { play: () => 'played', stop: () => 'stopped', bpm: 120 },
      project: { addTrack: (k: string) => k },
    };
    const cmds = registerCommands(app);
    expect(typeof cmds['transport.play']).toBe('function');
    expect(typeof cmds['project.addTrack']).toBe('function');
    expect(cmds['transport.play']()).toBe('played');
    expect(app.commands).toBe(cmds);
  });
});
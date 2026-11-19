import { ProjectStore } from './src/store/project-store.ts';
import { randomIds } from './src/core/id.ts';
import { starterProject } from './src/store/edits.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const ids = randomIds();
const store = new ProjectStore(starterProject('Techno Demo', ids), ids);

// Basic techno: 4 tracks
const { addTrack, renameTrack, setInstrument } = await import('./src/store/edits.ts');
store.apply(addTrack('audio'));
store.apply(addTrack('midi'));
store.apply(addTrack('midi'));
const [audio, bass, lead] = store.project.tracks.map(t => t.id);
store.apply(renameTrack(audio, 'Kick'));
store.apply(renameTrack(bass, 'Bass'));
store.apply(renameTrack(lead, 'Lead'));

mkdirSync('dist', { recursive: true });
writeFileSync('dist/demo-techno.json', JSON.stringify(store.project));
console.log('written dist/demo-techno.json with', store.project.tracks.length, 'tracks');
EOF
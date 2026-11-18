import { ProjectStore } from '../src/store/project-store';
import { randomIds } from '../src/core/id';
import { starterProject, addTrack, renameTrack } from '../src/store/edits';
import { writeFileSync, mkdirSync } from 'node:fs';

const ids = randomIds;
const store = new ProjectStore(starterProject('Techno Demo', ids), ids);

store.apply(addTrack('audio'));
store.apply(addTrack('midi'));
store.apply(addTrack('midi'));
const [a, b, c] = store.project.tracks.slice(1).map(t => t.id);
store.apply(renameTrack(a, 'Kick'));
store.apply(renameTrack(b, 'Bass'));
store.apply(renameTrack(c, 'Hats'));

mkdirSync('dist', { recursive: true });
writeFileSync('dist/demo-techno.json', JSON.stringify(store.project));
console.log('demo written:', store.project.tracks.length, 'tracks');
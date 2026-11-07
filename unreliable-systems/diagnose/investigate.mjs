import { readFileSync } from 'node:fs';
import { investigate } from './lab.js';
import { renderReport } from './diagnose.js';

const file = process.argv[2];
const text = file === undefined ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
const report = await investigate(JSON.parse(text));
process.stdout.write(renderReport(report));

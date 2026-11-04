// Downloads RAMA's recorded answers for a dataset, the expected.json FPABench publishes with each size, and
// checks that they belong to the dataset. These are the answers every FPABench entry is held to.
//   node scripts/fetch-expected.mjs <FPABench checkout> <dataset dir> <expected file>
// The download URL is the one in the checkout's runner/run.mjs. The file is checked against the published
// SHA256SUMS, and its dataset id against the SHA-256 of the dataset's manifest.json, as the runner does.
// An expected file already there is kept when it belongs to the dataset.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [repo, datasetDir, out] = process.argv.slice(2);
if (!repo || !datasetDir || !out) {
  console.error('usage: node fetch-expected.mjs <FPABench checkout> <dataset dir> <expected file>');
  process.exit(1);
}
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const manifestText = fs.readFileSync(path.join(datasetDir, 'manifest.json'), 'utf8');
const datasetId = sha256(manifestText).slice(0, 16);
const size = JSON.parse(manifestText).size;
const belongs = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).dataset === datasetId;

if (fs.existsSync(out) && belongs(out)) {
  console.log(`${out} already holds RAMA's answers for dataset ${datasetId}`);
  process.exit(0);
}

const runner = fs.readFileSync(path.join(repo, 'runner', 'run.mjs'), 'utf8');
const m = /const DATA_URL = '([^']+)'/.exec(runner);
if (!m) throw new Error(`no DATA_URL in ${path.join(repo, 'runner', 'run.mjs')}`);
const url = (name) => `${m[1]}/${size}/${name}`;
const get = async (name) => {
  const res = await fetch(url(name));
  if (!res.ok) throw new Error(`${url(name)}: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
};

const sums = (await get('SHA256SUMS')).toString('utf8');
const line = sums.split('\n').find((l) => /[ *]expected\.json$/.test(l.trim()));
if (!line) throw new Error(`${url('SHA256SUMS')} lists no expected.json`);
const body = await get('expected.json');
if (sha256(body) !== line.trim().split(/\s+/)[0]) throw new Error('expected.json does not match its SHA-256');
const expected = JSON.parse(body.toString('utf8'));
if (expected.dataset !== datasetId) {
  throw new Error(`the published ${size} answers are for dataset ${expected.dataset}, and ${datasetDir} is dataset ${datasetId}. Generate the dataset again from an FPABench checkout whose generator matches the published one.`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`wrote ${out}: RAMA's answers for dataset ${datasetId}, recorded on ${expected.reference}`);

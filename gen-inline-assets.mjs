// Builds src/worker/inline-assets.gen.js from dist/ so the Worker can serve the UI itself
// (used because the assets direct-upload API wasn't reachable from the deploy tooling).
import fs from 'fs'; import path from 'path';
const dist = 'dist'; const out = {};
const types = { woff: 'font/woff', woff2: 'font/woff2', js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8', svg: 'image/svg+xml', json: 'application/json', ico: 'image/x-icon', png: 'image/png', txt: 'text/plain; charset=utf-8' };
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else { const ext = path.extname(p).slice(1); const buf = fs.readFileSync(p); const text = ['js','css','html','svg','json','txt'].includes(ext); out['/' + path.relative(dist, p).split(path.sep).join('/')] = { type: types[ext] || 'application/octet-stream', text, data: text ? buf.toString('utf8') : buf.toString('base64') }; } } };
walk(dist);
fs.writeFileSync('src/worker/inline-assets.gen.js', 'export default ' + JSON.stringify(out) + ';\n');
console.log(Object.keys(out));

// Send a Python file to the live Blender MCP bridge on 9876 and print its stdout.
// usage: node bl.mjs script.py [timeoutMs]
import net from 'node:net';
import fs from 'node:fs';
const code = fs.readFileSync(process.argv[2], 'utf8');
const timeout = +(process.argv[3] || 120000);
const s = net.connect(9876, '127.0.0.1');
let buf = '';
s.on('connect', () => s.write(JSON.stringify({ type: 'execute_code', params: { code } })));
s.on('data', d => {
  buf += d;
  try {
    const j = JSON.parse(buf);
    if (j.status === 'success') process.stdout.write(String(j.result?.result ?? JSON.stringify(j.result)));
    else console.log('BLENDER ERROR:', j.message || JSON.stringify(j));
    s.end(); process.exit(j.status === 'success' ? 0 : 1);
  } catch { /* partial */ }
});
s.on('error', e => { console.log('socket error', e.message); process.exit(2); });
setTimeout(() => { console.log('timeout; partial:', buf.slice(0, 500)); process.exit(3); }, timeout);

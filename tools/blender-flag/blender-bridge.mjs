/* Run a Python script inside the user's live Blender over the MCP bridge on
   127.0.0.1:9876 -- from Node, because this machine has no Python. Same
   protocol as angsobuild/facilities/blender_mcp_client.py: one JSON request
   {type, params}, one JSON reply; `execute_code` returns what the script
   printed.

     node tools/blender-flag/blender-bridge.mjs <script.py> [KEY=json ...] [--timeout=600]
     node tools/blender-flag/blender-bridge.mjs --info

   Each KEY=json becomes a global the script sees (MODE="calibrate" and so on),
   and __file__ is set to the script's own path so it can find its siblings. */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export function blenderRequest(type, params = {}, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 9876 });
    const chunks = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Blender did not answer within ${timeoutMs / 1000} s`)); }, timeoutMs);
    socket.on('connect', () => socket.write(JSON.stringify({ type, params })));
    socket.on('data', chunk => {
      chunks.push(chunk);
      let reply;
      try { reply = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return; /* not all of it yet */ }
      clearTimeout(timer);
      socket.end();
      if (reply.status !== 'success' || reply.result?.executed === false) reject(new Error(JSON.stringify(reply).slice(0, 2000)));
      else resolve(reply.result);
    });
    socket.on('error', error => { clearTimeout(timer); reject(error); });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1'));
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === '--info') {
    console.log(JSON.stringify(await blenderRequest('get_scene_info'), null, 2));
  } else {
    const script = path.resolve(args[0]);
    const timeout = +(args.find(a => a.startsWith('--timeout='))?.slice(10) || 600);
    const globals = args.slice(1).filter(a => !a.startsWith('--') && a.includes('='))
      .map(a => { const i = a.indexOf('='); return `${a.slice(0, i)} = ${a.slice(i + 1)}`; });
    const code = [`__file__ = ${JSON.stringify(script)}`, ...globals, fs.readFileSync(script, 'utf8')].join('\n');
    const result = await blenderRequest('execute_code', { code }, timeout * 1000);
    process.stdout.write(typeof result.result === 'string' ? result.result : JSON.stringify(result));
  }
}

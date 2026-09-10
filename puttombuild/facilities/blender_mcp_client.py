"""Run an explicit local Python script through Blender's localhost bridge."""
import argparse
import json
from pathlib import Path
import socket


def request(command, params, port=9876, timeout=120):
    with socket.create_connection(('127.0.0.1', port), timeout=8) as connection:
        connection.settimeout(timeout)
        connection.sendall(json.dumps({'type': command, 'params': params}).encode('utf-8'))
        payload = bytearray()
        while len(payload) < 32*1024*1024:
            chunk = connection.recv(65536)
            if not chunk:
                raise RuntimeError('Incomplete response from Blender')
            payload.extend(chunk)
            try:
                result = json.loads(payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if result.get('status') != 'success' or result.get('result', {}).get('executed') is False:
                raise RuntimeError(str(result))
            return result
        raise RuntimeError('Blender response exceeded 32 MiB')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--script', type=Path)
    parser.add_argument('--port', type=int, default=9876)
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()
    if args.script:
        path = args.script.resolve()
        scope = {'__name__': '__main__', '__file__': str(path),
                 'PUTTOM_REPO_ROOT': str(Path(__file__).resolve().parents[2])}
        code = f'exec(compile({path.read_text(encoding="utf-8")!r}, {str(path)!r}, "exec"), {scope!r})'
        response = request('execute_code', {'code': code}, args.port, args.timeout)
    else:
        response = request('get_scene_info', {}, args.port, args.timeout)
    print(json.dumps(response, ensure_ascii=False, indent=2))

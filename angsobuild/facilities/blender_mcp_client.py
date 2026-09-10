"""Execute a local script through the user's Blender bridge on port 9876."""
import argparse
import json
from pathlib import Path
import socket


def request(command, params, port=9876, timeout=180):
    with socket.create_connection(('127.0.0.1', port), timeout=10) as connection:
        connection.settimeout(timeout)
        connection.sendall(json.dumps({'type': command, 'params': params}).encode('utf-8'))
        payload = bytearray()
        while len(payload) < 32 * 1024 * 1024:
            chunk = connection.recv(65536)
            if not chunk:
                raise RuntimeError('Blender disconnected before completing its reply')
            payload.extend(chunk)
            try:
                result = json.loads(payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if result.get('status') != 'success' or result.get('result', {}).get('executed') is False:
                raise RuntimeError(str(result))
            return result
        raise RuntimeError('Blender response exceeds 32 MiB')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--script', type=Path)
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_args()
    if args.script:
        path = args.script.resolve()
        scope = {'__name__': '__main__', '__file__': str(path)}
        code = f'exec(compile({path.read_text(encoding="utf-8-sig")!r}, {str(path)!r}, "exec"), {scope!r})'
        response = request('execute_code', {'code': code}, timeout=args.timeout)
    else:
        response = request('get_scene_info', {}, timeout=args.timeout)
    print(json.dumps(response, ensure_ascii=False, indent=2))

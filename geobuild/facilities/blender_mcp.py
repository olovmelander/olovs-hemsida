"""Send an explicit Python script to the user's local Blender bridge (9876)."""
import argparse
import json
from pathlib import Path
import socket


def request(command, params, port=9876, timeout=90):
    with socket.create_connection(('127.0.0.1', port), timeout=8) as connection:
        connection.settimeout(timeout)
        connection.sendall(json.dumps({'type': command, 'params': params}).encode('utf-8'))
        payload = bytearray()
        while len(payload) < 32 * 1024 * 1024:
            chunk = connection.recv(65536)
            if not chunk:
                raise RuntimeError('Blender closed the connection before a complete response')
            payload.extend(chunk)
            try:
                response = json.loads(payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if response.get('status') != 'success':
                raise RuntimeError(response.get('message', str(response)))
            if response.get('result', {}).get('executed') is False:
                raise RuntimeError(str(response['result']))
            return response
        raise RuntimeError('Blender response exceeded 32 MiB')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--script', type=Path)
    parser.add_argument('--port', type=int, default=9876)
    parser.add_argument('--timeout', type=int, default=90)
    args = parser.parse_args()
    if args.script:
        filename = str(args.script.resolve())
        source = args.script.read_text(encoding='utf-8')
        # The bridge's default __name__ is builtins, not __main__. Supply normal
        # script semantics and an isolated namespace so entry points actually run.
        scope = {'__name__': '__main__', '__file__': filename,
                 'VECK_REPO_ROOT': str(Path(__file__).resolve().parents[2])}
        code = f'exec(compile({source!r}, {filename!r}, "exec"), {scope!r})'
        response = request('execute_code', {'code': code}, args.port, args.timeout)
    else:
        response = request('get_scene_info', {}, args.port, args.timeout)
    print(json.dumps(response, ensure_ascii=False, indent=2))

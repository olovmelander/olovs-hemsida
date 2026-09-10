"""Call the existing Blender MCP add-on on localhost; keep scene edits in files."""
import argparse
import json
from pathlib import Path
import socket


def request(command, port=9876, timeout=180):
    with socket.create_connection(('127.0.0.1', port), timeout=10) as connection:
        connection.settimeout(timeout)
        connection.sendall(json.dumps(command).encode('utf8'))
        received = bytearray()
        while len(received) <= 64_000_000:
            block = connection.recv(65536)
            if not block:
                raise RuntimeError('Blender closed the connection before a complete response')
            received.extend(block)
            try:
                response = json.loads(received)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if response.get('status') != 'success':
                raise RuntimeError(response.get('message', 'Blender command failed'))
            return response
        raise RuntimeError('Blender response exceeded 64 MB')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--exec', dest='script', type=Path)
    parser.add_argument('--port', type=int, default=9876)
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_args()
    code = ('__file__ = ' + repr(str(args.script.resolve())) + '\n' + args.script.read_text(encoding='utf8')) if args.script else None
    command = {'type': 'execute_code', 'params': {'code': code}} if code else {'type': 'get_scene_info', 'params': {}}
    print(json.dumps(request(command, args.port, args.timeout), ensure_ascii=True))

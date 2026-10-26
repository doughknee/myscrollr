"""Exercise the real nginx/FPM limits with disposable files, never production data."""
import base64
import http.client
import json
import pathlib
import socket
import subprocess
import sys
import tempfile
import time

IMAGE = sys.argv[1] if len(sys.argv) > 1 else 'scrollr/osticket-runtime:8.2.35-security3'
NAME = 'scrollr396-upload-test'
PORT = 18996
MIB = 1024 * 1024


def run(*args):
    return subprocess.check_output(args, text=True).strip()


with tempfile.TemporaryDirectory(prefix='scrollr396-') as directory:
    site = pathlib.Path(directory)
    site.chmod(0o755)
    # This fixture shares the production helper and FPM configuration, but no DB/mail.
    (site/'index.php').write_text('''<?php
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
if (isset($_GET['fatal'])) throw new RuntimeException('PRIVATE-DIAGNOSTIC-SENTINEL');
require '/usr/local/lib/scrollr-security/inline-image.php';
header('Content-Type: application/json');
if (isset($_GET['inline'])) {
    if (!scrollr_valid_inline_upload($_FILES['file'] ?? null)) {
        http_response_code(422); echo '{"error":"Invalid image upload"}'; exit;
    }
    $file = array_map(fn($v) => array_values($v)[0], $_FILES['file']);
    $data = file_get_contents($file['tmp_name']);
    if (str_starts_with($data, 'data:')) {
        if (!preg_match('~^data:(image/[a-z]+);base64,(.*)$~s', $data, $match)) {
            http_response_code(422); exit;
        }
        $file = ['type'=>$match[1], 'data'=>base64_decode($match[2], true)];
    }
    if (!scrollr_validate_inline_image($file, 8*1024*1024)) {
        http_response_code(422); exit;
    }
    echo json_encode(['image'=>$file['type']]); exit;
}
if (isset($_GET['files'])) {
    echo json_encode(['sizes'=>$_FILES['file']['size'] ?? [],
        'errors'=>$_FILES['file']['error'] ?? []]); exit;
}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = fopen('php://input', 'rb'); $size = 0;
    while (!feof($in)) $size += strlen(fread($in, 65536));
    echo json_encode(['bytes'=>$size]); exit;
}
echo '{"ready":true}';
''')

    def request(path='/', data=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', PORT, timeout=30)
        conn.request('POST' if data is not None else 'GET', path, body=data, headers=headers or {})
        response = conn.getresponse()
        result = response.status, response.read()
        conn.close()
        assert not any(x in result[1] for x in [b'Fatal error', b'Stack trace', b'/www/', b'PRIVATE-DIAGNOSTIC'])
        return result

    def multipart(files):
        boundary = 'scrollr-isolated-boundary'
        body = bytearray()
        for field, name, mime, data in files:
            body.extend((f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\n'
                         f'Content-Type: {mime}\r\n\r\n').encode())
            body.extend(data)
            body.extend(b'\r\n')
        body.extend(f'--{boundary}--\r\n'.encode())
        return bytes(body), {'Content-Type': 'multipart/form-data; boundary='+boundary}

    try:
        run('docker', 'run', '-d', '--name', NAME, '-p', f'127.0.0.1:{PORT}:80',
            '-v', str(site)+':/www/osticket:ro', '--entrypoint', 'sh', IMAGE,
            '-c', "php-fpm -D; exec nginx -g 'daemon off;'")
        for _ in range(50):
            try:
                if request()[0] == 200:
                    break
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(.1)
        else:
            raise AssertionError('Isolated runtime did not start')

        # Content-Length is rejected from headers alone, before sending any body.
        with socket.create_connection(('127.0.0.1', PORT), timeout=5) as sock:
            sock.sendall(f'POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: {80*MIB+1}\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n'.encode())
            assert b' 413 ' in sock.recv(4096)

        # Unknown-length bodies must stop at the same cap (isolated loopback only).
        conn = http.client.HTTPConnection('127.0.0.1', PORT, timeout=30)
        conn.putrequest('POST', '/')
        conn.putheader('Transfer-Encoding', 'chunked')
        conn.endheaders()
        try:
            for _ in range(81):
                conn.send(b'100000\r\n' + b'x'*MIB + b'\r\n')
            conn.send(b'0\r\n\r\n')
        except (BrokenPipeError, ConnectionResetError):
            pass
        assert conn.getresponse().status == 413
        conn.close()

        # Preserve the desktop's five 10 MiB attachments, including base64 overhead.
        encoded = base64.b64encode(b'x'*(10*MIB)).decode()
        body = json.dumps({'attachments': [{'file.txt': 'text/plain;base64,'+encoded} for _ in range(5)]}).encode()
        status, result = request('/', body, {'Content-Type': 'application/json'})
        assert status == 200 and json.loads(result)['bytes'] == len(body)
        body, headers = multipart([('file[]', f'{i}.txt', 'text/plain', b'x'*(10*MIB)) for i in range(5)])
        status, result = request('/?files', body, headers)
        assert status == 200 and json.loads(result) == {'sizes':[10*MIB]*5, 'errors':[0]*5}

        fixtures = json.loads(run('docker', 'exec', NAME, 'php', '-r', '''$out=[];
foreach(['png','jpeg','gif','webp'] as $ext) { $im=imagecreatetruecolor(32,32);
ob_start(); ('image'.$ext)($im); $out[$ext]=base64_encode(ob_get_clean()); imagedestroy($im); }
echo json_encode($out);'''))
        for ext, value in fixtures.items():
            data = base64.b64decode(value)
            for payload in [data, ('data:image/'+ext+';base64,'+value).encode()]:
                body, headers = multipart([('file[]', 'screenshot.'+ext, 'image/'+ext, payload)])
                status, result = request('/?inline', body, headers)
                assert status == 200 and json.loads(result)['image'] == 'image/'+ext

        for fields in [[], [('file', 'x.png', 'image/png', data)],
                       [('file[][]', 'x.png', 'image/png', data)],
                       [('file[]', '', 'image/png', b'')],
                       [('file[]', 'x.png', 'image/png', b'x'*(16*MIB+1))],
                       [('file[]', 'x.png', 'image/png', data)]*2]:
            body, headers = multipart(fields)
            status, result = request('/?inline', body, headers)
            assert status == 422 and json.loads(result)['error'] == 'Invalid image upload'

        status, result = request('/?fatal')
        assert status == 500 and result == b''
        logs = subprocess.run(['docker','logs',NAME], capture_output=True, text=True, check=True)
        assert 'PRIVATE-DIAGNOSTIC-SENTINEL' in logs.stderr + logs.stdout
        print('PASS: 80 MiB header/chunked caps; five 10 MiB files + base64; four image formats + data URIs; malformed/oversized uploads; non-overridable error suppression and private diagnostics')
    finally:
        subprocess.run(['docker','rm','-f',NAME], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

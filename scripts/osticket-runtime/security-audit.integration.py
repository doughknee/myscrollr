"""Isolated nginx/PHP integration; no production data or network route is mounted."""
import json, pathlib, sqlite3, subprocess, tempfile, time, urllib.request

IMAGE = 'scrollr/osticket-runtime:8.2.35-security2'
NAME = 'scrollr395-test'

def run(*args):
    return subprocess.check_output(args, text=True).strip()

with tempfile.TemporaryDirectory(prefix='scrollr395-') as directory:
    root = pathlib.Path(directory)
    root.chmod(0o755)
    site = root/'site'; site.mkdir(); site.chmod(0o755)
    audit = root/'audit'; audit.mkdir()
    fixture = '<?php http_response_code(200); echo "support-ok";'
    for name in ['index.php','open.php','ajax.php','file.php']:
        (site/name).write_text(fixture)
    command = """install -d -m 0700 -o 65534 -g 65534 /var/lib/scrollr-support-audit
install -d -m 0750 -o 65534 -g 33 /run/scrollr-audit
setpriv --reuid=65534 --regid=33 --clear-groups php /usr/local/lib/scrollr-security/security-audit.php &
echo $! > /run/test-collector.pid
php-fpm -D
exec nginx -g 'daemon off;'"""
    def start():
        gateway=json.loads(run('docker','network','inspect','bridge'))[0]['IPAM']['Config'][0]['Gateway']
        run('docker','run','-d','--name',NAME,'--add-host','coolify-proxy:'+gateway,
            '-p','127.0.0.1:18995:80','-v',str(site)+':/www/osticket:ro',
            '-v',str(audit)+':/var/lib/scrollr-support-audit','--entrypoint','sh',IMAGE,'-c',command)
        for _ in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:18995/',timeout=1) as response:
                    if response.read()==b'support-ok':return
            except Exception:time.sleep(.2)
        raise AssertionError('Isolated support fixture did not start')
    def request(path, forwarded, data=None):
        req=urllib.request.Request('http://127.0.0.1:18995'+path,data=data,
            headers={'X-Forwarded-For':forwarded,'Cookie':'SECRET-cookie','Authorization':'Bearer SECRET-token'})
        with urllib.request.urlopen(req,timeout=3) as response:assert response.read()==b'support-ok'
    def rows():
        files=list(audit.glob('*.sqlite'));assert len(files)==1,files
        with sqlite3.connect(files[0]) as db:
            return db.execute('SELECT source,kind,method,route,status,requests FROM requests').fetchall()
    try:
        start()
        request('/open.php?email=SECRET-email','203.0.113.77',b'SECRET-body')
        request('/open.php?email=SECRET-email','192.0.2.99, 203.0.113.77',b'SECRET-body')
        request('/ajax.php/draft/operator-fixture/attach?token=SECRET-file','203.0.113.77',b'x'*1024*1024)
        request('/file.php?key=SECRET-signature','203.0.113.77')
        for _ in range(30):
            found=rows()
            if any(r[3]=='support' and r[5]==2 for r in found):break
            time.sleep(.1)
        support=[r for r in found if r[3]=='support'];assert len(support)==1 and support[0][1]=='proxy' and support[0][5]==2,found
        assert any(r[3]=='upload' and r[4]==200 for r in found),found
        assert any(r[3]=='file' for r in found),found
        for f in audit.iterdir():
            if f.suffix=='.sqlite':assert b'SECRET' not in f.read_bytes() and b'203.0.113.77' not in f.read_bytes()
        assert (audit/'source.key').stat().st_mode & 0o077 == 0
        assert run('docker','exec','--user','80:33',NAME,'sh','-c','test ! -r /var/lib/scrollr-support-audit/source.key && echo restricted')=='restricted'
        run('docker','rm','-f',NAME);start()
        assert all(row in rows() for row in support),'Evidence lost on rotation'
        # Killing the collector must not hold the HTTP request or prevent screenshot bodies.
        run('docker','exec',NAME,'sh','-c','read pid < /run/test-collector.pid; kill "$pid"')
        request('/ajax.php/draft/operator-fixture/attach','203.0.113.77',b'x'*1024*1024)
        print('Isolated nginx: routes, body handling, redaction, restricted storage, rotation and collector-outage checks passed')
    finally:
        subprocess.run(['docker','rm','-f',NAME],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

<?php
// No request text leaves the local socket; only these bounded aggregates reach disk.
const SCROLLR_AUDIT_ROUTES = ['home','support','login','account','password','ticket','file','upload','ajax','staff','api','other'];

function scrollr_audit_event(array $record, array $trusted, string $key, int $now): array {
    $peer = $record['peer'] ?? '';
    if (!is_string($peer) || !filter_var($peer, FILTER_VALIDATE_IP)) throw new RuntimeException('Invalid peer');
    $ip = $peer;
    $sourceKind = 'direct';
    if (in_array($peer, $trusted, true)) {
        $forwarded = $record['forwarded'] ?? '';
        if (!is_string($forwarded) || strlen($forwarded) > 2048) throw new RuntimeException('Invalid forwarding');
        // Traefik appends the connection source. Never accept the caller's leftmost value.
        $parts = explode(',', $forwarded);
        $ip = trim(end($parts));
        if (!filter_var($ip, FILTER_VALIDATE_IP)) throw new RuntimeException('Missing trusted source');
        $sourceKind = 'proxy';
    }
    $route = $record['route'] ?? 'other';
    if (!in_array($route, SCROLLR_AUDIT_ROUTES, true)) $route = 'other';
    $method = $record['method'] ?? '';
    if (!in_array($method, ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'], true)) $method = 'OTHER';
    $status = $record['status'] ?? null;
    if (!is_int($status) || $status < 100 || $status > 599) throw new RuntimeException('Invalid status');
    $day = gmdate('Y-m-d', $now);
    return ['hour'=>intdiv($now,3600)*3600,
        'source'=>hash_hmac('sha256', "scrollr-support-source\0".$day."\0".inet_pton($ip), $key),
        'kind'=>$sourceKind,'method'=>$method,'route'=>$route,'status'=>$status];
}

function scrollr_audit_database(string $path): SQLite3 {
    $db = new SQLite3($path);
    $db->enableExceptions(true);
    $db->busyTimeout(25);
    $db->exec('PRAGMA page_size=4096; PRAGMA max_page_count=4096; PRAGMA journal_mode=DELETE');
    $db->exec('CREATE TABLE IF NOT EXISTS requests (
        hour INTEGER, source TEXT, kind TEXT, method TEXT, route TEXT, status INTEGER,
        requests INTEGER NOT NULL DEFAULT 1, first_seen INTEGER, last_seen INTEGER,
        PRIMARY KEY(hour,source,kind,method,route,status)) WITHOUT ROWID');
    return $db;
}

function scrollr_audit_store(SQLite3 $db, array $event, int $now, int $limit=10000): bool {
    $where = 'hour=:hour AND source=:source AND kind=:kind AND method=:method AND route=:route AND status=:status';
    $update = $db->prepare('UPDATE requests SET requests=requests+1,last_seen=:now WHERE '.$where);
    foreach ($event as $k=>$v) $update->bindValue(':'.$k, $v, is_int($v) ? SQLITE3_INTEGER : SQLITE3_TEXT);
    $update->bindValue(':now', $now, SQLITE3_INTEGER);
    $update->execute();
    if ($db->changes()) return true;
    if ($db->querySingle('SELECT count(*) FROM requests') >= $limit) return false;
    $insert = $db->prepare('INSERT INTO requests(hour,source,kind,method,route,status,first_seen,last_seen)
        VALUES(:hour,:source,:kind,:method,:route,:status,:now,:now)');
    foreach ($event as $k=>$v) $insert->bindValue(':'.$k, $v, is_int($v) ? SQLITE3_INTEGER : SQLITE3_TEXT);
    $insert->bindValue(':now', $now, SQLITE3_INTEGER);
    $insert->execute();
    return true;
}

function scrollr_audit_prune(string $directory, int $now): void {
    $cutoff = gmdate('Y-m-d', $now - 30*86400);
    foreach (glob($directory.'/????-??-??.sqlite*') as $file) {
        if (preg_match('/^(\d{4}-\d{2}-\d{2})\.sqlite(?:-journal)?$/D', basename($file), $match)
            && $match[1] < $cutoff && !is_link($file)) unlink($file);
    }
}

function scrollr_audit_run(): void {
    umask(0077);
    $directory = '/var/lib/scrollr-support-audit';
    $socketPath = '/run/scrollr-audit/events.sock';
    if (file_exists($socketPath)) unlink($socketPath);
    $socket = stream_socket_server('udg://'.$socketPath, $errno, $error, STREAM_SERVER_BIND);
    if (!$socket) throw new RuntimeException('Cannot bind audit socket');
    chmod($socketPath, 0620);
    stream_set_timeout($socket, 5);
    $trusted = gethostbynamel('coolify-proxy') ?: [];
    $db = null; $day = ''; $key = null; $lastWarning = 0; $lastHealth = 0;
    $recorded = 0; $dropped = 0;
    while (true) {
        $raw = stream_socket_recvfrom($socket, 8192);
        $now = time();
        try {
            if (!$key) {
                $keyPath = $directory.'/source.key';
                if (!file_exists($keyPath)) {
                    $handle = fopen($keyPath, 'x');
                    if (!$handle) throw new RuntimeException('Cannot create audit key');
                    fwrite($handle, random_bytes(32)); fclose($handle);
                }
                $key = file_get_contents($keyPath);
                if (strlen($key) !== 32) { $key = null; throw new RuntimeException('Invalid audit key'); }
            }
            if ($day !== gmdate('Y-m-d',$now)) {
                if ($db) $db->close();
                $db = null;
                scrollr_audit_prune($directory, $now);
                $db = scrollr_audit_database($directory.'/'.gmdate('Y-m-d',$now).'.sqlite');
                $day = gmdate('Y-m-d',$now);
            }
            if ($raw !== false && $raw !== '') {
                if (!preg_match('/^<\d{1,3}>\w{3} +\d{1,2} \d{2}:\d{2}:\d{2} scrollr_audit: (\{.*\})$/Ds', $raw, $match)) {
                    throw new RuntimeException('Invalid record');
                }
                $record = json_decode($match[1], true, 8, JSON_THROW_ON_ERROR);
                if (!is_array($record)) throw new RuntimeException('Invalid record');
                $event = scrollr_audit_event($record, $trusted, $key, $now);
                if (!scrollr_audit_store($db,$event,$now)) throw new RuntimeException('Daily budget');
                $recorded++;
            }
        } catch (Throwable $error) {
            $dropped++;
            if ($now-$lastWarning >= 60) {
                // Never print the exception: filesystem paths or supplied input may be sensitive.
                fwrite(STDERR,"[SupportAudit] incomplete evidence; support remains available\n");
                $lastWarning = $now;
            }
        }
        if ($now-$lastHealth >= 60) {
            $health = ['updatedAt'=>gmdate('c',$now),'recorded'=>$recorded,'dropped'=>$dropped,'trustedProxyResolved'=>(bool)$trusted];
            @file_put_contents($directory.'/health.json', json_encode($health), LOCK_EX);
            $lastHealth = $now;
            $trusted = gethostbynamel('coolify-proxy') ?: [];
        }
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) scrollr_audit_run();

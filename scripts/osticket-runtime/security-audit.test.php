<?php
require __DIR__.'/security-audit.php';
function verify($ok, $message) { if (!$ok) throw new RuntimeException($message); }
$now = strtotime('2026-10-26T18:00:00Z');
$key = str_repeat('k',32);
$record = ['peer'=>'10.0.19.4','forwarded'=>'203.0.113.77','method'=>'POST','route'=>'upload','status'=>200];
$event = scrollr_audit_event($record,['10.0.19.4'],$key,$now);
verify($event['kind']==='proxy','Trusted proxy missing');
$spoof = $record; $spoof['forwarded']='192.0.2.99, 203.0.113.77';
verify(scrollr_audit_event($spoof,['10.0.19.4'],$key,$now)===$event,'Caller-controlled left value trusted');
$direct = $record; $direct['peer']='203.0.113.77';
verify(scrollr_audit_event($direct,['10.0.19.4'],$key,$now)['source']===$event['source'],'Direct source mismatch');
$spoof['peer']='192.0.2.55';
verify(scrollr_audit_event($spoof,['10.0.19.4'],$key,$now)['source']!==$event['source'],'Untrusted forwarding trusted');
verify(scrollr_audit_event($record,['10.0.19.4'],$key,$now+86400)['source']!==$event['source'],'Daily hash did not rotate');
$bad=$record; $bad['forwarded']='203.0.113.77, invalid';
try { scrollr_audit_event($bad,['10.0.19.4'],$key,$now); throw new LogicException('Bad forwarding accepted'); }
catch (RuntimeException $e) { verify(!($e instanceof LogicException),'Bad forwarding accepted'); }
$v6=$record; $v6['forwarded']='2001:db8::1'; $v6b=$v6; $v6b['forwarded']='2001:0db8:0000:0000:0000:0000:0000:0001';
verify(scrollr_audit_event($v6,['10.0.19.4'],$key,$now)===scrollr_audit_event($v6b,['10.0.19.4'],$key,$now),'IPv6 not canonical');
$secret=$record+['body'=>'private@example.com','query'=>'token=SECRET','cookie'=>'session=SECRET','agent'=>'SECRET'];
$secret['route']='/file.php?token=SECRET'; $secret['method']='SECRET';
$safe=scrollr_audit_event($secret,['10.0.19.4'],$key,$now);
verify(!str_contains(json_encode($safe),'SECRET') && $safe['route']==='other' && $safe['method']==='OTHER','Input leaked');
$dir=sys_get_temp_dir().'/scrollr-audit-test-'.bin2hex(random_bytes(5));mkdir($dir,0700);
try {
 $path=$dir.'/2026-10-26.sqlite';$db=scrollr_audit_database($path);
 verify(scrollr_audit_store($db,$event,$now,1),'First event lost');
 verify(scrollr_audit_store($db,$event,$now+1,1),'Repeat not aggregated');
 verify(!scrollr_audit_store($db,$safe,$now,1),'Daily row cap bypassed');
 $db->close();$db=scrollr_audit_database($path);
 verify($db->querySingle('SELECT requests FROM requests')===2,'Durable readback failed');
 verify($db->querySingle('PRAGMA max_page_count')===4096,'Page cap missing');
 verify(!str_contains(file_get_contents($path),'203.0.113.77'),'Raw source stored');
 $db->close();
 file_put_contents($dir.'/2026-09-25.sqlite','expired');file_put_contents($dir.'/2026-09-26.sqlite','retain');
 scrollr_audit_prune($dir,$now);
 verify(!file_exists($dir.'/2026-09-25.sqlite') && file_exists($dir.'/2026-09-26.sqlite'),'Retention boundary wrong');
} finally {foreach(glob($dir.'/*') as $file)unlink($file);rmdir($dir);}
echo "Security audit trust, privacy, bounds and durability checks passed\n";

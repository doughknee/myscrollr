<?php
// No osTicket database or outbound requests: pin the ThreadEntry timestamp contract.
require __DIR__ . '/notify.message.php';

$createdAt = new ReflectionMethod('ScrollrReplyNotify', 'createdAt');
$cases = array(
    array(new class { function getCreateDate() { return '2026-10-08 09:47:02'; } }, '2026-10-08T09:47:02Z'),
    array(new class { function getCreated() { return '2026-10-08 09:47:02'; } }, '2026-10-08T09:47:02Z'),
    array(new class { function getCreateDate() { return '2026-10-08T09:47:02Z'; } }, '2026-10-08T09:47:02Z'),
    array(new class { function getCreateDate() { return 'bad date'; } }, ''),
    array(new stdClass(), ''),
);
// osTicket dates are UTC even if the host's PHP default timezone is not.
date_default_timezone_set('America/Chicago');
foreach ($cases as $case) {
    $actual = $createdAt->invoke(null, $case[0]);
    if ($actual !== $case[1]) {
        fwrite(STDERR, "Timestamp mismatch: expected {$case[1]}, got {$actual}\n");
        exit(1);
    }
}
echo "osTicket follow-up timestamp contract passed\n";

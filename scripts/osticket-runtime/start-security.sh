#!/bin/sh
set -eu
php /usr/local/lib/scrollr-security/patch-inline-image.php
# Dedicated host bind mount; PHP-FPM (uid 80) cannot read these records or their key.
install -d -m 0700 -o 65534 -g 65534 /var/lib/scrollr-support-audit
install -d -m 0750 -o 65534 -g 33 /run/scrollr-audit
(
    while true; do
        setpriv --reuid=65534 --regid=33 --clear-groups php /usr/local/lib/scrollr-security/security-audit.php || true
        echo '[SupportAudit] collector restarting; evidence may be incomplete' >&2
        sleep 5
    done
) &
exec start-osticket

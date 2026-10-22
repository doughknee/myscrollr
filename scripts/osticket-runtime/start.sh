#!/bin/sh
# nginx in the foreground, php-fpm daemonised, osTicket cron every minute (as
# the old image's crontab did) running as the volume's owner.
# ponytail: no supervisor; if php-fpm dies the healthcheck goes red rather than
# restarting it. Add s6/tini if that ever happens.
set -e
php-fpm -D
(
  while sleep 60; do
    setpriv --reuid=80 --regid=33 --clear-groups php -q /www/osticket/api/cron.php >/dev/null 2>&1 || true
  done
) &
exec nginx -g 'daemon off;'

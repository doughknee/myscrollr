# Runtime for support.myscrollr.com (osTicket). Replaces tiredofit/osticket,
# which was archived in Jul 2023 and pulled from Docker Hub, stranding us on
# PHP 8.2.8 (PHP2Shell, CVE-2026-109618/109619). SCROLLR-365.
#
# Code and config stay in the existing volume mounted at /www/osticket; this
# image is only nginx + php-fpm + the osTicket cron. Rebuild for a PHP patch:
#   docker build --pull -t scrollr/osticket-runtime:<php-version> .
FROM php:8.2-fpm-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      nginx curl \
      libc-client-dev libkrb5-dev libfreetype6-dev libjpeg62-turbo-dev libpng-dev \
      libicu-dev libldap2-dev libzip-dev libbz2-dev \
 && docker-php-ext-configure gd --with-freetype --with-jpeg \
 && docker-php-ext-configure imap --with-kerberos --with-imap-ssl \
 && docker-php-ext-install -j"$(nproc)" bcmath bz2 exif gd imap intl ldap mysqli opcache pdo_mysql zip \
 && pecl install apcu && docker-php-ext-enable apcu \
 && rm -rf /var/lib/apt/lists/* /tmp/pear

# The volume's files are owned 80:33 (the old image's nginx user); keep that
# identity so osTicket can still write where it could before.
RUN useradd -u 80 -g 33 -M -d /www/osticket -s /usr/sbin/nologin osticket \
 && sed -i -e 's/^user = .*/user = osticket/' -e 's/^group = .*/group = www-data/' \
      /usr/local/etc/php-fpm.d/www.conf \
 && rm -f /etc/nginx/sites-enabled/default

COPY php.ini /usr/local/etc/php/conf.d/zz-osticket.ini
COPY php-fpm-security.conf /usr/local/etc/php-fpm.d/zzz-scrollr-security.conf
COPY nginx.conf /etc/nginx/sites-enabled/osticket.conf
COPY start.sh /usr/local/bin/start-osticket

EXPOSE 80
CMD ["start-osticket"]

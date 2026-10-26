# Inline image validation deployment

## Request and error boundaries (SCROLLR-396/397)

The nginx and PHP POST envelope is 80 MiB, including requests with chunked
transfer encoding. It preserves five 10 MiB desktop attachments plus base64
expansion (about 67 MiB) and message/JSON overhead. PHP accepts individual
multipart files up to 16 MiB so pasted data URIs for supported 8 MiB inline
images still fit. The decoded inline image limit remains 8 MiB / 16 megapixels;
ordinary screenshots of up to 10 MiB remain supported as attachments. No
existing tickets, files, or upload configuration rows are deleted or rewritten.

FPM pool admin flags suppress displayed PHP errors even when osTicket calls
`ini_set`; diagnostics stay in private container logs. The inline handler
rejects missing/scalar/nested/failed uploads with 422 before normalization or
file access, while preserving the `file[]` multipart and data-URI contracts.

No IP-based limiter is added here: nginx sees the shared proxy address, so an
unqualified per-IP limit could block all customers together. Per-request caps
bound one request, not aggregate traffic or sustained concurrent abuse.

Build `Dockerfile.security` as `scrollr/osticket-runtime:8.2.35-security3`.
Run the PHP checks and `python3 upload-boundaries.integration.py <image>` against
an isolated container (loopback port 18996), then patch isolated copies of both
unmodified and already-394-patched osTicket source twice and lint them. Verify
actual anonymous and staff draft uploads after deployment; never submit a real
ticket or customer reply as a smoke test.

For this upgrade, privately back up the current `ajax.draft.php` and
`scrollr-inline-image.php` as well as saved/generated Coolify compose. The
startup patch supports both original and 394-patched source and refuses unknown
anchors. Restore both code files and the prior `8.2.35-security2` image/config
to roll back this upgrade. Keep the existing audit mount and data volumes.

References: [nginx body limit](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size),
[PHP FPM admin settings](https://www.php.net/manual/en/install.fpm.configuration.php).

## Original image validation rollout (SCROLLR-394)

SCROLLR-394 adds decoded-byte validation to the existing osTicket inline-image path. PNG, JPEG, GIF and WebP screenshots are accepted only when the declared type agrees with the decoded raster, GD can decode it, size is within the configured limit and 8 MiB, and dimensions are at most 16 megapixels. SVG and non-images are rejected. The original authentication and configured smaller size limit remain in force. Filenames are normalized; ordinary non-inline attachment behavior is unchanged.

`Dockerfile.security` extends the already verified PHP 8.2.35 runtime and enables its WebP decoder. Build locally on the support host, where that base image exists:

```sh
docker build -f Dockerfile.security -t scrollr/osticket-runtime:8.2.35-security1 .
```

Before applying, copy `include/ajax.draft.php` and inspect the patch against an isolated copy. Run `inline-image.test.php` in the new runtime, patch the isolated copy twice, and lint its resulting PHP. The patch refuses unfamiliar source and is idempotent. At startup it installs the helper into the existing code volume, keeps a mode-0600 backup at `include/ajax.draft.php.before-scrollr-394`, and atomically replaces only the upload handler. The `/include` directory remains denied by nginx. No ticket rows or attachments are deleted.

Update the saved Coolify service image and generated compose together, then recreate only the osTicket service. Preserve all mounts, environment, labels and networks. Verify login, public support, authenticated read-only ticket API, installed guard, image tests and existing PHP version. Do not send real customer replies as a smoke test.

Rollback requires **both** restoring the backed-up `include/ajax.draft.php` and returning the service image to `scrollr/osticket-runtime:8.2.35`. Restore source before replacing the runtime and reload PHP-FPM/recreate the service so cached code is not retained. The helper may remain unused. Never delete the database or code volumes.

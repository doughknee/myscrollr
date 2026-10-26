# Inline image validation deployment

SCROLLR-394 adds decoded-byte validation to the existing osTicket inline-image path. PNG, JPEG, GIF and WebP screenshots are accepted only when the declared type agrees with the decoded raster, GD can decode it, size is within the configured limit and 8 MiB, and dimensions are at most 16 megapixels. SVG and non-images are rejected. The original authentication and configured smaller size limit remain in force. Filenames are normalized; ordinary non-inline attachment behavior is unchanged.

`Dockerfile.security` extends the already verified PHP 8.2.35 runtime and enables its WebP decoder. Build locally on the support host, where that base image exists:

```sh
docker build -f Dockerfile.security -t scrollr/osticket-runtime:8.2.35-security1 .
```

Before applying, copy `include/ajax.draft.php` and inspect the patch against an isolated copy. Run `inline-image.test.php` in the new runtime, patch the isolated copy twice, and lint its resulting PHP. The patch refuses unfamiliar source and is idempotent. At startup it installs the helper into the existing code volume, keeps a mode-0600 backup at `include/ajax.draft.php.before-scrollr-394`, and atomically replaces only the upload handler. The `/include` directory remains denied by nginx. No ticket rows or attachments are deleted.

Update the saved Coolify service image and generated compose together, then recreate only the osTicket service. Preserve all mounts, environment, labels and networks. Verify login, public support, authenticated read-only ticket API, installed guard, image tests and existing PHP version. Do not send real customer replies as a smoke test.

Rollback requires **both** restoring the backed-up `include/ajax.draft.php` and returning the service image to `scrollr/osticket-runtime:8.2.35`. Restore source before replacing the runtime and reload PHP-FPM/recreate the service so cached code is not retained. The helper may remain unused. Never delete the database or code volumes.

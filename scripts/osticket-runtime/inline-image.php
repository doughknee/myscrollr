<?php
// Shared inline-image boundary: validate decoded bytes, not a data URI's MIME claim.
function scrollr_validate_inline_image(&$file, $configuredMax) {
    $max = min((int)$configuredMax, 8 * 1024 * 1024);
    if ($max <= 0) return false;
    if (isset($file['data'])) {
        $data = $file['data'];
    } else {
        $path = $file['tmp_name'] ?? '';
        if (!$path || !is_file($path) || filesize($path) > $max) return false;
        $data = file_get_contents($path, false, null, 0, $max + 1);
    }
    if (!is_string($data) || strlen($data) > $max || $data === '') return false;
    $info = @getimagesizefromstring($data);
    $types = [IMAGETYPE_PNG => ['image/png','png'], IMAGETYPE_JPEG => ['image/jpeg','jpg'],
        IMAGETYPE_GIF => ['image/gif','gif'], IMAGETYPE_WEBP => ['image/webp','webp']];
    if (!$info || !isset($types[$info[2]]) || $info[0] <= 0 || $info[1] <= 0
        || $info[0] * $info[1] > 16000000) return false;
    list($mime, $extension) = $types[$info[2]];
    if (strtolower($file['type'] ?? '') !== $mime) return false;
    $image = @imagecreatefromstring($data);
    if ($image === false) return false;
    imagedestroy($image);
    $file['type'] = $mime;
    $file['size'] = strlen($data);
    // Never persist a claimed executable/active extension for an inline image.
    $file['name'] = 'image.' . $extension;
    return true;
}

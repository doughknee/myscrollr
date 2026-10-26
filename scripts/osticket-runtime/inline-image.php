<?php
// Check PHP's multipart shape before osTicket normalizes it or opens a file.
function scrollr_valid_inline_upload($upload) {
    if (!is_array($upload)) return false;
    $keys = null;
    foreach (['name', 'type', 'tmp_name', 'error', 'size'] as $field) {
        if (!isset($upload[$field]) || !is_array($upload[$field]) || count($upload[$field]) !== 1)
            return false;
        if ($keys === null) $keys = array_keys($upload[$field]);
        if (array_keys($upload[$field]) !== $keys) return false;
    }
    $key = $keys[0];
    if (!is_string($upload['name'][$key]) || !is_string($upload['type'][$key])
        || !is_string($upload['tmp_name'][$key]) || !is_int($upload['size'][$key])
        || $upload['size'][$key] <= 0 || $upload['error'][$key] !== UPLOAD_ERR_OK)
        return false;
    $path = $upload['tmp_name'][$key];
    return $path !== '' && is_uploaded_file($path) && is_readable($path);
}

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

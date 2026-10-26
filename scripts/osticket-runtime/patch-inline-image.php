<?php
$root = $argv[1] ?? '/www/osticket';
$path = $root . '/include/ajax.draft.php';
$source = file_get_contents($path);
$original = $source;
$marker = '// SCROLLR-394 decoded inline image validation';
if (strpos($source, $marker) === false) {
    $needle = "        fclose(\$fp);\n\n        // Check file type to ensure image";
    $beforeRead = "        # Allow for data-uri uploaded files\n";
    $parse = '            $file[0] = Format::parseRfc2397($data);';
    if (substr_count($source, $needle) !== 1 || substr_count($source, $beforeRead) !== 1 || substr_count($source, $parse) !== 1)
        throw new RuntimeException('Unrecognized osTicket upload source; patch refused');
    $preflight = <<<'PHP'
        // Bound the encoded upload before reading a data URI into memory.
        if (filesize($file[0]['tmp_name']) > min($cfg->getMaxFileSize() * 2, 16 * 1024 * 1024))
            return Http::response(403, JsonDataEncoder::encode(array('error' => 'Image is too large')));

PHP;
    $guard = <<<'PHP'
        fclose($fp);

        // SCROLLR-394 decoded inline image validation
        require_once INCLUDE_DIR . 'scrollr-inline-image.php';
        if (!scrollr_validate_inline_image($file[0], $cfg->getMaxFileSize()))
            return Http::response(403, JsonDataEncoder::encode(array('error' => 'Use a valid PNG, JPEG, GIF or WebP image')));

        // Check file type to ensure image
PHP;
    $source = str_replace($beforeRead, $preflight . $beforeRead, $source);
    $source = str_replace($parse, $parse . "\n" . <<<'PHP'
            if (!is_array($file[0]) || !isset($file[0]['data'], $file[0]['type'])
                || !is_string($file[0]['data']) || !is_string($file[0]['type']))
                return Http::response(403, JsonDataEncoder::encode(array('error' => 'Invalid image data')));
PHP, $source);
    $source = str_replace($needle, $guard, $source);
}

if (strpos($source, '// SCROLLR-397 multipart upload preflight') === false) {
    $normalize = "        \$file = AttachmentFile::format(\$_FILES['file']);";
    $open = "        \$fp = fopen(\$file[0]['tmp_name'], 'rb');";
    if (substr_count($source, $normalize) !== 1 || substr_count($source, $open) !== 1)
        throw new RuntimeException('Unrecognized osTicket upload source; preflight patch refused');
    $preflight = <<<'PHP'
        // SCROLLR-397 multipart upload preflight
        require_once INCLUDE_DIR . 'scrollr-inline-image.php';
        if (!scrollr_valid_inline_upload($_FILES['file'] ?? null))
            return Http::response(422, JsonDataEncoder::encode(array('error' => 'Invalid image upload')));
        $file = array_values(AttachmentFile::format($_FILES['file']));
        if (count($file) !== 1 || !empty($file[0]['error']))
            return Http::response(422, JsonDataEncoder::encode(array('error' => 'Invalid image upload')));
PHP;
    $safeOpen = <<<'PHP'
        $fp = @fopen($file[0]['tmp_name'], 'rb');
        if ($fp === false)
            return Http::response(422, JsonDataEncoder::encode(array('error' => 'Invalid image upload')));
PHP;
    $source = str_replace($normalize, $preflight, $source);
    $source = str_replace($open, $safeOpen, $source);
}

// Refresh the helper even when the handler was already patched on a prior boot.
if (!copy(__DIR__ . '/inline-image.php', $root . '/include/scrollr-inline-image.php')) throw new RuntimeException('Validator copy failed');
chmod($root . '/include/scrollr-inline-image.php', 0644);
chown($root . '/include/scrollr-inline-image.php', fileowner($path));
chgrp($root . '/include/scrollr-inline-image.php', filegroup($path));
if ($source === $original) exit(0);
$backup = $path . (strpos($original, $marker) === false ? '.before-scrollr-394' : '.before-scrollr-397');
if (!is_file($backup)) {
    if (!copy($path, $backup)) throw new RuntimeException('Backup failed');
    chmod($backup, 0600);
}
if (file_put_contents($path . '.scrollr-new', $source) === false) throw new RuntimeException('Patch write failed');
chmod($path . '.scrollr-new', fileperms($path) & 0777);
chown($path . '.scrollr-new', fileowner($path));
chgrp($path . '.scrollr-new', filegroup($path));
if (!rename($path . '.scrollr-new', $path)) throw new RuntimeException('Patch rename failed');
echo "Inline image validation installed\n";

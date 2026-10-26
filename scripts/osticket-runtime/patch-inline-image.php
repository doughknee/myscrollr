<?php
$root = $argv[1] ?? '/www/osticket';
$path = $root . '/include/ajax.draft.php';
$source = file_get_contents($path);
$marker = '// SCROLLR-394 decoded inline image validation';
if (strpos($source, $marker) !== false) {
    if (!is_file($root . '/include/scrollr-inline-image.php')) throw new RuntimeException('Missing inline image validator');
    exit(0);
}
$needle = "        fclose(\$fp);\n\n        // Check file type to ensure image";
$beforeRead = "        # Allow for data-uri uploaded files\n";
if (substr_count($source, $needle) !== 1 || substr_count($source, $beforeRead) !== 1)
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
$source = str_replace($needle, $guard, $source);
if (!copy(__DIR__ . '/inline-image.php', $root . '/include/scrollr-inline-image.php')) throw new RuntimeException('Validator copy failed');
chmod($root . '/include/scrollr-inline-image.php', 0644);
chown($root . '/include/scrollr-inline-image.php', fileowner($path));
chgrp($root . '/include/scrollr-inline-image.php', filegroup($path));
if (!is_file($path . '.before-scrollr-394')) {
    if (!copy($path, $path . '.before-scrollr-394')) throw new RuntimeException('Backup failed');
    chmod($path . '.before-scrollr-394', 0600);
}
if (file_put_contents($path . '.scrollr-new', $source) === false) throw new RuntimeException('Patch write failed');
chmod($path . '.scrollr-new', fileperms($path) & 0777);
chown($path . '.scrollr-new', fileowner($path));
chgrp($path . '.scrollr-new', filegroup($path));
if (!rename($path . '.scrollr-new', $path)) throw new RuntimeException('Patch rename failed');
echo "Inline image validation installed\n";

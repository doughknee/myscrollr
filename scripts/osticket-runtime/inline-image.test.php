<?php
require __DIR__ . '/inline-image.php';
function check($value, $message) { if (!$value) throw new RuntimeException($message); }
set_error_handler(function($severity, $message) { throw new RuntimeException($message); });
$upload = ['name'=>['test.png'], 'type'=>['image/png'], 'tmp_name'=>['/no-such-file'],
    'error'=>[UPLOAD_ERR_OK], 'size'=>[100]];
$malformed = [null, '', [], array_map(fn($value) => $value[0], $upload), $upload];
foreach (['name', 'type', 'tmp_name', 'error', 'size'] as $field) {
    $bad = $upload; unset($bad[$field]); $malformed[] = $bad;
    $bad = $upload; $bad[$field] = [['nested']]; $malformed[] = $bad;
    $bad = $upload; $bad[$field] = [1 => $upload[$field][0]]; $malformed[] = $bad;
}
foreach ([UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_PARTIAL, UPLOAD_ERR_NO_FILE, UPLOAD_ERR_NO_TMP_DIR,
    UPLOAD_ERR_CANT_WRITE, UPLOAD_ERR_EXTENSION] as $error) {
    $bad = $upload; $bad['error'] = [$error]; $malformed[] = $bad;
}
foreach ($malformed as $bad) check(!scrollr_valid_inline_upload($bad), 'Malformed multipart accepted');
restore_error_handler();
$image = imagecreatetruecolor(2, 2);
ob_start(); imagepng($image); $png = ob_get_clean(); imagedestroy($image);
$good = ['data'=>$png, 'type'=>'image/png', 'name'=>'screenshot.png'];
check(scrollr_validate_inline_image($good, 1024*1024), 'Valid screenshot rejected');
check($good['name'] === 'image.png', 'Name not normalized');
foreach (['jpeg'=>'image/jpeg','gif'=>'image/gif','webp'=>'image/webp'] as $format=>$mime) {
    $encoder='image'.$format;
    if (!function_exists($encoder)) throw new RuntimeException('Missing image codec: '.$format);
    $image=imagecreatetruecolor(2,2); ob_start(); $encoder($image); $bytes=ob_get_clean(); imagedestroy($image);
    $file=['type'=>$mime,'data'=>$bytes];
    check(scrollr_validate_inline_image($file,1024*1024),'Valid '.$format.' rejected');
}
foreach ([['image/svg+xml','<svg onload="alert(1)"></svg>'], ['image/php','<?php echo "test";'],
    ['image/png','not an image'], ['image/jpeg',$png], ['image/png',substr($png,0,20)]] as $bad) {
    $file=['type'=>$bad[0], 'data'=>$bad[1]];
    check(!scrollr_validate_inline_image($file,1024*1024), 'Invalid image accepted');
}
$large=['type'=>'image/png','data'=>$png];
check(!scrollr_validate_inline_image($large,10), 'Size limit bypass');
$temp=tempnam(sys_get_temp_dir(),'scrollr-image-'); file_put_contents($temp,$png);
$file=['type'=>'image/png','tmp_name'=>$temp];
check(scrollr_validate_inline_image($file,1024*1024), 'Multipart screenshot rejected'); unlink($temp);
echo "Inline image boundary checks passed\n";

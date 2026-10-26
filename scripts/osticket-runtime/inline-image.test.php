<?php
require __DIR__ . '/inline-image.php';
function check($value, $message) { if (!$value) throw new RuntimeException($message); }
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

<?php
// MTG Event API — single entry point. Every request under /api/ lands here.
declare(strict_types=1);

require __DIR__ . '/lib/util.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/handlers.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
// The website is served from the same domain; the phone app doesn't need CORS.
// Public read endpoints are allowed cross-origin so other league pages can embed them.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }

// path relative to /api/, e.g. "leagues/abc/sync"
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php')), '/');
if ($base !== '' && str_starts_with($path, $base)) $path = substr($path, strlen($base));
$path = trim($path, '/');
if ($path === 'index.php') $path = '';

$routes = [
    ['GET',    '#^$#',                                   fn() => ['name' => 'MTG Event API', 'ok' => true]],
    ['GET',    '#^health$#',                             fn() => ['ok' => true, 'db' => (bool) db()->query('SELECT 1')->fetchColumn()]],
    ['POST',   '#^auth/register$#',                      fn() => h_register()],
    ['POST',   '#^auth/login$#',                         fn() => h_login()],
    ['POST',   '#^auth/logout$#',                        fn() => h_logout()],
    ['GET',    '#^me$#',                                 fn() => h_me()],
    ['POST',   '#^account/delete$#',                     fn() => h_delete_account()],
    ['POST',   '#^leagues$#',                            fn() => h_create_league()],
    ['PATCH',  '#^leagues/([^/]+)$#',                    fn($id) => h_update_league($id)],
    ['GET',    '#^leagues/([^/]+)/members$#',            fn($id) => h_members($id)],
    ['DELETE', '#^leagues/([^/]+)/members/([^/]+)$#',    fn($id, $uid) => h_remove_member($id, $uid)],
    ['POST',   '#^leagues/([^/]+)/invites$#',            fn($id) => h_create_invite($id)],
    ['POST',   '#^invites/([^/]+)/accept$#',             fn($code) => h_accept_invite($code)],
    ['POST',   '#^leagues/([^/]+)/sync$#',               fn($id) => h_sync($id)],
    ['POST',   '#^leagues/([^/]+)/events/([^/]+)/claim$#',   fn($id, $ev) => h_claim_event($id, $ev)],
    ['POST',   '#^leagues/([^/]+)/events/([^/]+)/release$#', fn($id, $ev) => h_release_event($id, $ev)],
    ['GET',    '#^public/([^/]+)$#',                     fn($slug) => h_public($slug)],
];

try {
    $pathMatched = false;
    foreach ($routes as [$m, $re, $fn]) {
        if (!preg_match($re, $path, $args)) continue;
        $pathMatched = true;
        if ($m !== $method) continue;
        array_shift($args);
        send_json(200, $fn(...array_map('urldecode', $args)));
        exit;
    }
    throw $pathMatched ? new HttpError(405, 'Method not allowed', 'method') : new HttpError(404, 'Not found', 'not_found');
} catch (HttpError $e) {
    send_json($e->status, ['error' => $e->getMessage(), 'code' => $e->errCode]);
} catch (Throwable $e) {
    error_log('[mtg-api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    send_json(500, ['error' => 'Something went wrong on the server', 'code' => 'server_error']);
}

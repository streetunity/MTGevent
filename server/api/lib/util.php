<?php
declare(strict_types=1);

final class HttpError extends Exception
{
    public function __construct(public int $status, string $message, public string $errCode = 'error')
    {
        parent::__construct($message);
    }
}

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function uuid4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
}

function send_json(int $status, $data): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    $hasCache = false;
    foreach (headers_list() as $h) if (stripos($h, 'Cache-Control:') === 0) $hasCache = true;
    if (!$hasCache) header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Decoded JSON request body (max 8 MB). */
function body(): array
{
    static $cached = null;
    if ($cached !== null) return $cached;
    $raw = file_get_contents('php://input', false, null, 0, 8 * 1024 * 1024 + 1);
    if ($raw === false || $raw === '') return $cached = [];
    if (strlen($raw) > 8 * 1024 * 1024) throw new HttpError(413, 'Request too large', 'too_large');
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new HttpError(400, 'Body must be a JSON object', 'bad_json');
    return $cached = $data;
}

function str_field(array $a, string $key, int $min = 1, int $max = 200): string
{
    $v = $a[$key] ?? null;
    if (!is_string($v)) throw new HttpError(422, "$key is required", 'validation');
    $v = trim($v);
    $len = mb_strlen($v);
    if ($len < $min || $len > $max) throw new HttpError(422, "$key must be $min-$max characters", 'validation');
    return $v;
}

function int_field(array $a, string $key, ?int $default = null): int
{
    $v = $a[$key] ?? $default;
    if (is_float($v) && floor($v) == $v) $v = (int) $v;
    if (!is_int($v)) throw new HttpError(422, "$key must be a whole number", 'validation');
    return $v;
}

function valid_id($v): bool
{
    return is_string($v) && preg_match('/^[A-Za-z0-9_-]{6,36}$/', $v) === 1;
}

function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 64);
}

<?php
declare(strict_types=1);

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

function rate_limit_check(): void
{
    $since = now_ms() - LOGIN_WINDOW_MS;
    $n = (int) q('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND created_at > ?', [client_ip(), $since])->fetchColumn();
    if ($n >= LOGIN_MAX_FAILS) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.', 'rate_limited');
}

function rate_limit_fail(): void
{
    q('INSERT INTO login_attempts (ip, created_at) VALUES (?, ?)', [client_ip(), now_ms()]);
    // housekeeping
    q('DELETE FROM login_attempts WHERE created_at < ?', [now_ms() - 24 * 3600 * 1000]);
}

function new_session(string $userId, string $deviceName): string
{
    $token = bin2hex(random_bytes(32));
    $t = now_ms();
    q('INSERT INTO sessions (token_hash, user_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)',
        [hash('sha256', $token), $userId, mb_substr($deviceName, 0, 100), $t, $t]);
    return $token;
}

function bearer_token(): ?string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strcasecmp($k, 'Authorization') === 0) $h = $v;
    }
    if (preg_match('/^Bearer\s+([a-f0-9]{64})$/i', trim($h), $m)) return strtolower($m[1]);
    return null;
}

/** The signed-in user, or 401. */
function require_user(): array
{
    $token = bearer_token();
    if (!$token) throw new HttpError(401, 'Sign in required', 'unauthorized');
    $hash = hash('sha256', $token);
    $row = one('SELECT u.id, u.email, u.name, s.device_name, s.last_used_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [$hash]);
    if (!$row) throw new HttpError(401, 'Session expired. Please sign in again.', 'unauthorized');
    if (now_ms() - (int) $row['last_used_at'] > 60_000) {
        q('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?', [now_ms(), $hash]);
    }
    $row['token_hash'] = $hash;
    return $row;
}

/** Membership role in a league, or 403/404. */
function require_member(array $user, string $leagueId, bool $ownerOnly = false): string
{
    if (!valid_id($leagueId)) throw new HttpError(404, 'League not found', 'not_found');
    $m = one('SELECT role FROM memberships WHERE league_id = ? AND user_id = ?', [$leagueId, $user['id']]);
    if (!$m) throw new HttpError(403, 'You are not an organizer of this league', 'forbidden');
    if ($ownerOnly && $m['role'] !== 'owner') throw new HttpError(403, 'Only the league owner can do that', 'forbidden');
    return $m['role'];
}

<?php
declare(strict_types=1);

// ───────────────────────── accounts ─────────────────────────

function h_register(): array
{
    rate_limit_check();
    $b = body();
    if (!(load_config()['allow_signup'] ?? true)) {
        // open signup is off: only people holding a live invite code can make an account
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) ($b['invite'] ?? '')));
        $inv = $code === '' ? null : one('SELECT code FROM invites WHERE code = ? AND expires_at > ? AND uses_left > 0', [$code, now_ms()]);
        if (!$inv) {
            rate_limit_fail();
            throw new HttpError(403, 'New accounts need an invite code from the league owner', 'signup_disabled');
        }
    }
    $email = strtolower(str_field($b, 'email', 3, 190));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new HttpError(422, 'That email address doesn’t look right', 'validation');
    $name = str_field($b, 'name', 1, 100);
    $password = (string) ($b['password'] ?? '');
    if (strlen($password) < 8) throw new HttpError(422, 'Password must be at least 8 characters', 'validation');
    if (one('SELECT id FROM users WHERE email = ?', [$email])) {
        rate_limit_fail();
        throw new HttpError(409, 'An account with that email already exists', 'email_taken');
    }
    $id = uuid4();
    q('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [$id, $email, $name, password_hash($password, PASSWORD_DEFAULT), now_ms()]);
    $token = new_session($id, (string) ($b['deviceName'] ?? ''));
    return ['token' => $token, 'user' => ['id' => $id, 'email' => $email, 'name' => $name], 'leagues' => []];
}

function h_login(): array
{
    rate_limit_check();
    $b = body();
    $email = strtolower(trim((string) ($b['email'] ?? '')));
    $password = (string) ($b['password'] ?? '');
    $u = one('SELECT id, email, name, password_hash FROM users WHERE email = ?', [$email]);
    if (!$u || !password_verify($password, $u['password_hash'])) {
        rate_limit_fail();
        throw new HttpError(401, 'Wrong email or password', 'bad_credentials');
    }
    if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $u['id']]);
    }
    $token = new_session($u['id'], (string) ($b['deviceName'] ?? ''));
    return ['token' => $token, 'user' => ['id' => $u['id'], 'email' => $u['email'], 'name' => $u['name']], 'leagues' => my_leagues($u['id'])];
}

function h_logout(): array
{
    $u = require_user();
    q('DELETE FROM sessions WHERE token_hash = ?', [$u['token_hash']]);
    return ['ok' => true];
}

function my_leagues(string $userId): array
{
    return q('SELECT l.id, l.slug, l.name, l.is_public AS isPublic, m.role FROM memberships m JOIN leagues l ON l.id = m.league_id WHERE m.user_id = ? ORDER BY l.name', [$userId])
        ->fetchAll();
}

function h_me(): array
{
    $u = require_user();
    return ['user' => ['id' => $u['id'], 'email' => $u['email'], 'name' => $u['name']], 'leagues' => array_map(fn($l) => [...$l, 'isPublic' => (bool) $l['isPublic']], my_leagues($u['id']))];
}

/**
 * Delete the signed-in account (app), or an account by email + password (web page).
 * The password is always required. Leagues the user owns pass to their longest-standing
 * organizer; a league with no other organizers is deleted along with all its data.
 */
function h_delete_account(): array
{
    rate_limit_check();
    $b = body();
    $password = (string) ($b['password'] ?? '');
    $token = bearer_token();
    if ($token) {
        $u = require_user();
        $row = one('SELECT id, password_hash FROM users WHERE id = ?', [$u['id']]);
    } else {
        $row = one('SELECT id, password_hash FROM users WHERE email = ?', [strtolower(trim((string) ($b['email'] ?? '')))]);
    }
    if (!$row || !password_verify($password, $row['password_hash'])) {
        rate_limit_fail();
        throw new HttpError(401, 'Wrong email or password', 'bad_credentials');
    }
    $uid = $row['id'];
    $deleted = [];
    $transferred = [];

    db()->beginTransaction();
    try {
        foreach (q("SELECT l.id, l.name FROM memberships m JOIN leagues l ON l.id = m.league_id WHERE m.user_id = ? AND m.role = 'owner' FOR UPDATE", [$uid])->fetchAll() as $l) {
            $heir = one("SELECT m.user_id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.league_id = ? AND m.user_id <> ? ORDER BY m.created_at, m.user_id LIMIT 1", [$l['id'], $uid]);
            if ($heir) {
                q("UPDATE memberships SET role = 'owner' WHERE league_id = ? AND user_id = ?", [$l['id'], $heir['user_id']]);
                q('UPDATE leagues SET created_by = ? WHERE id = ?', [$heir['user_id'], $l['id']]);
                $transferred[] = ['name' => $l['name'], 'to' => $heir['name']];
            } else {
                foreach (['players', 'events', 'deletions', 'league_settings', 'invites', 'memberships'] as $t) {
                    q("DELETE FROM $t WHERE league_id = ?", [$l['id']]);
                }
                q('DELETE FROM leagues WHERE id = ?', [$l['id']]);
                $deleted[] = $l['name'];
            }
        }
        // leagues the user created but no longer owns: point at the current owner
        q("UPDATE leagues l JOIN memberships m ON m.league_id = l.id AND m.role = 'owner' SET l.created_by = m.user_id WHERE l.created_by = ?", [$uid]);
        q('DELETE FROM invites WHERE created_by = ?', [$uid]);
        q('DELETE FROM memberships WHERE user_id = ?', [$uid]);
        q('DELETE FROM sessions WHERE user_id = ?', [$uid]);
        q('DELETE FROM users WHERE id = ?', [$uid]);
        db()->commit();
    } catch (Throwable $t) {
        if (db()->inTransaction()) db()->rollBack();
        throw $t;
    }
    return ['ok' => true, 'leaguesDeleted' => $deleted, 'leaguesTransferred' => $transferred];
}

// ───────────────────────── leagues & invites ─────────────────────────

/** League web addresses that would clash with pages on the site. */
const RESERVED_SLUGS = ['api', 'admin', 'www', 'assets', 'static', 'public', 'login', 'privacy', 'delete-account', 'app', 'fonts', 'help', 'about', 'terms'];

function slugify(string $s): string
{
    $s = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $s), '-'));
    return substr($s, 0, 60);
}

function h_create_league(): array
{
    $u = require_user();
    $b = body();
    $name = str_field($b, 'name', 2, 120);
    $slug = slugify((string) ($b['slug'] ?? $name));
    if (strlen($slug) < 3) throw new HttpError(422, 'Choose a web address of at least 3 letters/numbers', 'validation');
    if (in_array($slug, RESERVED_SLUGS, true)) throw new HttpError(409, 'That web address is reserved', 'slug_taken');
    if (one('SELECT id FROM leagues WHERE slug = ?', [$slug])) throw new HttpError(409, 'That web address is already taken', 'slug_taken');
    $id = uuid4();
    $t = now_ms();
    db()->beginTransaction();
    q('INSERT INTO leagues (id, slug, name, is_public, seq, created_by, created_at) VALUES (?, ?, ?, 1, 0, ?, ?)', [$id, $slug, $name, $u['id'], $t]);
    q('INSERT INTO memberships (league_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', [$id, $u['id'], 'owner', $t]);
    db()->commit();
    return ['league' => ['id' => $id, 'slug' => $slug, 'name' => $name, 'isPublic' => true, 'role' => 'owner']];
}

function h_update_league(string $leagueId): array
{
    $u = require_user();
    require_member($u, $leagueId, true);
    $b = body();
    if (array_key_exists('name', $b)) q('UPDATE leagues SET name = ? WHERE id = ?', [str_field($b, 'name', 2, 120), $leagueId]);
    if (array_key_exists('isPublic', $b)) q('UPDATE leagues SET is_public = ? WHERE id = ?', [$b['isPublic'] ? 1 : 0, $leagueId]);
    $l = one('SELECT id, slug, name, is_public AS isPublic FROM leagues WHERE id = ?', [$leagueId]);
    $l['isPublic'] = (bool) $l['isPublic'];
    return ['league' => $l];
}

function h_members(string $leagueId): array
{
    $u = require_user();
    require_member($u, $leagueId);
    return ['members' => q('SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.league_id = ? ORDER BY m.role DESC, u.name', [$leagueId])->fetchAll()];
}

function h_remove_member(string $leagueId, string $userId): array
{
    $u = require_user();
    $role = require_member($u, $leagueId);
    // owners can remove anyone except themselves; organizers can only leave
    if ($userId !== $u['id'] && $role !== 'owner') throw new HttpError(403, 'Only the league owner can remove organizers', 'forbidden');
    $target = one('SELECT role FROM memberships WHERE league_id = ? AND user_id = ?', [$leagueId, $userId]);
    if (!$target) throw new HttpError(404, 'Not a member', 'not_found');
    if ($target['role'] === 'owner') throw new HttpError(409, 'The owner can’t be removed', 'owner');
    q('DELETE FROM memberships WHERE league_id = ? AND user_id = ?', [$leagueId, $userId]);
    return ['ok' => true];
}

function h_create_invite(string $leagueId): array
{
    $u = require_user();
    require_member($u, $leagueId, true);
    $b = body();
    $days = max(1, min(30, (int) ($b['days'] ?? 7)));
    $uses = max(1, min(50, (int) ($b['uses'] ?? 5)));
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
    do {
        $code = '';
        for ($i = 0; $i < 8; $i++) $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    } while (one('SELECT code FROM invites WHERE code = ?', [$code]));
    $t = now_ms();
    q('INSERT INTO invites (code, league_id, role, created_by, created_at, expires_at, uses_left) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$code, $leagueId, 'organizer', $u['id'], $t, $t + $days * 86_400_000, $uses]);
    return ['invite' => ['code' => $code, 'expiresAt' => $t + $days * 86_400_000, 'usesLeft' => $uses]];
}

function h_accept_invite(string $code): array
{
    $u = require_user();
    rate_limit_check();
    $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code));
    db()->beginTransaction();
    $inv = one('SELECT * FROM invites WHERE code = ? FOR UPDATE', [$code]);
    if (!$inv || (int) $inv['expires_at'] < now_ms() || (int) $inv['uses_left'] < 1) {
        db()->rollBack();
        rate_limit_fail();
        throw new HttpError(404, 'That invite code is invalid or has expired', 'bad_invite');
    }
    if (!one('SELECT role FROM memberships WHERE league_id = ? AND user_id = ?', [$inv['league_id'], $u['id']])) {
        q('INSERT INTO memberships (league_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', [$inv['league_id'], $u['id'], $inv['role'], now_ms()]);
        q('UPDATE invites SET uses_left = uses_left - 1 WHERE code = ?', [$code]);
    }
    db()->commit();
    $l = one('SELECT l.id, l.slug, l.name, l.is_public AS isPublic, m.role FROM leagues l JOIN memberships m ON m.league_id = l.id AND m.user_id = ? WHERE l.id = ?', [$u['id'], $inv['league_id']]);
    $l['isPublic'] = (bool) $l['isPublic'];
    return ['league' => $l];
}

// ───────────────────────── sync ─────────────────────────

/**
 * Two-way sync. The phone sends everything it changed since its last sync
 * and the server cursor it last saw; it gets back everything that changed on
 * the server after that cursor, plus the new cursor.
 *
 * Conflicts: newest updatedAt wins per document. Deletions win over older edits;
 * an edit made after the deletion brings the document back.
 */
function h_sync(string $leagueId): array
{
    $u = require_user();
    require_member($u, $leagueId);
    $b = body();
    $cursor = max(0, (int) ($b['cursor'] ?? 0));
    $rejected = [];

    db()->beginTransaction();
    try {
        // lock the league row so sequence numbers are handed out one at a time
        q('SELECT seq FROM leagues WHERE id = ? FOR UPDATE', [$leagueId]);

        foreach (($b['deletions'] ?? []) as $d) {
            $kind = $d['kind'] ?? '';
            $id = $d['id'] ?? '';
            $at = (int) ($d['deletedAt'] ?? 0);
            if (!in_array($kind, ['event', 'player'], true) || !valid_id($id) || $at <= 0) { $rejected[] = ['kind' => 'deletion', 'id' => $id, 'reason' => 'invalid']; continue; }
            $table = $kind === 'event' ? 'events' : 'players';
            $doc = one("SELECT updated_at FROM $table WHERE league_id = ? AND id = ?", [$leagueId, $id]);
            if ($doc && (int) $doc['updated_at'] > $at) { $rejected[] = ['kind' => 'deletion', 'id' => $id, 'reason' => 'edited_after_delete']; continue; }
            $seq = next_seq($leagueId);
            q("DELETE FROM $table WHERE league_id = ? AND id = ?", [$leagueId, $id]);
            q('INSERT INTO deletions (league_id, kind, id, deleted_at, seq) VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE deleted_at = GREATEST(deleted_at, VALUES(deleted_at)), seq = VALUES(seq)',
               [$leagueId, $kind, $id, $at, $seq]);
        }

        foreach (($b['players'] ?? []) as $p) {
            $id = $p['id'] ?? '';
            $name = is_string($p['name'] ?? null) ? trim($p['name']) : '';
            $upd = (int) ($p['updatedAt'] ?? 0);
            if (!valid_id($id) || $name === '' || mb_strlen($name) > 120 || $upd <= 0) { $rejected[] = ['kind' => 'player', 'id' => $id, 'reason' => 'invalid']; continue; }
            if (!accept_write($leagueId, 'players', 'player', $id, $upd)) { $rejected[] = ['kind' => 'player', 'id' => $id, 'reason' => 'stale']; continue; }
            $legacy = isset($p['legacy']) && is_array($p['legacy']) ? json_encode($p['legacy']) : null;
            $seq = next_seq($leagueId);
            q('INSERT INTO players (league_id, id, name, legacy, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE name = VALUES(name), legacy = VALUES(legacy), updated_at = VALUES(updated_at), seq = VALUES(seq)',
               [$leagueId, $id, $name, $legacy, (int) ($p['createdAt'] ?? $upd), $upd, $seq]);
        }

        foreach (($b['events'] ?? []) as $e) {
            $id = $e['id'] ?? '';
            $upd = (int) ($e['updatedAt'] ?? 0);
            $status = $e['status'] ?? '';
            if (!valid_id($id) || $upd <= 0 || !in_array($status, ['setup', 'running', 'complete'], true)) { $rejected[] = ['kind' => 'event', 'id' => $id, 'reason' => 'invalid']; continue; }
            $data = json_encode($e, JSON_UNESCAPED_UNICODE);
            if ($data === false || strlen($data) > 2_000_000) { $rejected[] = ['kind' => 'event', 'id' => $id, 'reason' => 'too_large']; continue; }
            if (!accept_write($leagueId, 'events', 'event', $id, $upd)) { $rejected[] = ['kind' => 'event', 'id' => $id, 'reason' => 'stale']; continue; }
            $seq = next_seq($leagueId);
            q('INSERT INTO events (league_id, id, status, date, data, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE status = VALUES(status), date = VALUES(date), data = VALUES(data), updated_at = VALUES(updated_at), seq = VALUES(seq)',
               [$leagueId, $id, $status, (int) ($e['date'] ?? $upd), $data, $upd, $seq]);
        }

        foreach (($b['settings'] ?? []) as $s) {
            $name = $s['name'] ?? '';
            $upd = (int) ($s['updatedAt'] ?? 0);
            if (!in_array($name, ['seasons'], true) || $upd <= 0 || !array_key_exists('value', $s)) { $rejected[] = ['kind' => 'setting', 'id' => $name, 'reason' => 'invalid']; continue; }
            $cur = one('SELECT updated_at FROM league_settings WHERE league_id = ? AND name = ?', [$leagueId, $name]);
            if ($cur && (int) $cur['updated_at'] > $upd) { $rejected[] = ['kind' => 'setting', 'id' => $name, 'reason' => 'stale']; continue; }
            $seq = next_seq($leagueId);
            q('INSERT INTO league_settings (league_id, name, value, updated_at, seq) VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at), seq = VALUES(seq)',
               [$leagueId, $name, json_encode($s['value']), $upd, $seq]);
        }

        db()->commit();
    } catch (Throwable $t) {
        if (db()->inTransaction()) db()->rollBack();
        throw $t;
    }

    $changes = changes_since($leagueId, $cursor, true);
    return [...$changes, 'rejected' => $rejected];
}

/** Newest write wins; deletions block older writes; a newer write clears the deletion. */
function accept_write(string $leagueId, string $table, string $kind, string $id, int $updatedAt): bool
{
    $cur = one("SELECT updated_at FROM $table WHERE league_id = ? AND id = ?", [$leagueId, $id]);
    if ($cur && (int) $cur['updated_at'] > $updatedAt) return false;
    $del = one('SELECT deleted_at FROM deletions WHERE league_id = ? AND kind = ? AND id = ?', [$leagueId, $kind, $id]);
    if ($del) {
        if ((int) $del['deleted_at'] >= $updatedAt) return false;
        q('DELETE FROM deletions WHERE league_id = ? AND kind = ? AND id = ?', [$leagueId, $kind, $id]);
    }
    return true;
}

function changes_since(string $leagueId, int $since, bool $includeSetup): array
{
    $seq = (int) q('SELECT seq FROM leagues WHERE id = ?', [$leagueId])->fetchColumn();
    $players = array_map(fn($r) => [
        'id' => $r['id'], 'name' => $r['name'],
        'legacy' => $r['legacy'] !== null ? json_decode($r['legacy'], true) : null,
        'createdAt' => (int) $r['created_at'], 'updatedAt' => (int) $r['updated_at'],
    ], q('SELECT id, name, legacy, created_at, updated_at FROM players WHERE league_id = ? AND seq > ? ORDER BY seq', [$leagueId, $since])->fetchAll());
    $evSql = 'SELECT data FROM events WHERE league_id = ? AND seq > ?' . ($includeSetup ? '' : " AND status <> 'setup'") . ' ORDER BY seq';
    $events = array_map(fn($r) => json_decode($r['data'], true), q($evSql, [$leagueId, $since])->fetchAll());
    $deletions = array_map(fn($r) => ['kind' => $r['kind'], 'id' => $r['id'], 'deletedAt' => (int) $r['deleted_at']],
        q('SELECT kind, id, deleted_at FROM deletions WHERE league_id = ? AND seq > ? ORDER BY seq', [$leagueId, $since])->fetchAll());
    $settings = array_map(fn($r) => ['name' => $r['name'], 'value' => json_decode($r['value'], true), 'updatedAt' => (int) $r['updated_at']],
        q('SELECT name, value, updated_at FROM league_settings WHERE league_id = ? AND seq > ? ORDER BY seq', [$leagueId, $since])->fetchAll());
    return ['cursor' => $seq, 'players' => $players, 'events' => $events, 'deletions' => $deletions, 'settings' => $settings];
}

// ───────────────────────── event hand-off ─────────────────────────

/** Mark which phone is running an event. Another phone must pass force=true to take over. */
function h_claim_event(string $leagueId, string $eventId): array
{
    $u = require_user();
    require_member($u, $leagueId);
    if (!valid_id($eventId)) throw new HttpError(404, 'Event not found', 'not_found');
    $b = body();
    $device = mb_substr(trim((string) ($b['device'] ?? '')), 0, 100);
    if ($device === '') throw new HttpError(422, 'device is required', 'validation');
    $ev = one('SELECT runner_device FROM events WHERE league_id = ? AND id = ?', [$leagueId, $eventId]);
    if (!$ev) throw new HttpError(404, 'Event not found on the server yet — sync first', 'not_found');
    $runner = $ev['runner_device'];
    if ($runner && $runner !== $device && empty($b['force'])) {
        return ['claimed' => false, 'runner' => $runner];
    }
    q('UPDATE events SET runner_device = ? WHERE league_id = ? AND id = ?', [$device, $leagueId, $eventId]);
    return ['claimed' => true, 'runner' => $device];
}

function h_release_event(string $leagueId, string $eventId): array
{
    $u = require_user();
    require_member($u, $leagueId);
    $device = mb_substr(trim((string) (body()['device'] ?? '')), 0, 100);
    q('UPDATE events SET runner_device = NULL WHERE league_id = ? AND id = ? AND runner_device = ?', [$leagueId, $eventId, $device]);
    return ['ok' => true];
}

// ───────────────────────── public (website) ─────────────────────────

function public_league(string $slug): array
{
    $l = one('SELECT id, slug, name FROM leagues WHERE slug = ? AND is_public = 1', [slugify($slug)]);
    if (!$l) throw new HttpError(404, 'League not found', 'not_found');
    return $l;
}

/** Everything the website needs (setup-stage events hidden). Use ?since=N to get only changes. */
function h_public(string $slug): array
{
    $l = public_league($slug);
    $since = max(0, (int) ($_GET['since'] ?? 0));
    header('Cache-Control: public, max-age=5');
    return ['league' => ['slug' => $l['slug'], 'name' => $l['name']], ...changes_since($l['id'], $since, false)];
}

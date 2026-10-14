<?php
declare(strict_types=1);

function load_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    // 1) explicit env var (used for local testing)
    // 2) ~/mtg-config.php two levels above public_html/<site>/api
    $candidates = array_filter([
        getenv('MTG_CONFIG') ?: null,
        dirname(__DIR__, 4) . '/mtg-config.php',
    ]);
    foreach ($candidates as $path) {
        if (is_file($path)) {
            $loaded = require $path;
            if (is_array($loaded)) return $cfg = $loaded;
        }
    }
    throw new HttpError(500, 'Server is not configured yet (mtg-config.php missing)', 'not_configured');
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = load_config();
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $c['db_host'] ?? 'localhost', $c['db_name']);
    $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function one(string $sql, array $params = []): ?array
{
    $row = q($sql, $params)->fetch();
    return $row === false ? null : $row;
}

/** Bump and return the league's change counter (row-locked inside a transaction). */
function next_seq(string $leagueId): int
{
    q('UPDATE leagues SET seq = LAST_INSERT_ID(seq + 1) WHERE id = ?', [$leagueId]);
    return (int) db()->query('SELECT LAST_INSERT_ID()')->fetchColumn();
}

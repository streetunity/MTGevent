# MTG Event server (self-hosted)

Plain PHP 8 + MySQL. No frameworks, no Node — runs on ordinary cPanel hosting.

```
server/
  schema.sql              database tables (import once in phpMyAdmin)
  mtg-config.sample.php   copy to ~/mtg-config.php (outside public_html) and fill in
  api/                    upload to public_html/<site>/api/
  tests/e2e.py            end-to-end test (throwaway data)
```

## Deploy (GoDaddy cPanel)

1. **Database** — cPanel → MySQL Databases: create a database and a user, add the user to the database with ALL PRIVILEGES.
2. **Tables** — cPanel → phpMyAdmin → pick the database → Import → `schema.sql`.
3. **Config** — copy `mtg-config.sample.php` to `/home/<cpanel-user>/mtg-config.php` (home folder, *not* inside public_html) and fill in the prefixed database name, user and password. Set `allow_signup` to `false` once your own account exists — after that, only people holding an invite code can sign up.
4. **Code** — upload the `api/` folder to `public_html/mtg-event.com/api/` (keep both `.htaccess` files).
5. **Check** — open `https://mtg-event.com/api/health` → `{"ok":true,"db":true}`.

The API finds the config two folders above `public_html/<site>/`, or at the path in the `MTG_CONFIG` environment variable.

## Run locally

```
mysql -u root -e "CREATE DATABASE mtgevent_test"; mysql mtgevent_test < server/schema.sql
MTG_CONFIG=/path/to/test-config.php php -S 127.0.0.1:8080 router.php   # router sets SCRIPT_NAME=/api/index.php and requires api/index.php
python3 server/tests/e2e.py
```

## API summary

| Method | Path | Who |
|---|---|---|
| POST | auth/register, auth/login, auth/logout | anyone / signed in |
| GET | me | signed in |
| POST | leagues | signed in (becomes owner) |
| PATCH | leagues/{id} | owner (name, isPublic) |
| GET / DELETE | leagues/{id}/members[/{userId}] | member / owner |
| POST | leagues/{id}/invites | owner → 8-letter code |
| POST | invites/{code}/accept | signed in |
| POST | leagues/{id}/sync | member — push changes + cursor, get changes back |
| POST | leagues/{id}/events/{ev}/claim, /release | member — which phone runs an event |
| GET | public/{slug}?since=N | anyone — feed for the website |

Sync rules: newest `updatedAt` wins per player/event; a deletion beats older edits; an edit made after a deletion brings the item back. Each change gets a per-league sequence number, so clients only download what changed since their last cursor.

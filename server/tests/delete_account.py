# Account deletion test. Creates throwaway accounts/leagues.
# Usage: python3 server/tests/delete_account.py [http://127.0.0.1:8080/api/]
import json, sys, time, urllib.request
B = (sys.argv[1].rstrip('/') + '/') if len(sys.argv) > 1 else 'http://127.0.0.1:8080/api/'
fails = 0

def call(m, path, body=None, tok=None):
    req = urllib.request.Request(B + path, method=m, data=json.dumps(body).encode() if body is not None else None)
    req.add_header('Content-Type', 'application/json')
    if tok: req.add_header('Authorization', 'Bearer ' + tok)
    try:
        r = urllib.request.urlopen(req); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def check(name, cond, extra=''):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name, '' if cond else extra)
    if not cond: fails += 1

t = str(int(time.time() * 1000))
_, a = call('POST', 'auth/register', {'email': f'owner{t}@x.com', 'name': 'Owner', 'password': 'goodpassword'}); A = a['token']
_, c = call('POST', 'auth/register', {'email': f'cohost{t}@x.com', 'name': 'Cohost', 'password': 'goodpassword'}); C = c['token']
_, l1 = call('POST', 'leagues', {'name': f'Shared {t}'}, tok=A); L1 = l1['league']
_, l2 = call('POST', 'leagues', {'name': f'Solo {t}'}, tok=A); L2 = l2['league']
_, inv = call('POST', f"leagues/{L1['id']}/invites", {}, tok=A)
call('POST', f"invites/{inv['invite']['code']}/accept", {}, tok=C)
call('POST', f"leagues/{L2['id']}/sync", {'cursor': 0, 'players': [{'id': 'player-solo1', 'name': 'Zed', 'updatedAt': 1}]}, tok=A)

s, r = call('POST', 'leagues', {'name': 'privacy'}, tok=A); check('reserved slug "privacy" refused', s == 409, r)
s, r = call('POST', 'account/delete', {'password': 'wrong'}, tok=A); check('wrong password refused', s == 401, r)
s, r = call('POST', 'account/delete', {}, tok=A); check('missing password refused', s == 401, r)
s, r = call('POST', 'account/delete', {'password': 'goodpassword'}, tok=A)
check('owner deleted', s == 200 and r['ok'], r)
check('shared league passed to co-host', r.get('leaguesTransferred') == [{'name': f'Shared {t}', 'to': 'Cohost'}], r)
check('solo league deleted', r.get('leaguesDeleted') == [f'Solo {t}'], r)
s, r = call('GET', 'me', tok=A); check('old token dead', s == 401, r)
s, r = call('POST', 'auth/login', {'email': f'owner{t}@x.com', 'password': 'goodpassword'}); check('cannot log in again', s == 401, r)
s, r = call('GET', 'me', tok=C); check('co-host now owner', s == 200 and r['leagues'][0]['role'] == 'owner', r)
s, r = call('POST', f"leagues/{L1['id']}/invites", {}, tok=C); check('new owner can invite', s == 200, r)
s, r = call('GET', f"public/{L2['slug']}"); check('solo league page gone', s == 404, r)
s, r = call('GET', f"public/{L1['slug']}"); check('shared league page still up', s == 200, r)
# web page route: email + password, no app token
s, r = call('POST', 'account/delete', {'email': f'COHOST{t}@x.com', 'password': 'nope'}); check('web delete wrong password', s == 401, r)
s, r = call('POST', 'account/delete', {'email': f'COHOST{t}@x.com', 'password': 'goodpassword'})
check('web delete works (last owner → league deleted)', s == 200 and r['leaguesDeleted'] == [f'Shared {t}'], r)
s, r = call('GET', f"public/{L1['slug']}"); check('league gone after last member left', s == 404, r)
print('FAILS', fails)

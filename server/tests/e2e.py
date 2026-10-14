# End-to-end API test. Creates throwaway accounts/leagues.
# Usage: python3 server/tests/e2e.py [http://127.0.0.1:8080/api/]
import json, urllib.request, time
import sys
B=(sys.argv[1].rstrip('/')+'/') if len(sys.argv)>1 else 'http://127.0.0.1:8080/api/'
fails=0
def call(m, path, body=None, tok=None):
    req=urllib.request.Request(B+path, method=m, data=json.dumps(body).encode() if body is not None else None)
    req.add_header('Content-Type','application/json')
    if tok: req.add_header('Authorization','Bearer '+tok)
    try:
        r=urllib.request.urlopen(req); return r.status, json.loads(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read()), dict(e.headers)
def check(name, cond, extra=''):
    global fails
    print(('PASS ' if cond else 'FAIL ')+name, '' if cond else extra)
    if not cond: fails+=1
t=int(time.time()*1000); sfx=str(t)
s,r,_=call('POST','auth/register',{'email':f'brian{sfx}@x.com','name':'Brian','password':'short'}); check('short pw rejected', s==422, r)
s,r,_=call('POST','auth/register',{'email':f'brian{sfx}@x.com','name':'Brian','password':'goodpassword','deviceName':'Pixel'}); check('register', s==200 and len(r['token'])==64, r); A=r['token']
s,r,_=call('POST','auth/register',{'email':f'BRIAN{sfx}@x.com','name':'B2','password':'goodpassword'}); check('dup email', s==409, r)
s,r,_=call('POST','auth/login',{'email':f'brian{sfx}@x.com','password':'wrong'}); check('bad login', s==401, r)
s,r,_=call('POST','auth/login',{'email':f'Brian{sfx}@x.com','password':'goodpassword'}); check('login', s==200, r)
s,r,_=call('GET','me',tok=A); check('me', s==200 and r['user']['name']=='Brian', r)
s,r,_=call('GET','me'); check('me no token 401', s==401, r)
s,r,_=call('POST','leagues',{'name':f'Bar League {sfx}'},tok=A); check('create league', s==200 and r['league']['role']=='owner', r); L=r['league']['id']; slug=r['league']['slug']
s,r,_=call('POST','leagues',{'name':f'Bar League {sfx}'},tok=A); check('slug taken', s==409, r)
s,r,_=call('POST','auth/register',{'email':f'cohost{sfx}@x.com','name':'Cohost','password':'goodpassword'}); C=r['token']; Cid=r['user']['id']
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':0},tok=C); check('non-member sync 403', s==403, r)
s,r,_=call('POST',f'leagues/{L}/invites',{},tok=C); check('non-member invite 403', s==403, r)
s,r,_=call('POST',f'leagues/{L}/invites',{'days':7,'uses':2},tok=A); check('invite', s==200 and len(r['invite']['code'])==8, r); code=r['invite']['code']
s,r,_=call('POST',f'invites/{code.lower()[:4]}-{code.lower()[4:]}/accept',{},tok=C); check('accept invite (dashed lowercase)', s==200 and r['league']['role']=='organizer', r)
s,r,_=call('POST',f'leagues/{L}/invites',{},tok=C); check('organizer cannot invite', s==403, r)
s,r,_=call('GET',f'leagues/{L}/members',tok=C); check('members', s==200 and len(r['members'])==2, r)
# sync
p1={'id':'player-aaa1','name':'Alice','createdAt':t,'updatedAt':t,'legacy':{'points':20,'events':5,'year':2026}}
p2={'id':'player-bbb2','name':'Bob','createdAt':t,'updatedAt':t}
ev={'id':'event-0001','status':'running','date':t,'updatedAt':t,'name':'Week 1','rounds':[]}
setup={'id':'event-0002','status':'setup','date':t,'updatedAt':t}
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':0,'players':[p1,p2],'events':[ev,setup],'settings':[{'name':'seasons','value':{'len':8},'updatedAt':t}]},tok=A)
check('push sync', s==200 and r['cursor']==5 and not r['rejected'] and len(r['players'])==2, r); curA=r['cursor']
check('legacy roundtrip', r['players'][0]['legacy']=={'points':20,'events':5,'year':2026} or r['players'][1]['legacy']=={'points':20,'events':5,'year':2026}, r['players'])
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':0},tok=C); check('cohost pull all', len(r['events'])==2 and len(r['players'])==2 and r['settings'][0]['value']=={'len':8}, r)
curC=r['cursor']
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curC},tok=C); check('pull nothing new', not r['players'] and not r['events'] and r['cursor']==curC, r)
# stale write
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curC,'players':[{**p1,'name':'Old Alice','updatedAt':t-1000}]},tok=C); check('stale rejected', r['rejected']==[{'kind':'player','id':'player-aaa1','reason':'stale'}], r)
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curC,'players':[{**p1,'name':'Alice B','updatedAt':t+1000}]},tok=C); check('newer accepted', not r['rejected'] and r['players'][0]['name']=='Alice B', r); curC=r['cursor']
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curA},tok=A); check('owner sees rename only', [x['name'] for x in r['players']]==['Alice B'] and not r['events'], r); curA=r['cursor']
# deletion
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curA,'deletions':[{'kind':'player','id':'player-bbb2','deletedAt':t+2000}]},tok=A); check('delete', not r['rejected'] and r['deletions']==[{'kind':'player','id':'player-bbb2','deletedAt':t+2000}], r); curA=r['cursor']
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curC,'players':[{**p2,'name':'Bob old edit','updatedAt':t+1500}]},tok=C); check('older edit blocked by tombstone', r['rejected'][0]['reason']=='stale' and r['deletions'][0]['id']=='player-bbb2', r); curC=r['cursor']
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curC,'players':[{**p2,'name':'Bob back','updatedAt':t+3000}]},tok=C); check('newer edit resurrects', not r['rejected'] and r['players'][0]['name']=='Bob back', r); curC=r['cursor']
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curA},tok=A); check('owner gets resurrected bob', any(x['name']=='Bob back' for x in r['players']), r); curA=r['cursor']
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curA,'deletions':[{'kind':'player','id':'player-bbb2','deletedAt':t+2500}]},tok=A); check('delete older than edit rejected', r['rejected'][0]['reason']=='edited_after_delete', r)
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':curA,'players':[{'id':'x','name':'','updatedAt':0}],'events':[{'id':'event-zzz9','status':'bogus','updatedAt':t}],'settings':[{'name':'hack','value':1,'updatedAt':t}]},tok=A); check('invalid rejected', [x['reason'] for x in r['rejected']]==['invalid']*3, r)
# claim
s,r,_=call('POST',f'leagues/{L}/events/event-0001/claim',{'device':'Brian phone'},tok=A); check('claim', r=={'claimed':True,'runner':'Brian phone'}, r)
s,r,_=call('POST',f'leagues/{L}/events/event-0001/claim',{'device':'Cohost phone'},tok=C); check('claim blocked', r=={'claimed':False,'runner':'Brian phone'}, r)
s,r,_=call('POST',f'leagues/{L}/events/event-0001/claim',{'device':'Cohost phone','force':True},tok=C); check('force takeover', r['claimed'], r)
s,r,_=call('POST',f'leagues/{L}/events/event-0001/release',{'device':'Brian phone'},tok=A)
s,r,_=call('POST',f'leagues/{L}/events/event-0001/claim',{'device':'Brian phone'},tok=A); check('old runner release did not clear', r['claimed']==False, r)
s,r,_=call('POST',f'leagues/{L}/events/event-0001/release',{'device':'Cohost phone'},tok=C)
s,r,_=call('POST',f'leagues/{L}/events/event-0001/claim',{'device':'Brian phone'},tok=A); check('claim after release', r['claimed'], r)
s,r,_=call('POST',f'leagues/{L}/events/nope-nope/claim',{'device':'x'},tok=A); check('claim missing 404', s==404, r)
# public
s,r,h=call('GET',f'public/{slug}'); check('public', s==200 and [e['id'] for e in r['events']]==['event-0001'] and h.get('Cache-Control')=='public, max-age=5', (r,h.get('Cache-Control')))
check('public no emails', 'email' not in json.dumps(r))
s,r2,_=call('GET',f'public/{slug}?since={r["cursor"]}'); check('public since empty', not r2['events'] and not r2['players'], r2)
s,r,_=call('PATCH',f'leagues/{L}',{'isPublic':False},tok=C); check('organizer cannot patch', s==403, r)
s,r,_=call('PATCH',f'leagues/{L}',{'isPublic':False},tok=A); check('owner hides league', s==200 and r['league']['isPublic']==False, r)
s,r,_=call('GET',f'public/{slug}'); check('hidden league 404', s==404, r)
# members
s,r,_=call('DELETE',f'leagues/{L}/members/{Cid}',tok=A); check('remove cohost', s==200, r)
s,r,_=call('POST',f'leagues/{L}/sync',{'cursor':0},tok=C); check('removed cohost blocked', s==403, r)
s,r,_=call('POST','auth/logout',{},tok=A); check('logout', s==200, r)
s,r,_=call('GET','me',tok=A); check('token dead after logout', s==401, r)
# rate limit
for i in range(12): s,r,_=call('POST','auth/login',{'email':'nobody@x.com','password':'x'})
check('rate limit', s==429, r)
print('FAILS', fails)

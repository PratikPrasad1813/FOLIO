import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
const load = createRequire(import.meta.url)("./folio-test-loader.cjs");
const { db, pool } = load(resolve('src/db/index.ts'));
const { users, sessions, projects, tasks, ideas, authFlows, authIdentities, authRateLimits } = load(resolve('src/db/schema.ts'));
const { resolveOAuthIdentity } = load(resolve('src/lib/auth-identities.ts'));
const { exchangeProviderCode } = load(resolve('src/lib/oauth.ts'));
const { safeDestination, allowAuthAttempt, hashToken, secureCookies } = load(resolve('src/lib/auth.ts'));
const BASE = (process.env.TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/,'');
const ids = []; let checks = 0;
const equal=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;}; const ok=(v,m)=>{assert.ok(v,m);checks++;};
async function api(path, cookie, method='GET', body, headers={}) {
 const res=await fetch(`${BASE}${path}`, {method, redirect:'manual', headers:{Origin:BASE,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const text=await res.text(); let data;try{data=JSON.parse(text);}catch{data=text;}
 return {status:res.status,data,headers:res.headers};
}
async function account(provider='test', completed=true) {
 const [u]=await db.insert(users).values({name:'Phase Three Tester',email:`phase3-${randomUUID()}@example.invalid`,provider,onboardingCompletedAt:completed?new Date():null}).returning();ids.push(u.id);
 const token=randomBytes(32).toString('hex');await db.insert(sessions).values({userId:u.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+864e5)});
 return {...u,cookie:`folio_session=${token}`,token};
}
try {
 equal((await api('/api/health')).status,200,'App launches');
 for(const path of ['/','/login','/signup','/privacy','/terms','/robots.txt','/sitemap.xml'])equal((await api(path)).status,200,`Public ${path}`);
 for(const path of ['/overview','/projects','/tasks','/ideas','/calendar','/ai','/settings']){
  const r=await api(path);equal(r.status,307,`Protected ${path}`);ok(r.headers.get('location').includes('/login?next='),'Intended destination retained');
 }
 for(const path of ['/api/workspace','/api/profile','/api/search?q=test','/api/notifications','/api/ai/usage'])equal((await api(path)).status,401,`Unauthorized ${path}`);
 equal((await api('/api/workspace','folio_session=invalid')).status,401,'Invalid session rejected');
 for(const unsafe of ['//evil.invalid','https://evil.invalid','/login','/api/auth','/projects\\evil','/tasks\nanything'])equal(safeDestination(unsafe),'/overview','Reject unsafe redirect');
 equal(safeDestination('/tasks?focus=today'),'/tasks?focus=today','Preserve a valid internal destination');
 ok(secureCookies(new Request('https://folio.example/')),'HTTPS cookie is Secure');
 ok(!secureCookies(new Request('http://localhost:3000/')),'Local HTTP supports testing');
 console.log('✓ Public routes, protected navigation, safe redirects, and unauthorized APIs');

 const email=`phase3-${randomUUID()}@example.invalid`;
 const signup=await api('/api/auth',null,'POST',{action:'register',name:'Initial Name',email,password:'A safe testing password 123!',next:'/tasks'});
 equal(signup.status,200,'Email signup retained'); const userId=signup.data.user.id;ids.push(userId);
 const cookie=signup.headers.get('set-cookie').match(/folio_session=[^;]+/)[0];
 ok(signup.headers.get('set-cookie').includes('HttpOnly')&&signup.headers.get('set-cookie').includes('SameSite=lax'),'Cookie protections');
 equal(signup.data.next,'/onboarding?next=%2Ftasks','New account is routed to onboarding');
 ok((await api('/overview',cookie)).headers.get('location').includes('/onboarding'),'New workspace is gated by setup');
 equal((await api('/api/profile',cookie)).data.onboardingStep,0,'New user starts at welcome');
 equal((await api('/api/profile',cookie,'PATCH',{complete:true})).status,400,'Cannot skip required setup state');
 equal((await api('/api/profile',cookie,'PATCH',{userId:randomUUID()})).status,400,'Mass assignment rejected');
 equal((await api('/api/profile',cookie,'PATCH',{personal:{theme:'broken'}})).status,400,'Theme allowlist');
 equal((await api('/api/profile',cookie,'PATCH',{timezone:'not-a-zone'})).status,400,'Timezone validation');
 equal((await api('/api/profile',cookie,'PATCH',{personal:{language:'fr'}})).status,400,'Only supported language selectable');
 equal((await api('/api/profile',cookie,'PATCH',{step:5})).status,400,'Cannot jump onboarding sequence');
 for(let step=1;step<=10;step++) {
   const payload={step};
   if(step===2)payload.name='Morgan Studio';
   if(step===3)payload.personal={addressMode:'preferred',preferredName:'Mo'};
   if(step===4)payload.personal={gender:'self',genderDescription:'My own description'};
   if(step===5)payload.personal={country:'IN'};
   if(step===6)payload.timezone='Asia/Kolkata';
   if(step===7)payload.personal={language:'en',locale:'en-IN',dateFormat:'dmy',timeFormat:'24h',weekStart:0};
   if(step===8)payload.personal={workUses:['Managing projects','Studies & learning']};
   if(step===9){payload.weeklyGoal=18;payload.personal={taskDensity:'compact',taskInsights:false};payload.quietHoursEnabled=true;}
   if(step===10)payload.personal={theme:'dark'};
   const r=await api('/api/profile',cookie,'PATCH',payload);equal(r.status,200,`Save onboarding step ${step}`);
   equal((await api('/api/profile',cookie)).data.onboardingStep,step,`Resume step ${step}`);
 }
 const complete=await api('/api/profile',cookie,'PATCH',{complete:true,assistant:{assistantName:'Nova',presentation:'neutral',style:'calm'}});
 equal(complete.status,200,'Finish onboarding'); equal(complete.data.user.greetingName,'Mo','Address preference saved');
 equal(complete.data.timezone,'Asia/Kolkata','Timezone persisted in existing notification prefs');equal(complete.data.assistant.assistantName,'Nova','AI preference reused');
 equal(complete.data.personal.theme,'dark','Theme persists');equal(complete.data.personal.dateFormat,'dmy','Regional formatting persists');
 equal((await api('/api/notifications/preferences',cookie)).data.preferences.timezone,'Asia/Kolkata','Notification timezone is the same source');
 const workspace=(await api('/api/workspace',cookie)).data;equal(workspace.projects.length,0,'No fake projects in real workspace');equal(workspace.tasks.length,0,'No fake tasks');equal(workspace.ideas.length,0,'No fake ideas');
 equal((await api('/tasks',cookie)).status,200,'Completed onboarding opens workspace');
 equal((await api('/login',cookie)).status,307,'Signed-in login redirects');equal((await api('/onboarding',cookie)).status,307,'No repeated onboarding');
 const other=await account();
 equal((await api('/api/profile',other.cookie)).data.user.name,'Phase Three Tester','Profiles are isolated');
 await api('/api/profile',cookie,'PATCH',{personal:{gender:null,genderDescription:null,country:null}});
 equal((await api('/api/profile',cookie)).data.personal.gender,null,'Optional identity can be cleared');
 equal((await api('/api/profile',cookie,'PATCH',{name:'bad'}, {Origin:'https://evil.invalid'})).status,403,'Profile cross-origin request blocked');
 await db.update(sessions).set({expiresAt:new Date(Date.now()+3600_000)}).where(eq(sessions.userId,userId));
 const renew=await api('/api/auth/session',cookie,'POST');equal(renew.status,200,'Session renewal');ok(renew.headers.get('set-cookie')?.includes('HttpOnly'),'Renewal preserves cookie protections');
 equal((await api('/api/auth',cookie,'DELETE')).status,200,'Real logout');equal((await api('/api/workspace',cookie)).status,401,'Old session invalid after logout');
 const login=await api('/api/auth',null,'POST',{action:'login',email,password:'A safe testing password 123!',next:'/projects'});equal(login.status,200,'Existing email login');equal(login.data.next,'/projects','Existing user destination');
 const expired=await account();await db.update(sessions).set({expiresAt:new Date(Date.now()-1000)}).where(eq(sessions.userId,expired.id));equal((await api('/api/profile',expired.cookie)).status,401,'Expired session rejected');
 console.log('✓ Every onboarding step, resume, preference persistence, privacy, logout, refresh, and empty real workspace');

 const newIdentity={provider:'google',subject:`test-${randomUUID()}`,email:`phase3-${randomUUID()}@example.invalid`,name:'OAuth Test',verified:true};
 const oauthUser=await resolveOAuthIdentity(newIdentity,null);ids.push(oauthUser.id);equal(oauthUser.onboardingCompletedAt,null,'New OAuth account begins onboarding');
 equal((await resolveOAuthIdentity(newIdentity,null)).id,oauthUser.id,'Provider subject login stable');
 const cross={...newIdentity,provider:'github',subject:`github-${randomUUID()}`};
 await assert.rejects(()=>resolveOAuthIdentity(cross,null),/original method/);checks++;
 equal((await resolveOAuthIdentity(cross,oauthUser.id)).id,oauthUser.id,'Explicit verified linking preserves account');
 await assert.rejects(()=>resolveOAuthIdentity(cross,other.id),/different Folio account/);checks++;
 await assert.rejects(()=>resolveOAuthIdentity({...newIdentity,verified:false},null),/verified/);checks++;
 const legacy=await account('google');
 equal((await resolveOAuthIdentity({...newIdentity,email:legacy.email,subject:`legacy-${randomUUID()}`},null)).id,legacy.id,'Verified original provider reclaims legacy account without data loss');
 for(const provider of ['google','github']){
  const callback=await api(`/api/auth/oauth/${provider}/callback?state=invalid&code=invalid`);equal(callback.status,303,'Invalid OAuth state redirects safely');ok(callback.headers.get('location').includes('/login?error='),'Safe OAuth failure UI');
 }
 // Protocol tests mock public PROVIDER responses only, not Folio backend logic.
 // They do not assert real external OAuth console configuration or live consent.
 const originalFetch=globalThis.fetch;const originalEnv={ GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET:process.env.GOOGLE_CLIENT_SECRET,GITHUB_CLIENT_ID:process.env.GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET:process.env.GITHUB_CLIENT_SECRET };
 Object.assign(process.env,{ GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-only',GITHUB_CLIENT_ID:'test-client',GITHUB_CLIENT_SECRET:'test-only' });
 try {
  let verified=true;
  globalThis.fetch=async (url,init)=>{
    const target=String(url);
    if(target.includes('/token')||target.includes('/access_token')){ok(String(init.body).includes('code_verifier=proof'),'PKCE verifier reaches provider token endpoint');return Response.json({access_token:'test-token'});}
    if(target.includes('/userinfo'))return Response.json({sub:'google-sub',email:'verified@example.invalid',email_verified:verified,name:'Verified'});
    if(target.endsWith('/user/emails'))return Response.json([{email:'github@example.invalid',primary:true,verified}]);
    if(target.endsWith('/user'))return Response.json({id:123,name:'GitHub User',email:'untrusted@example.invalid'});
    throw new Error('Unexpected endpoint');
  };
  const google=await exchangeProviderCode('google',new Request(`${BASE}/api/auth/oauth/google/callback`),'test-code','proof');equal(google.subject,'google-sub','Google stable subject');
  const github=await exchangeProviderCode('github',new Request(`${BASE}/api/auth/oauth/github/callback`),'test-code','proof');equal(github.email,'github@example.invalid','GitHub email must come from verified primary emails API');
  verified=false;await assert.rejects(()=>exchangeProviderCode('google',new Request(BASE),'test','proof'),/verified/);checks++;
  await assert.rejects(()=>exchangeProviderCode('github',new Request(BASE),'test','proof'),/verified/);checks++;
 } finally {globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(originalEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 const { sealToken } = load(resolve('src/lib/crypto.ts'));
 const nonce=randomBytes(32).toString('base64url'), binding=randomBytes(32).toString('base64url');
 await db.insert(authFlows).values({stateHash:hashToken(nonce),browserHash:hashToken(binding),provider:'google',verifierEnc:sealToken('test-verifier'),returnTo:'/tasks',expiresAt:new Date(Date.now()+60000)});
 const mismatched=await api(`/api/auth/oauth/google/callback?state=${nonce}&code=test`,'folio_signin_binding=wrong');
 equal(mismatched.status,303,'Mismatched browser binding rejected');
 equal((await db.select().from(authFlows).where(eq(authFlows.stateHash,hashToken(nonce)))).length,1,'Mismatched callback cannot consume another browser flow');
 const consumed=await api(`/api/auth/oauth/google/callback?state=${nonce}&code=test`,`folio_signin_binding=${binding}`);
 equal(consumed.status,303,'Bound callback returns a safe result');
 equal((await db.select().from(authFlows).where(eq(authFlows.stateHash,hashToken(nonce)))).length,0,'Valid bound flow atomically consumed once');
 const replay=await api(`/api/auth/oauth/google/callback?state=${nonce}&code=test`,`folio_signin_binding=${binding}`);
 ok(decodeURIComponent(replay.headers.get('location')).includes('already used'),'Replayed callback denied before provider exchange');
 console.log('✓ Provider-subject resolution, explicit account linking, legacy compatibility, PKCE and verified-email protocol checks');
 const rateBucket=`phase3-test-${randomUUID()}`;const rateRequest=new Request(BASE,{headers:{'x-nf-client-connection-ip':'198.51.100.45'}});
 for(let i=0;i<25;i++)ok(await allowAuthAttempt(rateRequest,rateBucket),'Rate limit permits normal attempt');
 equal(await allowAuthAttempt(rateRequest,rateBucket),false,'Persistent rate limit blocks attempt 26');
 await db.delete(authRateLimits).where(eq(authRateLimits.key,hashToken(`${rateBucket}:198.51.100.45`)));
 console.log(`PASS: ${checks} Phase 3 assertions. Live Google/GitHub consent is not tested without configured credentials.`);
} finally {
 if(ids.length)await db.delete(users).where(inArray(users.id,ids));
 await pool.end();
}

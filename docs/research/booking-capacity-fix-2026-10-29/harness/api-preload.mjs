import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { guard } from './guard.mjs';
import { createRequire } from 'node:module';
import { createPgStubFetch } from './pg-stub-preload.mjs';
guard(process.env, 'api');
// Match production fail-closed pub/sub bootstrap even though synthetic fixtures
// require NODE_ENV=test. A fresh Direct VPC NIC may not be ready at first boot.
const require=createRequire('/app/package.json');
require('reflect-metadata');
const {RedisIoAdapter}=require('/app/dist/modules/booking/providers/redis-io.adapter.js');
const originalConnect=RedisIoAdapter.prototype.connectToRedis;
RedisIoAdapter.prototype.connectToRedis=async function(...args){
 const ready=await originalConnect.apply(this,args);
 if(!ready)throw new Error('Synthetic rehearsal requires the production Redis adapter readiness gate');
 return ready;
};
const provider = createPgStubFetch({ latencyMs: 300, realFetch: async () => { throw new Error('External fetch disabled in synthetic cloud rehearsal'); } });
globalThis.fetch = provider.fetch;
// Instrumentation is opt-in; final capacity measurements run without it.
const profile=process.env.REHEARSAL_PROFILE_CONFIRM==='1'?await import('./cloud-profile.mjs'):null;
const id = randomUUID();
const originalEmit = Server.prototype.emit;
Server.prototype.emit = function(event, ...args) {
  if(event==='request' && args[0].url?.split('?')[0]==='/api/v1/__rehearsal/profile'){args[1].setHeader('Content-Type','application/json');args[1].end(JSON.stringify({instance:id,...(profile?.profileSnapshot()??{profilingEnabled:false})}));return true;}
  if (event === 'connection' && process.env.REHEARSAL_KEEPALIVE_MS) { this.keepAliveTimeout=Number(process.env.REHEARSAL_KEEPALIVE_MS); }
  if (event === 'request') {
    args[1].setHeader('x-grabit-rehearsal-instance', id);
    args[1].setHeader('x-grabit-rehearsal-rss-bytes', String(process.memoryUsage.rss()));
  }
  return originalEmit.call(this, event, ...args);
};
console.log(JSON.stringify({ rehearsalOnly: true, provider: 'simulated-300ms', externalFetchBlocked: true }));

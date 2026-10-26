/* Session-only estimates. Feedback is an association, never proof of cache warming. */
(() => {
  'use strict';
  const tiers = [65536, 262144, 1048576, 4194304];
  class Controller {
    constructor() { this.states = new Map(); this.decisions = []; }
    key(host, path) { return host + path; }
    state(host, path) {
      const key = this.key(host, path);
      if (!this.states.has(key)) {
        if (this.states.size >= 64) this.states.delete(this.states.keys().next().value);
        this.states.set(key, {host, path, targetBytes: 262144, leadSeconds: 20,
          samples: 0, fast: 0, slow: 0, noBody: 0, lastRecoveryMs: -Infinity,
          learned: [], seen: [], reason: 'initial'});
      }
      return this.states.get(key);
    }
    decision(s, reason) {
      s.reason = reason;
      this.decisions.push({atMs: Date.now(), host:s.host, path:s.path, reason,
        targetBytes:s.targetBytes, leadSeconds:s.leadSeconds, samples:s.samples});
      if (this.decisions.length > 200) this.decisions.shift();
    }
    policy(host, path, config, recovery = false) {
      const s = this.state(host, path);
      const deadlineSeconds = Math.min(config.adaptiveDeadlineSeconds, recovery ? 1 : Infinity);
      return {targetBytes:Math.min(s.targetBytes, config.adaptiveMaxPrimeMiB*1048576, recovery ? 65536 : Infinity),
        deadlineSeconds,
        leadSeconds:Math.min(config.adaptiveMaxLeadSeconds, Math.max(10, s.leadSeconds, deadlineSeconds+config.settleSeconds+config.fetchMarginSeconds)),
        recovery, samples:s.samples, reason:s.reason};
    }
    allowRecovery(host, path, now) {
      const s = this.state(host, path);
      if (now-s.lastRecoveryMs < 15000) return false;
      s.lastRecoveryMs = now; return true;
    }
    prime(result, recovery = false) {
      if (recovery || result.concurrent || result.mode !== 'adaptive' || ['player-priority','player-range-overlap'].includes(result.reason)) return;
      const s = this.state(result.host, result.path);
      if (result.bytes > 0) { s.noBody = 0; return; }
      // No response cannot establish a useful byte target. Start earlier rather than
      // repeatedly extending the request and competing with the player.
      if (result.reason === 'deadline' && ++s.noBody >= 3) {
        s.leadSeconds = Math.min(300, s.leadSeconds+5); s.noBody = 0;
        this.decision(s, 'no-body-start-earlier');
      }
    }
    feedback(r, primes, config) {
      if (r.mode !== 'adaptive' || !r.complete || r.status !== 206 || !r.range || r.primeOverlapMs > 0 || r.fromBrowserCache !== false) return;
      const eligible = primes.filter(p => p.mode === 'adaptive' && !p.recovery && !p.concurrent && p.endMs !== null && p.endMs <= r.startMs &&
        r.startMs-p.endMs <= 600000 && p.tab === r.tab && p.host === r.host && p.path === r.path &&
        p.bytes > 0 && p.range.lo <= r.range.hi && p.range.hi >= r.range.lo &&
        p.durationSeconds > 0 && p.remoteIP && p.remoteIP === r.remoteIP &&
        ['partial','completed'].includes(p.outcome));
      const p = eligible.at(-1); if (!p) return;
      const s = this.state(r.host, r.path), id = `${p.startMs}:${p.range.lo}`;
      if (s.seen.includes(id)) return;
      s.seen.push(id); if (s.seen.length>100) s.seen.shift();
      s.samples++;
      const fast = r.complete && r.status === 206 && r.firstByteAfterMs !== null &&
        r.firstByteAfterMs < 500 && r.totalMs < p.durationSeconds*1000*0.6;
      s.fast = fast ? s.fast+1 : 0; s.slow = fast ? 0 : s.slow+1;
      s.learned.push({atMs:r.endMs, fast, totalMs:r.totalMs, firstByteMs:r.firstByteAfterMs});
      if (s.learned.length>20) s.learned.shift();
      if (s.slow >= 3) {
        if (r.firstByteAfterMs === null || r.firstByteAfterMs > 500) {
          s.leadSeconds = Math.min(config.adaptiveMaxLeadSeconds, s.leadSeconds+5);
          this.decision(s, 'slow-first-byte-start-earlier');
        } else {
          s.targetBytes = Math.min(config.adaptiveMaxPrimeMiB*1048576, tiers.find(n=>n>s.targetBytes)||tiers.at(-1));
          this.decision(s, 'slow-body-increase-bytes');
        }
        s.slow = 0;
      } else if (s.fast >= 6) {
        s.targetBytes = [...tiers].reverse().find(n=>n<s.targetBytes)||tiers[0];
        s.fast = 0; this.decision(s, 'fast-repeats-reduce-bytes');
      }
    }
  }
  class Scheduler {
    constructor(){this.tabs=new Map();this.decisions=[];}
    evaluate(tab,blockers,config,now){
      if(!this.tabs.has(tab))this.tabs.set(tab,{waitingSinceMs:null,lastConcurrentMs:null,reason:null});
      const s=this.tabs.get(tab);
      if(!blockers.length)s.waitingSinceMs=null;
      else if(s.waitingSinceMs===null)s.waitingSinceMs=now;
      const waitMs=s.waitingSinceMs===null?0:Math.max(0,now-s.waitingSinceMs);
      const cooldownMs=s.lastConcurrentMs===null?0:Math.max(0,30000-(now-s.lastConcurrentMs));
      let reason=!blockers.length?'idle':config.mode!=='adaptive'||!config.adaptiveConcurrency?'concurrency-disabled':
        waitMs<config.adaptiveBusyWaitSeconds*1000?'waiting':cooldownMs>0?'cooldown':'concurrent-ready';
      if(s.reason!==reason){s.reason=reason;this.record({atMs:now,tab,reason,waitMs,blockerCount:blockers.length});}
      return {allowed:!blockers.length||reason==='concurrent-ready',concurrent:reason==='concurrent-ready',reason,
        waitingSinceMs:s.waitingSinceMs,waitMs,cooldownMs,blockerCount:blockers.length,blockers:blockers.slice(0,8)};
    }
    admit(tab,now){const s=this.tabs.get(tab);if(s)s.lastConcurrentMs=now;this.record({atMs:now,tab,reason:'concurrent-start',byteCeiling:262144,timeoutSeconds:3});}
    record(row){this.decisions.push(row);if(this.decisions.length>200)this.decisions.shift();}
    remove(tab){this.tabs.delete(tab);}
    reset(){this.tabs.clear();}
  }
  globalThis.PrimerAdaptive = {Controller,Scheduler};
  if (typeof module !== 'undefined') module.exports = {Controller,Scheduler};
})();

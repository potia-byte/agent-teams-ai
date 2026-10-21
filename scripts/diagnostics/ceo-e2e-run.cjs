// Real end-to-end CEO provider-supervisor scenario against the BUILT app (isolated userData + claude root).
// Only the terminal quota signal is SYNTHETIC (JSONL line appended to AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE,
// consumed by src/main/testing/e2eQuotaSignalInjector.ts). Everything else is REAL: claude-multimodel lead
// processes with real providers, IPC window.electronAPI.ceoSupervisor.*, stop/launch via TeamProvisioningService.
// Usage: node ceo-e2e-run.cjs [--tag ceo1] [--port 9333] [--wait-sec 240]
// Quota use: 3 minimal provider requests (codex, anthropic, codex). Steps are labelled REAL / SYNTHETIC.
const path = require('path'); const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const { connect } = require('./cdp-eval.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'ceo' + Date.now().toString(36)); const port = +arg('port', 9333); const waitSec = +arg('wait-sec', 240);
const root = path.resolve(__dirname, '../..'); const tools = path.join(root, '.local-tools');
const stateDir = path.join(tools, 'state', 'run-' + tag); const claudeRoot = path.join(stateDir, 'claude-root');
const userData = path.join(stateDir, 'userdata'); const signalFile = path.join(userData, 'e2e-quota-signal.jsonl');
const project = path.join(tools, 'ceo-e2e-project-' + tag);
const team = 'ceo-e2e-' + Date.now().toString(36);
const logFile = path.join(tools, 'diagnostics', `ceo-e2e-${tag}.log`);
const J = JSON.stringify; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(); fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = (kind, ...a) => { const l = `${new Date().toISOString()} [${kind}] ${a.join(' ')}`; console.log(l); fs.appendFileSync(logFile, l + '\n'); };
const results = []; const check = (step, name, ok, ev) => { results.push({ step, name, ok }); log(ok ? 'PASS' : 'FAIL', `step${step}`, name, ev === undefined ? '' : J(ev).slice(0, 700)); return ok; };
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
const npath = (p) => p.toLowerCase().replace(/\//g, '\\');
let epid = 0, c = null;

// ---- process sampler (persistent powershell loop; records first/last seen per pid) ----
const seen = new Map(); let sampler = null;
function startSampler() {
  const re = [project, stateDir, path.join('runtime-cache', '0.0.124')].map((s) => s.replace(/\\/g, '\\\\').replace(/[.]/g, '\\.')).join('|');
  const script = `while($true){ Get-CimInstance Win32_Process | ?{ ($_.Name -match '^(claude-multimodel|codex)(\\.exe)?$' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'codex')) -and $_.CommandLine -match '(?i)${re.replace(/'/g, "''")}' } | %{ "P|$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)" }; "END"; Start-Sleep -Milliseconds 200 }`;
  sampler = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '', cur = [];
  sampler.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line === 'END') {
        const now = Date.now();
        // Track only processes owned by this run: direct child of the app pid, or child of an already tracked pid
        // (survives parent death, so orphans stay visible). Other agents' processes sharing the runtime path are ignored.
        let grew = true; const own = new Set([...seen.keys()]);
        while (grew) { grew = false; for (const p of cur) if (!own.has(p.pid) && (p.ppid === epid || own.has(p.ppid))) { own.add(p.pid); grew = true; } }
        cur = cur.filter((p) => own.has(p.pid)); const ids = new Set(cur.map((p) => p.pid));
        for (const p of cur) { const s = seen.get(p.pid); if (!s) seen.set(p.pid, { ...p, first: now, last: now, gone: null }); else { s.last = now; s.gone = null; } }
        for (const [pid, s] of seen) if (!ids.has(pid) && !s.gone) s.gone = now;
        cur = [];
      } else if (line.startsWith('P|')) { const [, pid, ppid, name, ...cm] = line.split('|'); cur.push({ pid: +pid, ppid: +ppid, name, lead: /claude-multimodel/i.test(name) && /--input-format/.test(cm.join('|')) }); }
    }
  });
}
const alive = (filter = () => true) => [...seen.values()].filter((s) => !s.gone && filter(s));
const leads = () => alive((s) => s.lead);
const leadsEver = () => [...seen.values()].filter((s) => s.lead).length;
const providers = () => alive((s) => /codex/i.test(s.name));
const fmt = (a) => a.map((s) => `${s.pid}:${s.name}`).join(',');

// ---- app control ----
function launchApp() {
  const pf = path.join(stateDir, 'electron.pid'); fs.rmSync(pf, { force: true });
  // stdout/stderr to a file: a pipe handle inherited by electron would block the parent forever.
  const outFile = path.join(tools, 'tmp', `launch-${tag}.txt`); fs.mkdirSync(path.dirname(outFile), { recursive: true }); const fd = fs.openSync(outFile, 'w');
  require('child_process').spawnSync('powershell', ['-NoProfile', '-Command', `& '${path.join(__dirname, 'launch-isolated-app.ps1')}' -Tag '${tag}' -Port ${port} -UseRealProviderAuth -QuotaSignalFile`], { stdio: ['ignore', fd, fd], timeout: 60000 });
  fs.closeSync(fd); const out = fs.readFileSync(outFile, 'utf8');
  const m = /pid=(\d+)/.exec(out); if (!m) throw new Error('launch failed: ' + out.slice(0, 300)); epid = +m[1]; log('REAL', 'app launched pid', epid); return epid;
}
async function attach() {
  for (let i = 0; i < 90; i++) {
    try { c = await connect(port); const ok = await c.ev('typeof window.electronAPI?.ceoSupervisor?.read'); if (ok === 'function') return; c.close(); } catch { /* retry */ }
    await sleep(2000);
  }
  throw new Error('renderer/electronAPI not reachable');
}
const call = async (expr) => { const r = await c.ev(`(async()=>{try{return JSON.stringify({ok:true,v:await (${expr})})}catch(e){return JSON.stringify({ok:false,e:String(e&&e.message||e)})}})()`); return JSON.parse(r); };
const ceoRead = async () => { const r = await call(`window.electronAPI.ceoSupervisor.read(${J(team)})`); if (!r.ok) throw new Error('ceo.read: ' + r.e); return r.v; };
const ceoCmd = (o) => call(`window.electronAPI.ceoSupervisor.command(${J({ teamName: team, ...o })})`);
const events = (s) => s.history.map((h) => h.event);
const hasSeq = (ev, seq) => { let i = 0; for (const e of ev) if (e === seq[i]) i++; return i === seq.length; };
const brief = (s) => ({ status: s.status, reason: s.reason, epoch: s.epoch, owner: s.owner && `${s.owner.provider}/${s.owner.runId}/${s.owner.role}`, ckpt: s.checkpoint && s.checkpoint.id, handled: s.handledRuns.length, hist: events(s).join('>') });
const appendSignal = (runId, providerId, detail) => { fs.appendFileSync(signalFile, J({ teamName: team, runId, providerId, detail }) + '\n'); log('SYNTHETIC', 'quota line appended', J({ runId, providerId, detail })); };
const transcripts = () => { const out = {}; const pd = path.join(claudeRoot, 'projects'); try { for (const d of fs.readdirSync(pd)) for (const f of fs.readdirSync(path.join(pd, d)).filter((x) => x.endsWith('.jsonl'))) out[path.join(pd, d, f)] = f.replace('.jsonl', ''); } catch { /* none */ } return out; };
async function waitFor(label, fn, sec = waitSec, every = 2500) { const s = Date.now(); let last; while ((Date.now() - s) / 1000 < sec) { try { last = await fn(); if (last) return last; } catch (e) { last = null; } await sleep(every); } log('WARN', 'timeout waiting for', label); return null; }
const countInjected = () => { let n = 0; for (const f of ['out', 'err']) { try { n += (fs.readFileSync(path.join(tools, 'diagnostics', `app-${tag}.${f}`), 'utf8').match(/SYNTHETIC quota signal injected/g) || []).length; } catch { /* none */ } } return n; };

(async () => {
    try {
    fs.mkdirSync(project, { recursive: true });
    ps(`Set-Location '${project}'; git init -q; 'throwaway' | Set-Content README.txt`);
    log('REAL', 'throwaway git project', project, 'team', team);
    startSampler(); launchApp(); await attach(); log('REAL', 'attached over CDP');

    // ---- Step 1 ----
    const req = { teamName: team, displayName: team, description: 'throwaway ceo e2e', members: [], cwd: project, providerId: 'codex', model: 'gpt-5.6-luna', skipPermissions: true,
      prompt: 'Reply with exactly: OK. Then stop. Do not use any tools, do not create tasks, do not spawn teammates.' };
    const cr = await call(`window.electronAPI.teams.createTeam(${J(req)})`); log('REAL', 'createTeam', J(cr).slice(0, 300));
    const run1 = cr.ok ? cr.v.runId : null;
    const ready = run1 && await waitFor('codex ready', async () => { const st = await call(`window.electronAPI.teams.getProvisioningStatus(${J(run1)})`); if (st.ok && st.v) { if (['failed', 'cancelled'].includes(st.v.state)) throw new Error('prov ' + st.v.state); log('REAL', 'status', st.v.state, String(st.v.message).slice(0, 100)); return st.v.state === 'ready' ? st.v : null; } return null; }, 200, 4000);
    const codexLeads = leads(); const old1 = { leads: codexLeads.map((s) => s.pid), prov: providers().map((s) => s.pid) };
    log('REAL', 'step1 processes', fmt(leads()), '+', fmt(providers()));
    if (!check(1, 'codex solo lead created & ready', !!ready && codexLeads.length === 1, { run1, ...old1 })) throw new Error('step1 failed');

    // ---- Step 2 ----
    let en = await waitFor('enable (idle)', async () => { const r = await ceoCmd({ action: 'enable' }); if (!r.ok) { log('REAL', 'enable not yet', r.e); return null; } return r.v; }, 180, 4000);
    check(2, 'enable -> owner codex primary epoch 1', !!en && en.owner?.provider === 'codex' && en.owner.role === 'primary' && en.epoch === 1 && en.owner.runId === run1, en && brief(en));
    const ck1 = await ceoCmd({ action: 'checkpoint', summary: 'Task: reply with exactly the single word OK and nothing else. Do not use any tools, do not create tasks or teammates.', effects: [{ key: 'op-1', outcome: 'confirmed' }] });
    check(2, 'checkpoint saved with effects', ck1.ok && !!ck1.v.checkpoint?.id && ck1.v.checkpoint.runId === run1, ck1.ok ? brief(ck1.v) : ck1.e);
    const ckptId = ck1.ok ? ck1.v.checkpoint.id : null;
    const oldTranscripts = transcripts(); const oldSessionIds = Object.values(oldTranscripts);
    log('REAL', 'old lead session ids', J(oldSessionIds));

    // ---- Step 3 (Claude auth): NOT VERIFIED per owner instruction (no credential copying) ----
    log('NOT VERIFIED', 'steps 3,5,6 and the Claude-real part of 4: no standard (non-copied) Claude auth in the isolated root; credentials are never copied');
    results.push({ step: '3,5,6', name: 'NOT VERIFIED: live Claude lead, codex->anthropic launch, no-interrupt on codex available, anthropic->codex hand-back (needs Claude auth in isolated root; owner forbids copying credentials)', ok: null });

    // ---- Step 4 (reduced): codex quota with NO reserve available (anthropic stays UNKNOWN) ----
    const injBefore = countInjected(); const detail = "usage_limit_reached: You've hit your usage limit";
    appendSignal(run1, 'codex', detail); await sleep(150); appendSignal(run1, 'codex', detail); // duplicate
    await waitFor('quota handled', async () => { const s = await ceoRead(); log('REAL', 'poll', J(brief(s))); return s.status !== 'active' ? s : null; }, 120, 3000);
    await sleep(8000); const s4b = await ceoRead(); const ev4 = events(s4b);
    check(4, 'old codex lead + provider tree gone (stop through TeamProvisioningService)', old1.leads.every((p) => seen.get(p)?.gone) && old1.prov.every((p) => seen.get(p)?.gone) && leads().length === 0, { alive: fmt(alive()) });
    check(4, 'epoch +1 once, status waiting/no_available_executor (or blocked), owner null, NO launch', s4b.epoch === 2 && s4b.owner === null && ['waiting', 'blocked'].includes(s4b.status) && !ev4.includes('starting_fresh_session') && leads().length === 0, brief(s4b));
    check(4, 'history has quota_confirmed; duplicate line deduped (2 delivered, handledRuns 1)', ev4.includes('quota_confirmed') && ev4.filter((e) => e === 'quota_confirmed').length === 1 && countInjected() - injBefore === 2 && s4b.handledRuns.length === 1 && s4b.checkpoint?.id === ckptId, { events: ev4, delivered: countInjected() - injBefore });
    const al = await call('window.electronAPI.teams.aliveList()'); check(4, 'aliveList does not contain team', !J(al).includes(team), J(al).slice(0, 200));
    const ckpt2 = ckptId; const run2 = run1; const run3 = run1;

    // ---- Step 7 ----
    const pre7 = await ceoRead(); const preEpoch = pre7.epoch; const preBrief = brief(pre7); const preHist = pre7.history.length;
    log('REAL', 'pre-kill state', J(preBrief), 'procs', fmt(alive()));
    const knownPids = [...seen.keys()];
    try { c.close(); } catch { /* ignore */ }
    log('REAL', 'taskkill electron pid', epid); try { execFileSync('taskkill', ['/PID', String(epid), '/T', '/F']); } catch (e) { log('WARN', 'taskkill', String(e.message).slice(0, 200)); }
    await sleep(6000);
    const survivors = alive(); log('REAL', 'SURVIVORS after app kill (my run)', fmt(survivors) || 'none');
    check(7, 'app killed; record survivors', true, { survivors: fmt(survivors) });
    launchApp(); await attach(); log('REAL', 'relaunched same userData, attached');
    await sleep(5000);
    const launchesBefore = leadsEver();
    const r1 = await ceoRead(); await sleep(20000); const r2 = await ceoRead(); const r3 = await ceoRead();
    check(7, 'state persisted (epoch, history, checkpoint, handledRuns)', r1.epoch === pre7.epoch && r1.checkpoint?.id === ckpt2 && r1.history.length >= preHist && r1.handledRuns.length === 1, { pre: preBrief, post: brief(r1) });
    check(7, 'fails closed after restart (waiting/no_available_executor or blocked), no owner', ['waiting', 'blocked'].includes(r1.status) && r1.owner === null, brief(r1));
    check(7, 'no automatic new launch, no repeated action (history stable after 1st read)', leadsEver() === launchesBefore && J(r2.history) === J(r1.history) && J(r3.history) === J(r1.history) && !events(r1).slice(preHist).includes('starting_fresh_session'), { post: events(r1).slice(preHist), newLeads: leadsEver() - launchesBefore });
    const inj0 = countInjected(); const epochR = r3.epoch, histR = J(r3.history);
    appendSignal(run1, 'codex', detail); appendSignal('stale-run-id-0000', 'codex', detail); appendSignal('stale-run-id-0001', 'anthropic', "You've hit your limit"); await sleep(8000);
    const r4 = await ceoRead();
    check(7, 'stale/old-runId synthetic lines ignored (delivered, no state change, no launch)', countInjected() - inj0 === 3 && r4.epoch === epochR && J(r4.history) === histR && leadsEver() === launchesBefore && leads().length === 0, { delivered: countInjected() - inj0, ...brief(r4), leads: fmt(leads()) });
  } catch (e) {
    log('FATAL', e && e.stack || String(e)); results.push({ step: '?', name: 'fatal: ' + String(e.message).slice(0, 200), ok: false });
  } finally {
    // ---- Step 8 cleanup ----
    try { if (c) { try { c.close(); } catch { /* */ } } } catch { /* */ }
    try { if (!c || true) { const cc = await connect(port).catch(() => null); if (cc) { c = cc; const st = await call(`window.electronAPI.teams.stop(${J(team)})`); log('REAL', 'teams.stop', J(st).slice(0, 200)); cc.close(); await sleep(6000); } } } catch (e) { log('WARN', 'stop', String(e).slice(0, 200)); }
    if (epid) { try { execFileSync('taskkill', ['/PID', String(epid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } }
    await sleep(4000); const left = alive(); log('REAL', 'leftover my-run processes before force kill', fmt(left) || 'none');
    for (const s of left) { try { execFileSync('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* */ } }
    if (sampler) { await sleep(1500); sampler.kill(); }
    const creds = []; (function walk(d, depth) { if (depth > 6) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (e.name === '.credentials.json') creds.push(p); } })(path.join(tools, 'state'), 0);
    check(8, 'no .credentials.json remains under .local-tools/state', creds.length === 0, creds);
    let still = ''; try { still = ps(`Get-Process -Id ${epid} -ErrorAction SilentlyContinue | % Id`).trim(); } catch { /* */ }
    const unsettled = [...seen.values()].filter((s) => { try { return ps(`Get-Process -Id ${s.pid} -ErrorAction SilentlyContinue | % Id`).trim() === String(s.pid); } catch { return false; } });
    check(8, 'no process of this run left (electron + providers)', !still && unsettled.length === 0, { electron: still, others: fmt(unsettled) });
    log('REAL', 'all pids ever seen', fmt([...seen.values()]));
    console.log('SUMMARY', J({ team, tag, project, results: results.map((r) => `${r.step}:${r.ok === null ? 'NOT-VERIFIED' : r.ok ? 'PASS' : 'FAIL'}:${r.name}`) }));
    process.exit(results.some((r) => r.ok === false) ? 1 : 0);
  }
})();

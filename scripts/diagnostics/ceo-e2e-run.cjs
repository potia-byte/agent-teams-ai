// Real end-to-end CEO provider-supervisor scenario against the BUILT app (isolated userData + claude root).
// Only the terminal quota signal is SYNTHETIC (JSONL line appended to AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE,
// consumed by src/main/testing/e2eQuotaSignalInjector.ts). Everything else is REAL: claude-multimodel lead
// processes with real providers, IPC window.electronAPI.ceoSupervisor.*, stop/launch via TeamProvisioningService.
// Usage: node ceo-e2e-run.cjs [--tag ceo7] [--port 9333] [--wait-sec 240] [--claude-root <already logged-in isolated Claude root>]
// The Claude root is only handed to the launcher (AGENT_TEAMS_ELECTRON_CLAUDE_ROOT); this script never reads or copies credentials.
// Quota use: 3 minimal provider requests (codex, anthropic, codex). Steps are labelled REAL / SYNTHETIC.
const path = require('path'); const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const { connect } = require('./cdp-eval.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'ceo' + Date.now().toString(36)); const port = +arg('port', 9333); const waitSec = +arg('wait-sec', 240);
const root = path.resolve(__dirname, '../..'); const tools = path.join(root, '.local-tools');
const stateDir = path.join(tools, 'state', 'run-' + tag); const claudeRoot = path.resolve(arg('claude-root', path.join(stateDir, 'claude-root')));
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
      } else if (line.startsWith('P|')) { const [, pid, ppid, name, ...cm] = line.split('|'); cur.push({ pid: +pid, ppid: +ppid, name, cmd: cm.join('|').slice(0, 400), lead: /claude-multimodel/i.test(name) && /--input-format/.test(cm.join('|')) }); }
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
  require('child_process').spawnSync('powershell', ['-NoProfile', '-Command', `& '${path.join(__dirname, 'launch-isolated-app.ps1')}' -Tag '${tag}' -Port ${port} -UseRealProviderAuth -QuotaSignalFile -ClaudeRoot '${claudeRoot}'`], { stdio: ['ignore', fd, fd], timeout: 60000 });
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

const baseTranscripts = transcripts(); // pre-existing transcripts in the shared Claude root are ignored
(async () => {
    try {
    fs.mkdirSync(project, { recursive: true });
    ps(`Set-Location '${project}'; git init -q; 'throwaway' | Set-Content README.txt`);
    log('REAL', 'throwaway git project', project, 'team', team);
    // One logical CEO per Claude-root context (JsonCeoRepository.bindRole): a reused root still bound to an older throwaway team would reject enable.
    // Move the old binding dir aside (backup, not delete); contains no credentials.
    const ceoDir = path.join(claudeRoot, 'teams', '.ceo-supervisor');
    if (fs.existsSync(ceoDir)) { const bk = path.join(tools, 'tmp', `ceo-supervisor-backup-${tag}-${Date.now()}`); fs.renameSync(ceoDir, bk); log('REAL', 'moved stale CEO binding of previous throwaway team to', bk); }
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
    const oldTranscripts = Object.fromEntries(Object.entries(transcripts()).filter(([f]) => !baseTranscripts[f])); const oldSessionIds = Object.values(oldTranscripts);
    log('REAL', 'old lead session ids', J(oldSessionIds));

    // ---- Step 3 (REAL IPC): mark anthropic available ----
    const av = await ceoCmd({ action: 'available', provider: 'anthropic' });
    check(3, 'anthropic marked AVAILABLE (REAL IPC)', av.ok && av.v.providers?.anthropic?.availability === 'AVAILABLE', av.ok ? brief(av.v) : av.e);

    // ---- Step 4: codex quota (SYNTHETIC line x2) -> REAL Claude replacement lead ----
    const preS = await ceoRead(); const injBefore = countInjected(); const detail = "usage_limit_reached: You've hit your usage limit";
    const t4 = Date.now(); appendSignal(run1, 'codex', detail); await sleep(150); appendSignal(run1, 'codex', detail); // duplicate
    const s4 = await waitFor('claude owner active', async () => { const s = await ceoRead(); log('REAL', 'poll', J(brief(s))); return s.status === 'active' && s.owner && s.owner.provider === 'anthropic' ? s : null; }, 240, 3000);
    await sleep(5000); const s4b = await ceoRead(); const ev4 = events(s4b);
    const newLeads = [...seen.values()].filter((s) => s.lead && s.first >= t4 - 500 && !old1.leads.includes(s.pid));
    const claudeLeads = leads().filter((s) => !old1.leads.includes(s.pid));
    log('REAL', 'step4 processes', fmt(alive()), 'lead cmd', claudeLeads[0] ? claudeLeads[0].cmd.replace(/\S*claude-multimodel\.exe/i, 'claude-multimodel') : 'none');
    const oldGone = old1.leads.every((p) => seen.get(p)?.gone) && old1.prov.every((p) => seen.get(p)?.gone);
    const goneBeforeStart = newLeads.length > 0 && [...old1.leads, ...old1.prov].every((p) => seen.get(p)?.gone && seen.get(p).gone <= Math.min(...newLeads.map((l) => l.first)) + 400);
    check(4, 'old codex lead + provider tree gone (REAL)', oldGone, { alive: fmt(alive()) });
    check(4, 'old tree gone BEFORE replacement lead started (sampler 200ms resolution)', goneBeforeStart, { oldGoneAt: old1.leads.concat(old1.prov).map((p) => (seen.get(p)?.gone || 0) - t4), newFirst: newLeads.map((l) => l.first - t4) });
    check(4, 'exactly one new Claude lead alive; model', newLeads.length === 1 && claudeLeads.length === 1 && leads().length === 1, { newLeads: fmt(newLeads), model: (claudeLeads[0]?.cmd.match(/--model\s+(\S+)/) || [])[1] });
    check(4, 'owner anthropic/reserve, epoch +1 once, active', !!s4 && s4b.owner?.provider === 'anthropic' && s4b.owner.role === 'reserve' && s4b.epoch === preS.epoch + 1 && s4b.status === 'active', brief(s4b));
    check(4, 'handledRuns dedup (2 lines delivered, quota_confirmed once, handledRuns 1)', ev4.filter((e) => e === 'quota_confirmed').length === 1 && countInjected() - injBefore === 2 && s4b.handledRuns.length === 1 && s4b.handledRuns.includes(run1), { events: ev4, delivered: countInjected() - injBefore });
    check(4, 'history quota_confirmed -> starting_fresh_session -> owner_committed', hasSeq(ev4, ['quota_confirmed', 'starting_fresh_session', 'owner_committed']), ev4);
    const run2 = s4b.owner && s4b.owner.runId; const claudePid = claudeLeads[0] && claudeLeads[0].pid;
    const newTr = Object.entries(transcripts()).filter(([f]) => !baseTranscripts[f] && !oldTranscripts[f]);
    const trText = newTr.map(([f, id]) => ({ id, text: fs.readFileSync(f, 'utf8') }));
    const ckSnip = 'reply with exactly the single word OK';
    const withCk = trText.filter((t) => t.text.includes(ckSnip));
    const withOld = trText.filter((t) => oldSessionIds.some((id) => t.text.includes(id)) || t.text.includes(run1));
    check(4, 'new lead transcript contains checkpoint text; no old codex session id / runId', withCk.length >= 1 && withOld.length === 0, { newTranscripts: newTr.length, withCheckpoint: withCk.length, withOldId: withOld.length, oldSessionIds });
    const notLoggedIn = trText.some((t) => /Not logged in|authentication_failed/.test(t.text));
    check(4, 'Claude lead really authenticated from the isolated root (assistant message, no Not logged in)', trText.some((t) => /"type":"assistant"/.test(t.text)) && !notLoggedIn, { newTranscripts: newTr.length, notLoggedIn });

    // ---- Step 5: codex available while Claude is active -> no interruption ----
    const pre5 = await ceoRead(); const hist5 = pre5.history.length;
    const av2 = await ceoCmd({ action: 'available', provider: 'codex' }); await sleep(20000); const s5 = await ceoRead();
    check(5, 'codex marked AVAILABLE (REAL IPC); Claude pid/runId unchanged, no fail-back, no new launch', av2.ok && s5.providers.codex.availability === 'AVAILABLE' && s5.owner?.runId === run2 && s5.owner.provider === 'anthropic' && s5.epoch === pre5.epoch && leads().length === 1 && leads()[0].pid === claudePid && !events(s5).slice(hist5).includes('starting_fresh_session'), { ...brief(s5), pid: claudePid, leads: fmt(leads()) });

    // ---- Step 6: new checkpoint for Claude run once idle, then anthropic quota (SYNTHETIC) -> REAL Codex lead ----
    const ck2 = await waitFor('checkpoint (claude idle)', async () => { const r = await ceoCmd({ action: 'checkpoint', summary: 'Task: reply with exactly the single word OK and nothing else. Do not use any tools, do not create tasks or teammates. (claude checkpoint)', effects: [{ key: 'op-2', outcome: 'confirmed' }] }); if (!r.ok) { log('REAL', 'checkpoint not yet', r.e); return null; } return r.v; }, 180, 4000);
    check(6, 'new checkpoint saved for Claude run (REAL IPC)', !!ck2 && ck2.checkpoint?.runId === run2 && ck2.checkpoint.id !== ckptId, ck2 ? brief(ck2) : null);
    const leadSeen = new Set([...seen.values()].filter((s) => s.lead).map((s) => s.pid)); const pre6 = await ceoRead(); const t6 = Date.now();
    appendSignal(run2, 'anthropic', "You've hit your limit");
    const s6 = await waitFor('codex owner active', async () => { const s = await ceoRead(); log('REAL', 'poll', J(brief(s))); return s.status === 'active' && s.owner && s.owner.provider === 'codex' && s.owner.runId !== run2 ? s : null; }, 240, 3000);
    await sleep(5000); const s6b = await ceoRead(); const ev6 = events(s6b);
    const newCodex = [...seen.values()].filter((s) => s.lead && !leadSeen.has(s.pid) && s.first >= t6 - 500);
    check(6, 'Claude process gone (REAL)', !!seen.get(claudePid)?.gone && !leads().some((s) => s.pid === claudePid), { alive: fmt(alive()) });
    check(6, 'exactly one new Codex lead alive', newCodex.length === 1 && leads().length === 1 /* codex provider child is per-turn, absent while idle (same as step 1) */, { cmd: (newCodex[0]?.cmd || '').replace(/\S*claude-multimodel\.exe/i, 'cm').slice(0, 300), newCodex: fmt(newCodex), leads: fmt(leads()), prov: fmt(providers()) });
    check(6, 'epoch +1 once, owner codex/primary, active, quota_confirmed->starting_fresh_session->owner_committed', !!s6 && s6b.epoch === pre6.epoch + 1 && s6b.owner?.provider === 'codex' && s6b.owner.role === 'primary' && s6b.status === 'active' && hasSeq(ev6.slice(pre6.history.length), ['quota_confirmed', 'starting_fresh_session', 'owner_committed']), brief(s6b));

    // ---- Step 7: kill app with ACTIVE owner, relaunch same userData ----
    const pre7 = await ceoRead(); const preBrief = brief(pre7); const preHist = pre7.history.length;
    log('REAL', 'pre-kill state', J(preBrief), 'procs', fmt(alive()));
    try { c.close(); } catch { /* ignore */ }
    log('REAL', 'taskkill electron pid', epid); try { execFileSync('taskkill', ['/PID', String(epid), '/T', '/F']); } catch (e) { log('WARN', 'taskkill', String(e.message).slice(0, 200)); }
    await sleep(6000);
    const survivors = alive(); log('REAL', 'SURVIVORS after app kill (my run)', fmt(survivors) || 'none');
    check(7, 'app killed with active owner; record survivors', pre7.status === 'active' && !!pre7.owner, { survivors: fmt(survivors) });
    launchApp(); await attach(); log('REAL', 'relaunched same userData, attached');
    await sleep(5000);
    const launchesBefore = leadsEver();
    const r1 = await ceoRead(); await sleep(20000); const r2 = await ceoRead(); const r3 = await ceoRead();
    check(7, 'state persisted (epoch, history, checkpoint, handledRuns)', r1.epoch === pre7.epoch && r1.checkpoint?.id === pre7.checkpoint?.id && r1.history.length >= preHist && r1.handledRuns.length === pre7.handledRuns.length, { pre: preBrief, post: brief(r1) });
    check(7, 'fails closed: blocked with runtime_ownership_unknown or interrupted_handoff', r1.status === 'blocked' && /runtime_ownership_unknown|interrupted_handoff/.test(String(r1.reason)), brief(r1));
    check(7, 'no automatic new launch, no repeated action (history stable)', leadsEver() === launchesBefore && J(r2.history) === J(r1.history) && J(r3.history) === J(r1.history) && !events(r1).slice(preHist).includes('starting_fresh_session'), { post: events(r1).slice(preHist), newLeads: leadsEver() - launchesBefore, leads: fmt(leads()) });
    const inj0 = countInjected(); const epochR = r3.epoch, histR = J(r3.history); const liveRun = pre7.owner?.runId || 'no-owner-run';
    appendSignal(run1, 'codex', detail); appendSignal(run2 || 'no-run2', 'anthropic', "You've hit your limit"); appendSignal(run2 || 'no-run2', 'anthropic', "You've hit your limit"); appendSignal('stale-run-id-0000', 'codex', detail); appendSignal(liveRun, 'codex', detail); await sleep(8000);
    const r4 = await ceoRead();
    check(7, 'stale/duplicate old-runId synthetic lines ignored (delivered, no state change, no launch)', countInjected() - inj0 === 5 && r4.epoch === epochR && J(r4.history) === histR && leadsEver() === launchesBefore, { delivered: countInjected() - inj0, ...brief(r4), leads: fmt(leads()) });
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
    // Names only (no file is opened): the only .credentials.json allowed under .local-tools is the owner-created one in the isolated claude-root.
    const creds = []; (function walk(d, depth) { if (depth > 8) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, depth + 1); } else if (e.name === '.credentials.json') creds.push(p); } })(tools, 0);
    check(8, 'no .credentials.json under .local-tools except the isolated claude-root profile', creds.every((p) => npath(path.dirname(p)) === npath(claudeRoot)), creds);
    // Token-pattern scan of logs produced by this run; prints only counts, never matches.
    const scan = [path.join(tools, 'diagnostics', `app-${tag}.out`), path.join(tools, 'diagnostics', `app-${tag}.err`), logFile, path.join(tools, 'tmp', `launch-${tag}.txt`), ...Object.keys(transcripts()).filter((f) => !baseTranscripts[f])];
    const pats = { eyJ: /eyJ[A-Za-z0-9_-]{8,}/g, 'sk-ant-': /sk-ant-/g, Bearer: /Bearer\s+[A-Za-z0-9._-]{8,}/g, refreshToken: /refreshToken["']?\s*[:=]\s*["'][^"']{8,}/g };
    const hits = {}; for (const f of scan) { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; } for (const [k, re] of Object.entries(pats)) { const n = (t.match(re) || []).length; if (n) hits[path.basename(f) + ':' + k] = n; } }
    check(8, 'no token patterns in new logs/transcripts', Object.keys(hits).length === 0, { scanned: scan.length, hits });
    let still = ''; try { still = ps(`Get-Process -Id ${epid} -ErrorAction SilentlyContinue | % Id`).trim(); } catch { /* */ }
    const unsettled = [...seen.values()].filter((s) => { try { return ps(`Get-Process -Id ${s.pid} -ErrorAction SilentlyContinue | % Id`).trim() === String(s.pid); } catch { return false; } });
    check(8, 'no process of this run left (electron + providers)', !still && unsettled.length === 0, { electron: still, others: fmt(unsettled) });
    log('REAL', 'all pids ever seen', fmt([...seen.values()]));
    console.log('SUMMARY', J({ team, tag, project, results: results.map((r) => `${r.step}:${r.ok === null ? 'NOT-VERIFIED' : r.ok ? 'PASS' : 'FAIL'}:${r.name}`) }));
    process.exit(results.some((r) => r.ok === false) ? 1 : 0);
  }
})();

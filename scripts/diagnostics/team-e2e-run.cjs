// Drive the isolated Electron app over CDP: create a solo-lead team, launch with a trivial prompt,
// observe provider process (pid + redacted command line), lead reply, then stop.
// Usage: node team-e2e-run.cjs --project <abs git dir> --provider codex|anthropic [--model m] [--electron-pid N] [--port 9333] [--claude-root <abs>] [--team name] [--wait-sec 240]
const path = require('path'); const fs = require('fs');
const { execFileSync } = require('child_process');
const { connect } = require('./cdp-eval.cjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const provider = arg('provider'), project = arg('project'), model = arg('model');
const claudeRoot = arg('claude-root'); const port = +arg('port', 9333), epid = +arg('electron-pid', 0), waitSec = +arg('wait-sec', 240);
const team = arg('team', `e2e-${provider}-${Date.now().toString(36)}`);
if (!provider || !project) { console.error('need --provider and --project'); process.exit(2); }
const startIso = new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REDACT = /((?:--?(?:api[-_]?key|token|secret|password|authorization)[= ])|(?:b(?:sk-|ghp_|xox[bp]-)[A-Za-z0-9_-]{12,}))\S*/gi;
function descendants() {
  const ps = `$all=Get-CimInstance Win32_Process; $ids=@(${epid}); $q=@(${epid}); while($q.Count){$c=$q[0];$q=$q[1..($q.Count)];foreach($p in $all|?{$_.ParentProcessId -eq $c}){$ids+=$p.ProcessId;$q+=$p.ProcessId}}; $all|?{$ids -contains $_.ProcessId -and $_.ProcessId -ne ${epid}}|%{ "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CommandLine)" }`;
  try { return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
    .map((l) => { const [pid, ppid, name, ...cmd] = l.split('|'); return { pid: +pid, ppid: +ppid, name, cmd: cmd.join('|').replace(REDACT, '$1***').slice(0, 700) }; }); } catch (e) { return []; }
}
(async () => {
  const c = await connect(port); const J = JSON.stringify; const log = (...a) => console.log(new Date().toISOString(), ...a);
  const call = async (expr) => { const r = await c.ev(`(async()=>{try{return JSON.stringify({ok:true,v:await (${expr})})}catch(e){return JSON.stringify({ok:false,e:String(e&&e.message||e)})}})()`); return JSON.parse(r); };
  const seenProcs = new Map();
  const req = { teamName: team, displayName: team, description: 'throwaway e2e', members: [], cwd: project, providerId: provider, skipPermissions: true,
    prompt: 'Reply with exactly: OK. Then stop. Do not use any tools, do not create tasks, do not spawn teammates.' };
  if (model) req.model = model;
  log('createTeam', J({ ...req, prompt: '<trivial>' }));
  const cr = await call(`window.electronAPI.teams.createTeam(${J(req)})`);
  log('createTeam ->', J(cr).slice(0, 600));
  if (!cr.ok) { c.close(); process.exit(1); }
  const runId = cr.v.runId; let last = '', replied = null, started = Date.now(), final = null;
  while ((Date.now() - started) / 1000 < waitSec) {
    await sleep(3000);
    const st = await call(`window.electronAPI.teams.getProvisioningStatus(${J(runId)})`);
    if (st.ok && st.v) { const s = `${st.v.state}|${st.v.pid ?? ''}|${st.v.message}`; if (s !== last) { log('status', s.slice(0, 200)); last = s; } final = st.v; if (st.v.error) log('error:', st.v.error.slice(0, 400)); }
    for (const p of descendants()) if (!seenProcs.has(p.pid)) { seenProcs.set(p.pid, p); log('proc', p.pid, 'ppid', p.ppid, p.name, p.cmd); }
    // Reply detection from the lead transcript in <claude-root>/projects/*. (teams.getMessagesPage returns
    // TEAM_HISTORY_UNAVAILABLE:listing_failed for a solo lead because <team>/inboxes does not exist.)
    let hit = null;
    if (claudeRoot) { const pd = path.join(claudeRoot, 'projects'); try { for (const d of fs.readdirSync(pd)) for (const f of fs.readdirSync(path.join(pd, d)).filter((x) => x.endsWith('.jsonl'))) for (const l of fs.readFileSync(path.join(pd, d, f), 'utf8').split(String.fromCharCode(10)).filter(Boolean)) { try { const j = JSON.parse(l); if (j.type === 'assistant' && j.timestamp >= startIso && j.cwd && path.resolve(j.cwd).toLowerCase() === path.resolve(project).toLowerCase()) { const t = (j.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''); if (/\bOK\b/.test(t)) hit = { from: 'lead (transcript ' + f + ')', text: t }; } } catch {} } } catch {} }
    if (hit) { replied = { from: hit.from, text: String(hit.text || hit.content).slice(0, 200) }; log('lead reply', J(replied)); break; }
    if (st.ok && st.v && ['failed', 'cancelled'].includes(st.v.state)) break;
  }
  const alive = await call(`window.electronAPI.teams.aliveList()`); log('aliveList', J(alive).slice(0, 300));
  const ag = await call(`window.electronAPI.teams.getTeamAgentRuntime(${J(team)})`); log('agentRuntime', J(ag).slice(0, 800));
  log('procs seen', J([...seenProcs.values()].map((p) => ({ pid: p.pid, name: p.name }))));
  const stop = await call(`window.electronAPI.teams.stop(${J(team)})`); log('stop ->', J(stop).slice(0, 300));
  await sleep(6000);
  const after = descendants().filter((p) => seenProcs.has(p.pid)); log('seen procs still alive after stop', J(after.map((p) => `${p.pid}:${p.name}`)));
  const alive2 = await call(`window.electronAPI.teams.aliveList()`); log('aliveList after stop', J(alive2).slice(0, 300));
  if (final) log('final cliLogsTail', J(String(final.cliLogsTail || '').slice(-1200)), 'assistantOutput', J(String(final.assistantOutput || '').slice(-800)), 'diag', J((final.launchDiagnostics || []).map((d) => d.code + ':' + (d.severity || '')).slice(0, 12)));
  console.log('SUMMARY', J({ team, provider, runId, finalState: final && final.state, replied, procsSeen: seenProcs.size, leftoverAfterStop: after.length }));
  c.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

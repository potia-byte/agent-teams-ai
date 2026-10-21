// Temporarily copy ONLY the Claude subscription OAuth block into an isolated claude root so the
// anthropic provider can authenticate in the sandboxed app. Never prints secrets. Refuses when the
// access token has < 60 min left (a refresh in the copy could rotate the real refresh token).
// Usage: node seed-isolated-claude-auth.cjs seed <isolated-claude-root> | clean <isolated-claude-root>
const fs = require('fs'), path = require('path'), os = require('os');
const [mode, root] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !/[\/]\.local-tools[\/]/.test(root)) { console.error('need absolute isolated root under .local-tools'); process.exit(2); }
const dst = path.join(root, '.credentials.json');
if (mode === 'clean') { fs.rmSync(dst, { force: true }); console.log('removed', dst); process.exit(0); }
const src = path.join(os.homedir(), '.claude', '.credentials.json');
const o = JSON.parse(fs.readFileSync(src, 'utf8')).claudeAiOauth;
const mins = Math.round((o.expiresAt - Date.now()) / 60000);
if (!o || mins < 60) { console.error('token missing or expires in', mins, 'min; refusing'); process.exit(1); }
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(dst, JSON.stringify({ claudeAiOauth: o }), { mode: 0o600 });
console.log('seeded', dst, 'expiresInMin', mins, 'plan', o.subscriptionType);

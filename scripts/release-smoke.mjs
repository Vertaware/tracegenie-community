// Exercises a disposable, loopback-only installation. Never use on a live site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const [phase, base, installation, stateFile, mailBase, mailHost] = process.argv.slice(2);
assert(['initialize', 'verify'].includes(phase), 'Use initialize or verify');
for (const url of [base, mailBase]) assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Only loopback test installations are allowed');
let cookie = '';
let count = 0;
function check(label, fn) { fn(); count++; console.log(`PASS ${label}`); }
async function request(route, { method = 'GET', body, headers = {}, expected = 200 } = {}) {
  const response = await fetch(base + route, { method, headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, expected, `${method} ${route}: ${response.status} ${response.status === expected ? '' : await response.text()}`);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response.headers.get('content-type')?.includes('json') ? response.json() : Buffer.from(await response.arrayBuffer());
}
async function mailMessages() {
  const response = await fetch(mailBase + '/api/v1/messages', { signal: AbortSignal.timeout(5000) });
  assert(response.ok, 'Local SMTP inbox is available');
  return (await response.json()).messages;
}
async function waitForMail(predicate) {
  for (let i = 0; i < 40; i++) {
    for (const summary of await mailMessages()) {
      const message = await fetch(mailBase + '/api/v1/message/' + summary.ID).then(r => r.json());
      if (predicate(message)) return message;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Expected message did not arrive in the isolated SMTP inbox');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let state;
if (phase === 'initialize') {
  const status = await request('/api/installation/status');
  check('fresh installation requires owner setup', () => assert.equal(status.required, true));
  const token = fs.readFileSync(path.join(installation, '.env'), 'utf8').match(/^COMMUNITY_SETUP_TOKEN=(.+)$/m)[1];
  state = { email: 'owner@release.test', password: randomBytes(24).toString('base64url'), reporter: 'reporter@release.test' };
  fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  const setup = { token, name: 'Community Demo', email: state.email, password: state.password, projectName: 'Community' };
  await request('/api/installation/complete', { method: 'POST', body: { ...setup, token: '0'.repeat(64) }, expected: 403 });
  await request('/api/installation/complete', { method: 'POST', body: setup, expected: 201 });
  await request('/api/installation/complete', { method: 'POST', body: setup, expected: 409 });
  check('owner setup rejects invalid tokens and cannot be reclaimed', () => assert(cookie));
  const saved = await request('/api/admin/settings/email', { method: 'PUT', body: { revision: null, provider: 'smtp', host: mailHost, port: 1025, secure: false, user: '', fromName: 'Community', fromEmail: 'updates@release.test', replyTo: 'support@release.test' } });
  state.emailRevision = saved.settings.revision;
  await request('/api/admin/settings/email/test', { method: 'POST', body: { revision: saved.settings.revision } });
  await waitForMail(m => m.To.some(to => to.Address === state.email));
  check('saved email configuration sends to the local SMTP inbox', () => assert(saved.settings.configured));
  const session = await request('/api/projects/public/community/hosted-session', { method: 'POST', body: { origin: base } });
  const headers = { 'x-tracegenie-widget-session': session.token };
  const screenshot = path.resolve('docs/images/report-form.png');
  const png = fs.existsSync(screenshot) ? fs.readFileSync(screenshot) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9kAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.set('projectKey', 'community'); form.set('kind', 'screenshot');
  form.set('file', new Blob([png], { type: 'image/png' }), 'reported-screen.png');
  const upload = await request('/api/public/uploads', { method: 'POST', body: form, headers, expected: 201 });
  state.attachmentId = upload.attachment.id; state.screenshotHash = sha(png);
  const body = {
    projectKey: 'community', clientSubmissionId: randomUUID(), title: 'Screenshot stays attached when I return to my report',
    description: 'Please keep the screenshot and conversation together when I return to this report. This is synthetic release demonstration data.',
    issueType: 'bug', severity: 'medium', stepsToReproduce: 'Send a report with a screenshot. Return to the report after restarting the app.',
    expectedResult: 'The original screenshot and all replies are still available.', actualResult: 'Verifying that the evidence survives a restart and a backup restoration.',
    route: { url: base + '/feedback/', pageTitle: 'Community feedback' },
    release: { appName: 'Community', appEnvironment: 'production', appVersion: '0.1.0' },
    browser: { userAgent: 'TraceGenie release acceptance', browserName: 'Release verification', viewportWidth: 1440, viewportHeight: 900 },
    currentUser: { name: 'Demo Reporter', email: state.reporter }, clientTimestamp: new Date().toISOString(), attachmentTokens: [upload.uploadToken],
  };
  const submission = await request('/api/public/feedback', { method: 'POST', body, headers, expected: 201 });
  state.id = submission.feedback.id;
  const replay = await request('/api/public/feedback', { method: 'POST', body, headers, expected: 201 });
  check('report submission is idempotent and has a reporter link', () => { assert.equal(replay.feedback.id, state.id); assert(submission.feedback.trackingUrl); });
  const statusReply = 'We have received your report and are investigating the screenshot behavior.';
  await request('/api/admin/feedback/' + state.id + '/status', { method: 'PATCH', body: { status: 'triaged', publicSummary: statusReply, notifyRequester: true, statusNote: { body: statusReply, visibility: 'public', clientRequestId: randomUUID() } } });
  const reply = 'Thanks for the screenshot. We have reproduced this and are checking the fix.';
  await request('/api/admin/feedback/' + state.id + '/comments', { method: 'POST', body: { body: reply, visibility: 'public', notifyRequester: true, deliveryTarget: 'requester_and_subscribers', clientRequestId: randomUUID() }, expected: 201 });
  await waitForMail(m => m.To.some(to => to.Address === state.reporter) && (m.Text + m.HTML).includes('Thanks for the screenshot'));
  check('triage and public reply deliver through the worker', () => assert(state.id));
  await request('/api/reporter/otp/request', { method: 'POST', body: { email: state.reporter } });
  const otp = await waitForMail(m => m.To.some(to => to.Address === state.reporter) && /\b\d{6}\b/.test(m.Text));
  const code = otp.Text.match(/\b\d{6}\b/)[0];
  const reporter = await request('/api/reporter/otp/verify', { method: 'POST', body: { email: state.reporter, code } });
  state.reporterToken = reporter.token;
  await request(`/api/reporter/tickets/${state.id}/comments`, { method: 'POST', headers: { Authorization: 'Bearer ' + reporter.token }, body: { body: 'Thank you. I can still see the screenshot and this reply.', clientRequestId: 'reporter-comment:' + randomUUID() }, expected: 201 });
  check('reporter authenticates with an emailed code and replies', () => assert(reporter.token));
  fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
} else {
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  await request('/api/auth/login', { method: 'POST', body: { email: state.email, password: state.password } });
}
const detail = (await request('/api/admin/feedback/' + state.id)).feedback;
check('report and triage state persist', () => { assert.equal(detail.id, state.id); assert.equal(detail.status, 'triaged'); });
check('screenshot bytes persist', () => assert(detail.attachments.some(a => a.id === state.attachmentId)));
const png = await request('/api/admin/attachments/' + state.attachmentId);
check('downloaded screenshot exactly matches the original', () => assert.equal(sha(png), state.screenshotHash));
const anonymous = await fetch(base + '/api/admin/attachments/' + state.attachmentId);
check('anonymous attachment access is denied', () => assert.equal(anonymous.status, 401));
const conversation = await request(`/api/admin/feedback/${state.id}/conversation`);
check('both sides of the conversation persist', () => { assert(conversation.items.some(c => c.body.startsWith('Thanks for the screenshot'))); assert(conversation.items.some(c => c.body.startsWith('Thank you. I can still'))); });
const ticket = await request(`/api/reporter/tickets/${state.id}`, { headers: { Authorization: 'Bearer ' + state.reporterToken } });
check('reporter session remains valid', () => assert.equal(ticket.ticket.id, state.id));
const email = (await request('/api/admin/settings/email')).settings;
check('saved email settings survive without leaking credentials', () => { assert.equal(email.revision, state.emailRevision); assert.equal(email.source, 'settings'); assert(!('credential' in email)); });
check('owner setup remains closed', () => assert.equal(detail.project.key, 'community'));
assert.equal((await request('/api/installation/status')).required, false);
for (const route of ['/issues', '/feedback/?projectKey=community&mode=feedback', '/widget/embed.js']) {
  const resource = await request(route);
  check('production asset ' + route, () => assert(resource.length > 100));
}
const browserConfig = await fetch(base + '/api/projects/public/community/hosted-config', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
check('same-origin browser GET works without an Origin header', () => assert.equal(browserConfig.status, 200));
const foreignConfig = await fetch(base + '/api/projects/public/community/hosted-config', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
check('missing or foreign browser origin remains rejected', () => assert.equal(foreignConfig.status, 403));
const config = await request('/api/projects/public/community/hosted-config');
check('first-party origin works after restore', () => assert.equal(config.key, 'community'));
console.log(`Release ${phase}: ${count} checks passed.`);

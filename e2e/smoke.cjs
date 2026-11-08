// End-to-end smoke test: the built app in Chromium, with the GitHub REST API faked in memory.
// Usage: see README ("End-to-end smoke test"). The build must use VITE_OAUTH_EXCHANGE_URL=https://auth.test
const { chromium } = require('playwright');
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const SHOTS = process.env.SHOTS_DIR || require('path').join(require('os').tmpdir(), 'contract-hub-e2e');
require('fs').mkdirSync(SHOTS, { recursive: true });

const blobs = new Map();
const sha = (t) => { const h = crypto.createHash('sha1').update(t).digest('hex'); blobs.set(h, t); return h; };

const openapi = `openapi: 3.0.3
info:
  title: Orders API
  version: 1.0.0
paths:
  /orders/{id}:
    get:
      operationId: getOrder
      tags: [orders]
      summary: Get an order
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
components:
  schemas:
    Order:
      type: object
      required: [id]
      properties:
        id: { type: string, description: Order id }
        total: { type: number }
`;
const asyncapi = JSON.stringify({
  asyncapi: '3.0.0',
  info: { title: 'Order Events', version: '1.0.0' },
  channels: { orderCreated: { address: 'orders.created', messages: { OrderCreated: { $ref: '#/components/messages/OrderCreated' } } } },
  operations: { publishOrderCreated: { action: 'send', channel: { $ref: '#/channels/orderCreated' }, summary: 'Emitted when an order is placed' } },
  components: { messages: { OrderCreated: { name: 'OrderCreated', contentType: 'application/json', payload: { type: 'object', properties: { orderId: { type: 'string' } } } } } },
}, null, 2) + '\n';

const repos = {
  'acme/hub-state': { default: 'main', branches: { main: {} }, prs: [] },
  'acme/orders': {
    default: 'main',
    branches: { main: { 'api/openapi.yaml': openapi, 'events/asyncapi.json': asyncapi, 'package.json': '{"name":"x"}', 'src/index.ts': 'x' } },
    prs: [],
  },
};
const log = [];

function handle(method, url, body) {
  const u = new URL(url);
  const p = decodeURIComponent(u.pathname);
  let m;
  if (p === '/user') return [200, { login: 'alice', name: 'Alice', avatar_url: '' }];
  if ((m = p.match(/^\/users\/([^/]+)$/))) return m[1] === 'ghost' ? [404, { message: 'Not Found' }] : [200, { login: m[1] }];
  if (!(m = p.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/))) return [404, { message: 'Not Found' }];
  const repo = repos[m[1]];
  const rest = m[2] || '';
  if (!repo) return [404, { message: 'Not Found' }];
  if (rest === '') return [200, { default_branch: repo.default, description: 'Demo repo', private: true, html_url: `https://github.com/${m[1]}`, permissions: { push: true, admin: true } }];
  if (rest === '/branches') return [200, Object.keys(repo.branches).map((name) => ({ name }))];
  let mm;
  if ((mm = rest.match(/^\/contents\/(.+)$/))) {
    const path = mm[1];
    if (method === 'GET') {
      const files = repo.branches[u.searchParams.get('ref') || repo.default];
      if (!files || files[path] === undefined) return [404, { message: 'Not Found' }];
      const t = files[path];
      return [200, { type: 'file', sha: sha(t), size: t.length, content: Buffer.from(t).toString('base64'), encoding: 'base64' }];
    }
    if (method === 'PUT') {
      const files = repo.branches[body.branch || repo.default];
      const existing = files[path];
      if (existing !== undefined && body.sha !== sha(existing)) return [409, { message: 'sha mismatch' }];
      if (existing === undefined && body.sha) return [409, { message: 'sha mismatch' }];
      const t = Buffer.from(body.content, 'base64').toString('utf8');
      files[path] = t;
      log.push(`commit ${m[1]}@${body.branch || repo.default}:${path} — ${body.message.split('\n')[0]}`);
      return [existing === undefined ? 201 : 200, { content: { sha: sha(t) }, commit: { sha: 'c' + Date.now() } }];
    }
  }
  if ((mm = rest.match(/^\/git\/trees\/(.+)$/))) {
    const files = repo.branches[mm[1]];
    if (!files) return [404, { message: 'Not Found' }];
    return [200, { sha: 'tree-' + mm[1], truncated: false, tree: Object.entries(files).map(([path, t]) => ({ path, type: 'blob', sha: sha(t), size: t.length })) }];
  }
  if ((mm = rest.match(/^\/git\/blobs\/(.+)$/))) return [200, { content: Buffer.from(blobs.get(mm[1])).toString('base64'), encoding: 'base64' }];
  if ((mm = rest.match(/^\/git\/ref\/heads\/(.+)$/))) return repo.branches[mm[1]] ? [200, { object: { sha: 'head-' + mm[1] } }] : [404, {}];
  if (rest === '/git/refs' && method === 'POST') {
    const name = body.ref.replace('refs/heads/', '');
    const from = body.sha.replace('head-', '');
    repo.branches[name] = { ...repo.branches[from] };
    log.push(`branch ${m[1]}:${name} from ${from}`);
    return [201, {}];
  }
  if (rest === '/pulls' && method === 'GET') {
    const head = u.searchParams.get('head');
    const list = repo.prs.filter((pr) => !head || `${m[1].split('/')[0]}:${pr.head.ref}` === head);
    return [200, list];
  }
  if (rest === '/pulls' && method === 'POST') {
    const pr = { number: repo.prs.length + 1, title: body.title, body: body.body, html_url: `https://github.com/${m[1]}/pull/${repo.prs.length + 1}`, head: { ref: body.head }, user: { login: 'alice' }, updated_at: new Date().toISOString() };
    repo.prs.push(pr);
    log.push(`PR #${pr.number} ${body.head} -> ${body.base}: ${body.title}`);
    return [201, pr];
  }
  if ((mm = rest.match(/^\/collaborators\/(.+)$/)) && method === 'PUT') { log.push(`collaborator ${mm[1]} on ${m[1]}`); return [201, {}]; }
  return [404, { message: 'unhandled ' + method + ' ' + p }];
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => msg.type() === 'error' && !/Failed to load resource/.test(msg.text()) && errors.push('console: ' + msg.text()));
  page.on('dialog', (d) => d.accept());
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const [status, json] = handle(req.method(), req.url(), req.postData() ? JSON.parse(req.postData()) : null);
    if (status === 404 && json.message?.startsWith('unhandled')) errors.push(json.message);
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) });
  });
  await page.route('https://github.com/**', (r) => r.fulfill({ status: 404, body: '' }));
  // Fake GitHub's OAuth consent page: approve immediately and send the user back with a code.
  let authorizeParams = null;
  await page.route('https://github.com/login/oauth/authorize?**', (r) => {
    authorizeParams = new URL(r.request().url()).searchParams;
    const back = new URL(authorizeParams.get('redirect_uri'));
    back.searchParams.set('code', 'test-code');
    back.searchParams.set('state', authorizeParams.get('state'));
    return r.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  // Fake auth-worker: check PKCE and hand out a token.
  await page.route('https://auth.test/**', async (r) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(r.request().postData() || '{}');
    const challenge = crypto.createHash('sha256').update(body.code_verifier || '').digest('base64url');
    const ok = body.code === 'test-code' && authorizeParams && challenge === authorizeParams.get('code_challenge');
    return r.fulfill({ status: ok ? 200 : 400, contentType: 'application/json', headers: cors, body: JSON.stringify(ok ? { access_token: 'gho_test' } : { error: 'bad_verification_code' }) });
  });

  const step = async (name, fn) => {
    try { await fn(); console.log('✓', name); }
    catch (e) { console.log('✗', name, '\n   ', e.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, '_')}.png`, fullPage: true }); throw e; }
  };
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

  try {
    await page.goto(BASE + '/');
    await step('sign in', async () => {
      await page.fill('input[placeholder="owner/name"]', 'acme/hub-state');
      await shot('01-signin');
      await page.click('button:has-text("Sign in with GitHub")');
      await page.waitForSelector('text=Set up Contract Hub');
      if (new URL(page.url()).search) throw new Error('OAuth code left in URL: ' + page.url());
    });
    await step('initialize workspace', async () => {
      await page.click('button:has-text("Initialize workspace")');
      await page.waitForSelector('text=No projects yet');
      if (!repos['acme/hub-state'].branches.main['contract-hub.json'].includes('"alice"')) throw new Error('state not written');
    });
    await step('add repository', async () => {
      await page.fill('.add-project input', 'https://github.com/acme/orders');
      await page.click('button:has-text("Add repository")');
      await page.waitForSelector('.project-card');
      const txt = await page.textContent('.project-card');
      if (!/1\s*OpenAPI/.test(txt) || !/1\s*AsyncAPI/.test(txt)) throw new Error('counts wrong: ' + txt);
      await shot('02-projects');
    });
    await step('overview shows endpoints and async operations', async () => {
      await page.click('.project-card');
      await page.waitForSelector('td.mono:has-text("/orders/{id}")');
      await page.waitForSelector('td.mono:has-text("orders.created")');
      await shot('03-overview');
    });
    await step('admin grants edit rights', async () => {
      await page.click('.tabs button:has-text("Access")');
      await page.fill('input[placeholder="GitHub username"]', 'bob');
      await page.click('button:has-text("Give edit rights")');
      await page.waitForSelector('.user-list >> text=bob');
      const st = JSON.parse(repos['acme/hub-state'].branches.main['contract-hub.json']);
      if (!st.projects[0].editors.includes('bob')) throw new Error('editor not persisted');
      await page.fill('input[placeholder="GitHub username"]', 'ghost');
      await page.click('button:has-text("Give edit rights")');
      await page.waitForSelector('text=does not exist');
      await shot('04-access');
    });
    await step('edit opens branch dialog and creates feature branch', async () => {
      await page.click('.tabs button:has-text("Contracts")');
      await page.locator('.contract-card', { hasText: 'Orders API' }).locator('button:has-text("Edit contract")').click();
      await page.waitForSelector('dialog >> text=Choose a feature branch');
      await page.fill('dialog input', 'feature/add-create-order');
      await shot('05-branch');
      await page.click('dialog button:has-text("Create branch & continue")');
      await page.waitForSelector('.editor-page');
      if (!repos['acme/orders'].branches['feature/add-create-order']) throw new Error('branch not created');
    });
    await step('add endpoint with path param auto-declared', async () => {
      await page.click('button:has-text("+ New endpoint")');
      await page.selectOption('dialog select', 'post');
      await page.fill('dialog input.mono', '/customers/{customerId}/orders');
      await page.fill('dialog >> label:has-text("Summary") >> input', 'Place an order');
      await page.click('dialog button:has-text("Create endpoint")');
      await page.waitForSelector('.list-pane button.active:has-text("/customers/{customerId}/orders")');
      await page.waitForSelector('.props-table input[value="customerId"]');
    });
    await step('add request body with fields', async () => {
      await page.click('button:has-text("+ Add request body")');
      const body = page.locator('section.card', { hasText: 'Request body' });
      await body.locator('button:has-text("+ Add field")').click();
      await body.locator('.props-table .commit-input input').first().fill('quantity');
      await body.locator('.props-table .commit-input input').first().press('Enter');
      await body.locator('.props-table tbody tr').first().locator('select').first().selectOption('integer');
      await body.locator('.props-table tbody tr').first().locator('input[type=checkbox]').check();
      await shot('06-endpoint-editor');
    });
    await step('rename data model updates refs', async () => {
      await page.click('.editor-nav button:has-text("Data models")');
      await page.click('.list-pane button:has-text("Order")');
      const name = page.locator('label:has-text("Model name") input');
      await name.fill('PurchaseOrder');
      await name.press('Enter');
      await page.waitForSelector('.list-pane button:has-text("PurchaseOrder")');
      await shot('07-schemas');
      await page.click('.editor-nav button:has-text("Raw file")');
      const raw = await page.inputValue('.raw-editor');
      if (!raw.includes("#/components/schemas/PurchaseOrder")) throw new Error('ref not renamed');
      if (!raw.includes('quantity')) throw new Error('field missing');
    });
    await step('undo / redo', async () => {
      await page.click('button:has-text("Undo")');
      let raw = await page.inputValue('.raw-editor');
      if (raw.includes('PurchaseOrder')) throw new Error('undo did not revert rename');
      await page.click('button:has-text("Redo")');
      raw = await page.inputValue('.raw-editor');
      if (!raw.includes('PurchaseOrder')) throw new Error('redo failed');
    });
    await step('review & save commits to the feature branch', async () => {
      await page.click('button:has-text("Review & save")');
      await page.waitForSelector('dialog >> text=What changed');
      await page.click('dialog button:has-text("Show file changes")');
      await shot('08-save');
      await page.click('dialog button:has-text("Save to feature/add-create-order")');
      await page.waitForSelector('text=Saved to feature/add-create-order');
      const saved = repos['acme/orders'].branches['feature/add-create-order']['api/openapi.yaml'];
      if (!saved.includes('/customers/{customerId}/orders') || !saved.includes('PurchaseOrder')) throw new Error('commit content wrong');
      if (repos['acme/orders'].branches.main['api/openapi.yaml'] !== openapi) throw new Error('main was modified!');
    });
    await step('request review opens a PR', async () => {
      await page.click('button:has-text("Request review")');
      await page.waitForSelector('dialog >> text=Changes compared to');
      await shot('09-pr');
      await page.click('dialog button:has-text("Create pull request")');
      await page.waitForSelector('a:has-text("Pull request #1")');
    });
    await step('asyncapi editor: add message + attach to channel + save', async () => {
      await page.goto(BASE + '/#/p/acme/orders?branch=feature%2Fadd-create-order');
      await page.locator('.contract-card', { hasText: 'Order Events' }).locator('button:has-text("Edit contract")').click();
      await page.waitForSelector('.editor-nav button.active:has-text("Channels")');
      await page.click('.editor-nav button:has-text("Messages")');
      await page.click('button:has-text("+ New message")');
      const id = page.locator('label:has-text("Message id") input');
      await id.fill('OrderCancelled');
      await id.press('Enter');
      await page.click('.editor-nav button:has-text("Channels")');
      await page.locator('label.checkbox', { hasText: 'OrderCancelled' }).locator('input').check();
      await page.click('.editor-nav button:has-text("Operations")');
      await shot('10-async-ops');
      await page.click('button:has-text("Review & save")');
      await page.click('dialog button:has-text("Save to")');
      await page.waitForSelector('text=Saved to');
      const saved = JSON.parse(repos['acme/orders'].branches['feature/add-create-order']['events/asyncapi.json']);
      if (!saved.channels.orderCreated.messages.OrderCancelled) throw new Error('channel message missing');
      if (repos['acme/orders'].branches['feature/add-create-order']['events/asyncapi.json'].split('\n')[1].indexOf('  "') !== 0) throw new Error('indent lost');
    });
    await step('direct edit on default branch is blocked', async () => {
      await page.goto(BASE + '/#/p/acme/orders/edit?path=api%2Fopenapi.yaml&branch=main');
      await page.waitForSelector('text=Editing directly on main is not allowed');
    });
    await step('overview on branch reflects saved changes', async () => {
      await page.goto(BASE + '/#/p/acme/orders?branch=feature%2Fadd-create-order');
      await page.waitForSelector('td.mono:has-text("/customers/{customerId}/orders")');
      await page.click('.tabs button:has-text("Pull requests")');
      await page.waitForSelector('td.mono:has-text("feature/add-create-order")'); await shot('11-prs');
    });
  } finally {
    console.log('\nGitHub side effects:\n  ' + log.join('\n  '));
    console.log(errors.length ? '\nBrowser errors:\n  ' + errors.join('\n  ') : '\nNo browser errors.');
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });

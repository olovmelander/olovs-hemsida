/* Banvy Cloudflare Worker entrypoint.
   - /api/health      : lightweight capability check (Google OAuth / dev mode)
   - /api/auth/*      : Better Auth (Google OAuth + session management in D1)
   - /api/dev-login   : localhost-only test golfer login when ALLOW_DEV_AUTH=true
   - /api/sync        : authenticated offline-first round/shot/bag/handicap sync
   - /api/player      : authenticated summary of the signed-in golfer's cloud data
   - everything else  : served by Cloudflare Static Assets (apps/golf/dist) */
import { Hono } from 'hono';
import { createAuth, isGoogleConfigured, isLocalDevAuthEnabled, resolveBaseURL } from './auth.mjs';
import { mergeSyncState, validateSyncPayload } from './sync-logic.mjs';
import { loadUserState, persistDirtyState } from './sync-repo.mjs';
import { changeLiveRound, listLiveRounds, liveMutation } from './live-rounds.mjs';

const app = new Hono();

const NO_STORE = { 'Cache-Control': 'no-store' };

app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.get('/api/health', c => {
  return c.json({
    ok: true,
    google: isGoogleConfigured(c.env),
    devAuth: isLocalDevAuthEnabled(c.env, c.req.raw),
  }, 200, NO_STORE);
});

/* Localhost-only convenience endpoint so you can test Better Auth sessions +
   D1 player sync before registering Google Cloud OAuth credentials. */
app.post('/api/dev-login', async c => {
  if (!isLocalDevAuthEnabled(c.env, c.req.raw)) {
    return c.json({ error: 'Not found' }, 404, NO_STORE);
  }
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' && body.email.includes('@')
    ? body.email.trim().toLowerCase()
    : 'testgolfare@banvy.local';
  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 64)
    : 'Testgolfare';
  const password = 'banvy-local-dev-password';
  const auth = createAuth(c.env, c.req.raw);
  const baseURL = resolveBaseURL(c.env, c.req.raw);

  // Try sign-in first; if this local dev user doesn't exist yet, sign up.
  const tryEndpoint = (path, payload) => auth.handler(new Request(`${baseURL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseURL },
    body: JSON.stringify(payload),
  }));

  let res = await tryEndpoint('/api/auth/sign-in/email', { email, password });
  if (!res.ok) {
    res = await tryEndpoint('/api/auth/sign-up/email', { email, password, name });
  }
  return res;
});

app.all('/api/auth/*', c => {
  const auth = createAuth(c.env, c.req.raw);
  return auth.handler(c.req.raw);
});

async function requireSession(c) {
  const auth = createAuth(c.env, c.req.raw);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) return null;
  return session;
}

app.get('/api/active-rounds', async c => {
  const session = await requireSession(c);
  if (!session) return c.json({ error: 'Inte inloggad.' }, 401);
  if (c.req.header('X-Banvy-User') !== session.user.id) return c.json({ error: 'Kontot har bytts.' }, 409);
  return c.json({ rounds: await listLiveRounds(c.env.DB, session.user.id) });
});

app.post('/api/active-rounds', async c => {
  const session = await requireSession(c);
  if (!session) return c.json({ error: 'Inte inloggad.' }, 401);
  if (c.req.header('X-Banvy-User') !== session.user.id) return c.json({ error: 'Kontot har bytts.' }, 409);
  if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) return c.json({ error: 'JSON krävs.' }, 415);
  const raw = await c.req.text();
  if (raw.length > 750000) return c.json({ error: 'Rundan är för stor.' }, 413);
  let input;
  try { input = liveMutation(JSON.parse(raw)); } catch { /* malformed card */ }
  if (!input) return c.json({ error: 'Rundan kunde inte läsas.' }, 400);
  const result = await changeLiveRound(c.env.DB, session.user.id, input);
  return c.json(result, result.accepted ? 200 : 409);
});

app.get('/api/player', async c => {
  const session = await requireSession(c);
  if (!session) return c.json({ error: 'Inte inloggad.' }, 401, NO_STORE);
  const state = await loadUserState(c.env.DB, session.user.id);
  const activeRounds = state.rounds.filter(r => !r.deletedAt);
  const activeShots = state.shotSets
    .filter(s => !s.deletedAt)
    .reduce((sum, s) => sum + s.shots.length, 0);
  return c.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    profile: state.profile,
    roundCount: activeRounds.length,
    shotCount: activeShots,
  }, 200, NO_STORE);
});

app.post('/api/sync', async c => {
  const session = await requireSession(c);
  if (!session) return c.json({ error: 'Inte inloggad.' }, 401, NO_STORE);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Ogiltig JSON.' }, 400, NO_STORE);
  }

  if (body?.expectedUserId != null && body.expectedUserId !== session.user.id) {
    return c.json({ error: 'Kontot har bytts. Kontrollera inloggningen.' }, 409, NO_STORE);
  }
  const parsed = validateSyncPayload(body);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400, NO_STORE);
  }

  const now = Date.now();
  const serverState = await loadUserState(c.env.DB, session.user.id);
  const { syncedAt, dirty } = mergeSyncState(serverState, parsed.payload, now);

  let canonical = serverState;
  if (dirty.profile || dirty.rounds.length || dirty.shotSets.length) {
    await persistDirtyState(c.env.DB, session.user.id, dirty, now);
    canonical = await loadUserState(c.env.DB, session.user.id);
  }

  return c.json({
    syncedAt, ...canonical,
  }, 200, NO_STORE);
});

app.all('/api/*', c => c.json({ error: 'Not found' }, 404, NO_STORE));

app.all('*', c => {
  if (c.env?.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text('Not found', 404);
});

export default app;

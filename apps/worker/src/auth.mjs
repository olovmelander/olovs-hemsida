/* Request-scoped Better Auth factory for Cloudflare Workers + D1.
   Bindings (env.DB, secrets) are per-request in Workers, so createAuth(env, req)
   builds a fresh instance with Drizzle over D1. */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './db/schema.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function isLocalRequest(request) {
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function isGoogleConfigured(env) {
  return Boolean(env?.GOOGLE_CLIENT_ID?.trim() && env?.GOOGLE_CLIENT_SECRET?.trim());
}

/* Strictly localhost + explicit ALLOW_DEV_AUTH=true (.dev.vars only).
   Impossible to trigger in Cloudflare production deployments. */
export function isLocalDevAuthEnabled(env, request) {
  return env?.ALLOW_DEV_AUTH === 'true' && isLocalRequest(request);
}

/* Resolve the public origin the browser sees. When Vite proxies /api to :8787
   we honor X-Forwarded-Host/Proto on localhost or BETTER_AUTH_URL so OAuth
   callback URLs and cookies match the browser origin. */
export function resolveBaseURL(env, request) {
  if (env?.BETTER_AUTH_URL?.trim()) return env.BETTER_AUTH_URL.trim().replace(/\/+$/, '');
  const url = new URL(request.url);
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto');
  if (fwdHost && isLocalRequest(request)) {
    return `${fwdProto || url.protocol.replace(':', '')}://${fwdHost}`;
  }
  return url.origin;
}

export function createAuth(env, request) {
  const db = drizzle(env.DB, { schema });
  const baseURL = resolveBaseURL(env, request);
  const requestOrigin = new URL(request.url).origin;
  const trustedOrigins = new Set([baseURL, requestOrigin]);
  if (isLocalRequest(request)) {
    trustedOrigins.add('http://localhost:5173');
    trustedOrigins.add('http://127.0.0.1:5173');
    trustedOrigins.add('http://localhost:8787');
    trustedOrigins.add('http://127.0.0.1:8787');
  }

  const socialProviders = {};
  if (isGoogleConfigured(env)) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID.trim(),
      clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
      prompt: 'select_account',
    };
  }

  const devAuth = isLocalDevAuthEnabled(env, request);

  return betterAuth({
    appName: 'Banvy',
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [...trustedOrigins],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    socialProviders,
    emailAndPassword: {
      enabled: devAuth,
      requireEmailVerification: false,
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days — a golfer shouldn't have to sign in every weekend
      updateAge: 60 * 60 * 24,      // refresh session daily while active
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },
  });
}

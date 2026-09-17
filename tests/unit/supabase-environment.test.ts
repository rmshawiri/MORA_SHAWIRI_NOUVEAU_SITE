/**
 * Séparation DEV / PROD.
 *
 * La règle « ne jamais utiliser la base de production comme environnement de
 * test » n'a de valeur que si une configuration fautive échoue. Ce test vérifie
 * les huit combinaisons contexte × projet, et le comportement en l'absence de
 * configuration — cas du site vitrine actuel, qui doit continuer de fonctionner.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeEnvironmentMismatch,
  getRuntimeEnvironment,
  getSupabasePublicConfig,
  getSupabasePublicConfigSafe,
  isSupabaseConfigured,
  type RuntimeEnvironment,
  type SupabaseEnvironment,
} from '../../src/lib/supabase/environment';

const KEYS = [
  'NEXT_PUBLIC_VERCEL_ENV',
  'VERCEL_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ENV',
] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string>>, run: () => void) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }

  try {
    run();
  } finally {
    for (const key of KEYS) {
      const previous = saved[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}

const CONFIGURED = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://exemple-dev.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_exemple',
};

test('le contexte est « local » hors de Vercel', () => {
  withEnv({}, () => {
    assert.equal(getRuntimeEnvironment(), 'local');
  });
});

test('le contexte suit NEXT_PUBLIC_VERCEL_ENV puis VERCEL_ENV', () => {
  withEnv({ NEXT_PUBLIC_VERCEL_ENV: 'preview' }, () => {
    assert.equal(getRuntimeEnvironment(), 'preview');
  });

  withEnv({ VERCEL_ENV: 'production' }, () => {
    assert.equal(getRuntimeEnvironment(), 'production');
  });

  withEnv({ NEXT_PUBLIC_VERCEL_ENV: 'nimporte-quoi' }, () => {
    assert.equal(getRuntimeEnvironment(), 'local');
  });
});

test('le projet de production est refusé partout sauf en production', () => {
  const nonProduction: RuntimeEnvironment[] = ['preview', 'development', 'local'];

  for (const runtime of nonProduction) {
    const mismatch = describeEnvironmentMismatch(runtime, 'prod');
    assert.ok(mismatch, `« ${runtime} » + projet prod aurait dû être refusé`);
    assert.match(mismatch!, /production/);
  }

  assert.equal(describeEnvironmentMismatch('production', 'prod'), null);
});

test('la production refuse le projet de développement', () => {
  const mismatch = describeEnvironmentMismatch('production', 'dev');
  assert.ok(mismatch);
  assert.match(mismatch!, /développement/);
});

test('les contextes hors production acceptent le projet de développement', () => {
  const allowed: RuntimeEnvironment[] = ['preview', 'development', 'local'];
  for (const runtime of allowed) {
    assert.equal(describeEnvironmentMismatch(runtime, 'dev'), null);
  }
});

test('aucun message d\'erreur ne transporte d\'URL ni de clé', () => {
  const runtimes: RuntimeEnvironment[] = ['production', 'preview', 'development', 'local'];
  const environments: SupabaseEnvironment[] = ['dev', 'prod'];

  for (const runtime of runtimes) {
    for (const environment of environments) {
      const message = describeEnvironmentMismatch(runtime, environment);
      if (!message) continue;
      assert.ok(!message.includes('supabase.co'), 'une URL a fuité dans le message');
      assert.ok(!/sb_(publishable|secret)_/.test(message), 'une clé a fuité dans le message');
    }
  }
});

test('sans configuration Supabase, la lecture renvoie null sans lever', () => {
  withEnv({}, () => {
    assert.equal(getSupabasePublicConfig(), null);
    assert.equal(isSupabaseConfigured(), false);
  });
});

test('une configuration sans NEXT_PUBLIC_SUPABASE_ENV est refusée', () => {
  withEnv({ ...CONFIGURED }, () => {
    assert.throws(() => getSupabasePublicConfig(), /NEXT_PUBLIC_SUPABASE_ENV/);
    assert.equal(getSupabasePublicConfigSafe(), null);
  });
});

test('une prévisualisation pointant vers la production lève', () => {
  withEnv(
    { ...CONFIGURED, NEXT_PUBLIC_SUPABASE_ENV: 'prod', NEXT_PUBLIC_VERCEL_ENV: 'preview' },
    () => {
      assert.throws(() => getSupabasePublicConfig(), /production/);
    },
  );
});

test('un poste de travail pointant vers la production lève', () => {
  withEnv({ ...CONFIGURED, NEXT_PUBLIC_SUPABASE_ENV: 'prod' }, () => {
    assert.throws(() => getSupabasePublicConfig(), /production/);
  });
});

test('une configuration cohérente est acceptée', () => {
  withEnv({ ...CONFIGURED, NEXT_PUBLIC_SUPABASE_ENV: 'dev' }, () => {
    const config = getSupabasePublicConfig();
    assert.equal(config?.environment, 'dev');
    assert.equal(config?.url, CONFIGURED.NEXT_PUBLIC_SUPABASE_URL);
    assert.equal(isSupabaseConfigured(), true);
  });

  withEnv(
    { ...CONFIGURED, NEXT_PUBLIC_SUPABASE_ENV: 'prod', NEXT_PUBLIC_VERCEL_ENV: 'production' },
    () => {
      assert.equal(getSupabasePublicConfig()?.environment, 'prod');
    },
  );
});

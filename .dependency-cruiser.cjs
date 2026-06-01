/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // === Global Rules ===

    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are not allowed',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-test-in-prod',
      severity: 'error',
      comment: 'Production code must not import test code',
      from: { pathNot: '^tests/' },
      to: { path: '^tests/' },
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      comment:
        'Production code must not use devDependencies (bundled deps are OK — tsdown inlines them at build time)',
      from: { path: '^src/' },
      to: {
        dependencyTypes: ['npm-dev'],
        pathNot: [
          'tsx',
          'commander',
          'remeda',
          'ts-pattern',
          'neverthrow',
          'picocolors',
        ],
      },
    },

    // === Vertical Slice Rules ===

    {
      name: 'slices-no-cross-import',
      severity: 'error',
      comment:
        'Slice commands must not import from other slice commands (_shared is OK)',
      from: { path: '^src/slices/([^/]+)/' },
      to: { path: '^src/slices/(?!_shared/|\\1/)' },
    },

    {
      name: 'slices-only-to-domain-infra-shared',
      severity: 'error',
      comment:
        'Slices should only import from domain/, infra/, shared/, _shared/',
      from: { path: '^src/slices/' },
      to: {
        path: '^src/',
        pathNot: [
          '^src/slices/', // internal + _shared
          '^src/domain/',
          '^src/infra/',
          '^src/shared/',
        ],
      },
    },

    // === Domain Layer Rules ===

    {
      name: 'domain-no-infra-imports',
      severity: 'error',
      comment: 'domain/ must not import infra/ (use DI instead)',
      from: { path: '^src/domain/' },
      to: { path: '^src/infra/' },
    },

    {
      name: 'domain-no-slice-imports',
      severity: 'error',
      comment: 'domain/ must not import slices/',
      from: { path: '^src/domain/' },
      to: { path: '^src/slices/' },
    },

    {
      name: 'domain-no-engine-imports',
      severity: 'error',
      comment: 'domain/ must not import engine/',
      from: { path: '^src/domain/' },
      to: { path: '^src/engine/' },
    },

    {
      name: 'domain-internal-layers',
      severity: 'error',
      comment:
        'Domain layering: graph < compiler < run < workflow < scheduling',
      from: {
        path: [
          '^src/domain/graph/',
          '^src/domain/compiler/',
          '^src/domain/run/',
          '^src/domain/workflow/',
        ],
      },
      to: {
        path: [
          '^src/domain/scheduling/',
        ],
      },
      // Allow: graph ← compiler ← run ← workflow ← scheduling
      // scheduling is the outermost domain, nothing should depend on it
    },

    {
      name: 'domain-only-to-shared',
      severity: 'error',
      comment: 'domain/ should only import from shared/ and other domain/',
      from: { path: '^src/domain/' },
      to: {
        path: '^src/',
        pathNot: [
          '^src/domain/',
          '^src/shared/',
        ],
      },
    },

    // === Infra Layer Rules ===

    {
      name: 'infra-only-to-shared',
      severity: 'error',
      comment: 'infra/ should only import from shared/',
      from: { path: '^src/infra/' },
      to: {
        path: '^src/',
        pathNot: [
          '^src/infra/',
          '^src/shared/',
        ],
      },
    },

    // === Shared Layer Purity ===

    {
      name: 'shared-no-domain-infra-engine-slices',
      severity: 'error',
      comment:
        'shared/ is foundational — no upward imports to domain/, infra/, engine/, slices/',
      from: { path: '^src/shared/' },
      to: {
        path: [
          '^src/domain/',
          '^src/infra/',
          '^src/engine/',
          '^src/slices/',
        ],
      },
    },

    // === API Purity ===

    {
      name: 'api-only-shared-models',
      severity: 'error',
      comment: 'api/ should only import from shared/models/',
      from: { path: '^src/api/' },
      to: {
        path: '^src/',
        pathNot: [
          '^src/shared/models/',
          '^src/api/',
        ],
      },
    },

    // === Engine Rules ===

    {
      name: 'engine-only-slices-domain-infra-shared',
      severity: 'error',
      comment:
        'engine/ should only import from slices/, domain/, infra/, shared/',
      from: { path: '^src/engine/' },
      to: {
        path: '^src/',
        pathNot: [
          '^src/engine/',
          '^src/slices/',
          '^src/domain/',
          '^src/infra/',
          '^src/shared/',
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // === Global Rules ===

    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are not allowed",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-test-in-prod",
      severity: "error",
      comment: "Production code must not import test code",
      from: { pathNot: "^tests/" },
      to: { path: "^tests/" },
    },
    {
      name: "no-dev-deps-in-src",
      severity: "error",
      comment: "Production code must not use devDependencies",
      from: { path: "^src/" },
      to: {
        dependencyTypes: ["npm-dev"],
        pathNot: ["tsx"],
      },
    },

    // === Command Layer ===

    {
      name: "commands-no-cross-import",
      severity: "error",
      comment: "Command files must not import from other command files",
      from: { path: "^src/commands/" },
      to: { path: "^src/commands/" },
    },

    {
      name: "commands-only-to-domain-and-shared",
      severity: "error",
      comment:
        "Commands should only import from domain modules, compiler, models, utils, and shared files",
      from: { path: "^src/commands/" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/(workflow|scheduling|runtime|graph|io|compiler)/",
          "^src/models/",
          "^src/utils/",
          "^src/constants\\.ts$",
          "^src/errors\\.ts$",
          "^src/cli\\.ts$",
          "^src/commands/",
        ],
      },
    },

    // === Domain Layer Rules (inner = more foundational) ===

    {
      name: "compiler-only-to-graph-and-shared",
      severity: "error",
      comment: "compiler/ should only import from graph/, models/, utils/, constants, errors",
      from: { path: "^src/compiler/" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/graph/",
          "^src/models/",
          "^src/utils/",
          "^src/constants\\.ts$",
          "^src/errors\\.ts$",
          "^src/compiler/",
        ],
      },
    },

    {
      name: "graph-no-upward-deps",
      severity: "error",
      comment:
        "graph/ is the innermost domain — must not depend on workflow/, runtime/, scheduling/, io/",
      from: { path: "^src/graph/" },
      to: {
        path: [
          "^src/workflow/",
          "^src/runtime/",
          "^src/scheduling/",
          "^src/io/",
          "^src/commands/",
        ],
      },
    },

    {
      name: "io-only-to-graph-and-shared",
      severity: "error",
      comment: "io/ should only import from graph/, models/, utils/, constants, errors",
      from: { path: "^src/io/" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/graph/",
          "^src/models/",
          "^src/utils/",
          "^src/constants\\.ts$",
          "^src/errors\\.ts$",
        ],
      },
    },

    {
      name: "workflow-only-to-runtime-and-shared",
      severity: "error",
      comment:
        "workflow/ should only import from runtime/, models/, utils/, constants, errors",
      from: { path: "^src/workflow/" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/runtime/",
          "^src/models/",
          "^src/utils/",
          "^src/constants\\.ts$",
          "^src/errors\\.ts$",
        ],
      },
    },

    {
      name: "runtime-only-to-graph-workflow-and-shared",
      severity: "error",
      comment:
        "runtime/ should only import from graph/, workflow/, models/, utils/, constants, errors",
      from: { path: "^src/runtime/" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/graph/",
          "^src/workflow/",
          "^src/models/",
          "^src/utils/",
          "^src/constants\\.ts$",
          "^src/errors\\.ts$",
        ],
      },
    },

    {
      name: "scheduling-only-to-domain-and-shared",
      severity: "error",
      comment:
        "scheduling/ should only import from workflow/, graph/, runtime/, models/, utils/, constants, errors",
      from: { path: "^src/scheduling/" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/workflow/",
          "^src/graph/",
          "^src/runtime/",
          "^src/models/",
          "^src/utils/",
          "^src/constants\\.ts$",
          "^src/errors\\.ts$",
        ],
      },
    },

    // === Foundation Purity ===

    {
      name: "models-no-domain-deps",
      severity: "error",
      comment: "Models are pure data — no domain/service imports",
      from: { path: "^src/models/" },
      to: {
        path: [
          "^src/(workflow|scheduling|runtime|graph|io|commands|compiler)/",
        ],
      },
    },

    {
      name: "utils-no-domain-deps",
      severity: "error",
      comment: "Utils are foundational — no domain imports",
      from: { path: "^src/utils/" },
      to: {
        path: [
          "^src/(workflow|scheduling|runtime|graph|io|commands|compiler)/",
        ],
      },
    },

    {
      name: "api-no-domain-deps",
      severity: "error",
      comment: "API is pure builder — only models and internal types",
      from: { path: "^src/api/" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/models/",
          "^src/api/",
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};

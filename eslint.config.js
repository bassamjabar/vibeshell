// Flat ESLint config: recommended rules, tuned for this codebase's
// deliberate patterns (empty catch = graceful degradation).

const js = require('@eslint/js');

const commonRules = {
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
};

module.exports = [
  { ignores: ['node_modules/**', 'release/**'] },

  // Main process + tests: Node (CommonJS).
  {
    ...js.configs.recommended,
    files: ['main.js', 'preload.js', 'main/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        WebSocket: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: commonRules,
  },

  // Renderer: browser scripts sharing one page scope.
  {
    ...js.configs.recommended,
    files: ['renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        CustomEvent: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
        getComputedStyle: 'readonly',
        Uint32Array: 'readonly',
        // Shared across renderer scripts (all run in the same page).
        TOOL_LOGOS: 'writable',
        showScreen: 'writable',
        applyTheme: 'writable',
        renderSidebar: 'writable',
      },
    },
    rules: commonRules,
  },
];

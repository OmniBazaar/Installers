/**
 * Jest config for service-desktop. Tests cover the electron-free logic modules
 * (env builder, tray-state machine, preflight parser, provisioner dispatch,
 * credential store with an injected encryptor) — never the electron runtime.
 */
module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
  },
};

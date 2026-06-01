#!/usr/bin/env node
/**
 * CLI for OmniBazaar installer artifact tooling.
 *
 * Commands:
 *   hash <file>
 *       Print the 0x-prefixed SHA-256 of <file> — the value an ODDAO signer
 *       passes to `Coin/scripts/sign-release.js --hash`.
 *   verify <file> --component <id> [--version <semver>] [--rpc <url>] [--registry <addr>]
 *       Verify <file> against the on-chain UpdateRegistry record. Exit 0 when
 *       authentic, 1 when not, 2 on bad usage.
 *
 * @module shared/cli
 */
import { hashFile } from "./artifact-hash";
import { verifyArtifact } from "./artifact-verifier";
import { EthersReleaseReader } from "./release-reader";

/**
 * Write a line to stdout. (A CLI's stdout is its product, so direct writes are
 * the intended interface here — not the banned service-side `console.log`.)
 * @param line - The line to print (newline appended).
 */
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Write a line to stderr.
 * @param line - The line to print (newline appended).
 */
function errOut(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Parsed CLI tokens: bare positionals and `--key value` flags. */
interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>;
}

/**
 * Parse a raw argv tail into positionals and flags.
 * @param argv - `process.argv.slice(2)`.
 * @returns The parsed positionals and flags.
 */
function parse(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = value;
        i++;
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

/**
 * Handle the `hash` command.
 * @param file - Path to the artifact.
 * @returns Process exit code.
 */
async function runHash(file: string | undefined): Promise<number> {
  if (file === undefined) {
    errOut("usage: omnibazaar-artifact hash <file>");
    return 2;
  }
  out(await hashFile(file));
  return 0;
}

/**
 * Handle the `verify` command.
 * @param file - Path to the artifact.
 * @param flags - Parsed flags (`component`, `version`, `rpc`, `registry`).
 * @returns Process exit code.
 */
async function runVerify(
  file: string | undefined,
  flags: Record<string, string>,
): Promise<number> {
  const component = flags["component"];
  if (file === undefined || component === undefined) {
    errOut(
      "usage: omnibazaar-artifact verify <file> --component <id> [--version <semver>] [--rpc <url>] [--registry <addr>]",
    );
    return 2;
  }

  const reader = new EthersReleaseReader({
    ...(flags["rpc"] !== undefined && { rpcUrl: flags["rpc"] }),
    ...(flags["registry"] !== undefined && {
      registryAddress: flags["registry"],
    }),
  });

  const result = await verifyArtifact({
    artifactPath: file,
    component,
    reader,
    ...(flags["version"] !== undefined && { version: flags["version"] }),
  });

  out(`component:     ${component}`);
  out(`version:       ${result.version}`);
  out(`local hash:    ${result.computedHash}`);
  out(`on-chain hash: ${result.onChainHash}`);
  out(`revoked:       ${result.revoked}`);
  out(`authentic:     ${result.ok}`);
  if (!result.ok) {
    errOut(`FAILED: ${result.reason}`);
    return 1;
  }
  out("OK");
  return 0;
}

/**
 * CLI entry point.
 * @returns Process exit code.
 */
async function main(): Promise<number> {
  const { positionals, flags } = parse(process.argv.slice(2));
  const command = positionals[0];
  switch (command) {
    case "hash":
      return runHash(positionals[1]);
    case "verify":
      return runVerify(positionals[1], flags);
    default:
      errOut("usage: omnibazaar-artifact <hash|verify> ...");
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    errOut(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });

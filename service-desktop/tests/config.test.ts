import {
  buildServiceNodeEnv,
  SERVICE_HTTP_PORT,
  type ServiceNodeLaunchConfig,
} from "../src/config";

/** A representative launch config for env-builder assertions. */
const baseConfig: ServiceNodeLaunchConfig = {
  nodeId: "service-node-test",
  username: "alice",
  password: "secret",
  database: {
    host: "127.0.0.1",
    port: 5433,
    user: "omnibazaar_app",
    password: "dbpass",
  },
};

describe("buildServiceNodeEnv", () => {
  it("sets the service-node runtime contract", () => {
    const env = buildServiceNodeEnv(baseConfig);
    expect(env.NODE_TYPE).toBe("service");
    expect(env.NODE_ENV).toBe("production");
    expect(env.PORT).toBe(String(SERVICE_HTTP_PORT));
    expect(env.UNIFIED_PORT).toBe("true");
    expect(env.HTTP_HOST).toBe("127.0.0.1");
  });

  it("passes credentials for in-node wallet derivation, never a private key", () => {
    const env = buildServiceNodeEnv(baseConfig);
    expect(env.STAKING_USERNAME).toBe("alice");
    expect(env.STAKING_PASSWORD).toBe("secret");
    expect(env.VALIDATOR_WALLET_PRIVATE_KEY).toBeUndefined();
  });

  it("applies the default service thresholds (participation 25, no AVAX) and no auth skip", () => {
    const env = buildServiceNodeEnv(baseConfig);
    expect(env.SERVICE_MIN_PARTICIPATION).toBe("25");
    expect(env.SERVICE_MIN_AVAX).toBe("0");
    expect(env.SERVICE_MIN_STAKING).toBe("0");
    expect(env.SKIP_VALIDATOR_AUTH).toBeUndefined();
  });

  it("allows threshold overrides", () => {
    const env = buildServiceNodeEnv({
      ...baseConfig,
      thresholds: { participation: "40" },
    });
    expect(env.SERVICE_MIN_PARTICIPATION).toBe("40");
  });

  it("wires the local database connection", () => {
    const env = buildServiceNodeEnv(baseConfig);
    expect(env.YUGABYTE_PORT).toBe("5433");
    expect(env.DB_USER).toBe("omnibazaar_app");
    expect(env.DB_PASSWORD).toBe("dbpass");
  });
});

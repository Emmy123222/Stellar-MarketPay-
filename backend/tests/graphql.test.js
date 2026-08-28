"use strict";

/**
 * backend/tests/graphql.test.js
 *
 * Regression tests for issue #1188.
 *
 * `backend/src/graphql/index.js` previously called `graphql({ ..., validationRules })`
 * from the installed graphql-js v17, whose `graphql()` accepts a `rules` option, not
 * `validationRules`. The mistyped option was silently ignored, so the handler's custom
 * validation rules (e.g. disabling introspection in production) never actually ran.
 * The fix wires `parse`, `validate`, and `validateSchema` explicitly ahead of `execute`.
 *
 * These tests exercise the handler directly (bypassing the full Express app / DB pool,
 * which the malformed/invalid requests below never need to reach) and would fail if the
 * validation stage were ever disconnected again.
 */

function createRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      if (this._resolve) this._resolve(this);
      return this;
    },
    send(payload) {
      this.body = payload;
      if (this._resolve) this._resolve(this);
      return this;
    },
  };
  return res;
}

function callHandler(handler, req) {
  return new Promise((resolve) => {
    const res = createRes();
    res._resolve = resolve;
    handler(req, res);
  });
}

describe("GraphQL handler validation pipeline (issue #1188)", () => {
  const handleGraphQL = require("../src/graphql");

  test("rejects a syntactically malformed query (parse stage)", async () => {
    const req = { method: "POST", body: { query: "{ job(id: \"1\") " } };
    const res = await callHandler(handleGraphQL, req);

    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.length).toBeGreaterThan(0);
    // Parse failures never reach execute(), so there is no `data` key.
    expect(res.body.data).toBeUndefined();
  });

  test("rejects a query selecting a field that does not exist on the schema (validate stage)", async () => {
    const req = {
      method: "POST",
      body: { query: "{ thisFieldDoesNotExistAnywhere }" },
    };
    const res = await callHandler(handleGraphQL, req);

    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toBeDefined();
    expect(
      res.body.errors.some((e) => /thisFieldDoesNotExistAnywhere/.test(e.message)),
    ).toBe(true);
    // Validation failures never reach execute(), so there is no `data` key.
    expect(res.body.data).toBeUndefined();
  });

  test("rejects a query with an unknown argument (validate stage)", async () => {
    const req = {
      method: "POST",
      body: {
        query: "{ job(id: \"1\", bogusArg: \"x\") { id } }",
      },
    };
    const res = await callHandler(handleGraphQL, req);

    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toBeDefined();
    expect(res.body.data).toBeUndefined();
  });

  test("lets a structurally valid query past validation into execute()", async () => {
    // `__typename` needs no custom resolver and touches no DB/loader, so this
    // exercises the full parse -> validate -> execute pipeline without I/O.
    const req = { method: "POST", body: { query: "{ __typename }" } };
    const res = await callHandler(handleGraphQL, req);

    expect(res.statusCode).not.toBe(400);
    expect(res.body.data).toEqual({ __typename: "Query" });
  });
});

describe("GraphQL handler blocks introspection in production (issue #1188)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  test("introspection queries are rejected by the custom validation rule when NODE_ENV=production", async () => {
    jest.resetModules();
    process.env.NODE_ENV = "production";
    const handleGraphQLProd = require("../src/graphql");

    const req = { method: "POST", body: { query: "{ __schema { types { name } } }" } };
    const res = await callHandler(handleGraphQLProd, req);

    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toBeDefined();
    expect(
      res.body.errors.some((e) => /Introspection is disabled in production/.test(e.message)),
    ).toBe(true);
    expect(res.body.data).toBeUndefined();
  });

  test("introspection queries are allowed outside production", async () => {
    jest.resetModules();
    process.env.NODE_ENV = "test";
    const handleGraphQLDev = require("../src/graphql");

    const req = { method: "POST", body: { query: "{ __schema { types { name } } }" } };
    const res = await callHandler(handleGraphQLDev, req);

    expect(res.statusCode).not.toBe(400);
  });
});

describe("GraphQL handler validates the schema itself (issue #1188)", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../src/graphql/schema");
  });

  test("returns 500 without executing when the schema fails validateSchema()", async () => {
    jest.resetModules();
    jest.doMock("../src/graphql/schema", () => {
      const { GraphQLSchema, GraphQLObjectType } = require("graphql");
      // A Query type with no fields is an invalid GraphQL schema.
      const BrokenQuery = new GraphQLObjectType({ name: "Query", fields: {} });
      return new GraphQLSchema({ query: BrokenQuery });
    });

    const handleGraphQLBroken = require("../src/graphql");
    const req = { method: "POST", body: { query: "{ __typename }" } };
    const res = await callHandler(handleGraphQLBroken, req);

    expect(res.statusCode).toBe(500);
    expect(res.body.errors[0].message).toMatch(/GraphQL schema is invalid/);
  });
});

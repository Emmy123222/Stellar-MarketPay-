"use strict";

const { graphql, validateSchema, parse, validate, specifiedRules } = require("graphql");
const schema = require("./schema");
const { createLoaders } = require("./loaders");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("graphql");

const isDev = process.env.NODE_ENV !== "production";

function introspectionRule(context) {
  return {
    Field(node) {
      if (node.name.value === "__schema" || node.name.value === "__type") {
        context.reportError(
          new Error("Introspection is disabled in production"),
        );
      }
    },
  };
}

function handleGraphQL(req, res) {
  if (req.method === "GET" && isDev) {
    res.status(200).send("GraphQL endpoint ready. Send POST requests with JSON body { query, variables }.");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const { query, variables, operationName } = req.body || {};

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "Must provide a query string." });
    return;
  }

  const loaders = createLoaders();
  const context = { loaders, req };

  const validationRules = [...specifiedRules];
  if (!isDev) {
    validationRules.push(introspectionRule);
  }

  graphql({
    schema,
    source: query,
    variableValues: variables,
    operationName,
    contextValue: context,
    validationRules,
  })
    .then((result) => {
      if (result.errors) {
        logger.error({ errors: result.errors.map((e) => e.message) }, "GraphQL error");
      }
      res.json(result);
    })
    .catch((err) => {
      logger.error({ err }, "GraphQL fatal error");
      res.status(500).json({ errors: [{ message: "Internal server error" }] });
    });
}

module.exports = handleGraphQL;

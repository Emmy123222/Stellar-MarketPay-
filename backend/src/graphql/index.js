"use strict";

const { execute, validateSchema, parse, validate, specifiedRules, GraphQLError } = require("graphql");
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

  // Schema must be valid before we attempt to parse or validate a query against it.
  const schemaErrors = validateSchema(schema);
  if (schemaErrors.length > 0) {
    logger.error({ errors: schemaErrors.map((e) => e.message) }, "GraphQL schema is invalid");
    res.status(500).json({ errors: [{ message: "GraphQL schema is invalid" }] });
    return;
  }

  let document;
  try {
    document = parse(query);
  } catch (syntaxError) {
    res.status(400).json({ errors: [{ message: syntaxError.message }] });
    return;
  }

  const validationRules = [...specifiedRules];
  if (!isDev) {
    validationRules.push(introspectionRule);
  }

  const validationErrors = validate(schema, document, validationRules);
  if (validationErrors.length > 0) {
    logger.error({ errors: validationErrors.map((e) => e.message) }, "GraphQL validation error");
    res.status(400).json({ errors: validationErrors.map((e) => ({ message: e.message })) });
    return;
  }

  const loaders = createLoaders();
  const context = { loaders, req };

  Promise.resolve()
    .then(() =>
      execute({
        schema,
        document,
        variableValues: variables,
        operationName,
        contextValue: context,
      }),
    )
    .then((result) => {
      if (result.errors) {
        logger.error({ errors: result.errors.map((e) => e.message) }, "GraphQL error");
      }
      res.json(result);
    })
    .catch((err) => {
      if (err instanceof GraphQLError) {
        res.status(400).json({ errors: [{ message: err.message }] });
        return;
      }
      logger.error({ err }, "GraphQL fatal error");
      res.status(500).json({ errors: [{ message: "Internal server error" }] });
    });
}

module.exports = handleGraphQL;

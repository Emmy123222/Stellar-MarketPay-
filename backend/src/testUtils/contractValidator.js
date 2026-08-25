"use strict";

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const openApiSpec = require("../../docs/openapi.json");

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
addFormats(ajv);

const componentSchemas = openApiSpec.components?.schemas || {};

function resolveRefs(schema) {
  if (!schema || typeof schema !== "object") return schema;

  if (Array.isArray(schema)) {
    return schema.map(resolveRefs);
  }

  if (schema.$ref) {
    const schemaName = schema.$ref.replace("#/components/schemas/", "");
    const resolved = componentSchemas[schemaName];
    if (!resolved) throw new Error(`Unknown $ref: ${schema.$ref}`);
    return resolveRefs(resolved);
  }

  const out = {};
  for (const [key, val] of Object.entries(schema)) {
    if (key !== "nullable") {
      out[key] = resolveRefs(val);
    }
  }

  // Convert OpenAPI 3.0 `nullable: true` to JSON Schema `type: [T, "null"]`
  if (schema.nullable === true && typeof schema.type === "string") {
    out.type = [schema.type, "null"];
  }

  return out;
}

function getResponseSchema(apiPath, method, statusCode) {
  const pathSpec = openApiSpec.paths?.[apiPath];
  if (!pathSpec) throw new Error(`No OpenAPI spec for path: ${apiPath}`);

  const methodSpec = pathSpec[method.toLowerCase()];
  if (!methodSpec) throw new Error(`No spec for ${method.toUpperCase()} ${apiPath}`);

  const responseSpec = methodSpec.responses?.[String(statusCode)];
  if (!responseSpec) throw new Error(`No spec for status ${statusCode} on ${method.toUpperCase()} ${apiPath}`);

  const jsonSchema = responseSpec.content?.["application/json"]?.schema;
  if (!jsonSchema) throw new Error(`No JSON schema for ${method.toUpperCase()} ${apiPath} [${statusCode}]`);

  return resolveRefs(jsonSchema);
}

// Compiled-validator cache: AJV v8 does not cache anonymous schemas internally,
// so we maintain our own Map to avoid recompiling the same schema on every call.
const _validatorCache = new Map();

function validateContract(apiPath, method, statusCode, body) {
  const cacheKey = `${apiPath}::${method.toLowerCase()}::${statusCode}`;
  let validate = _validatorCache.get(cacheKey);
  if (!validate) {
    const schema = getResponseSchema(apiPath, method, statusCode);
    validate = ajv.compile(schema);
    _validatorCache.set(cacheKey, validate);
  }
  const valid = validate(body);
  return { valid, errors: validate.errors || [] };
}

function assertContract(apiPath, method, statusCode, body) {
  const { valid, errors } = validateContract(apiPath, method, statusCode, body);
  if (!valid) {
    const detail = errors
      .map((e) => `  • ${e.instancePath || "(root)"} ${e.message}`)
      .join("\n");
    throw new Error(
      `Contract violation [${method.toUpperCase()} ${apiPath}] status ${statusCode}:\n${detail}`
    );
  }
}

module.exports = { validateContract, assertContract, getResponseSchema };

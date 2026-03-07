/**
 * Tool schema system — Zod to JSON Schema conversion and validation.
 *
 * Provides ToolSchemaDefinition with validate(), toJsonSchema(), toLLMSchema(),
 * and fromZod() for building tool parameter schemas from Zod.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { ToolSchema } from "../../models/llm.js";
import { ToolValidationError } from "../../models/errors.js";

/** Extract validation error messages from Zod or generic errors. */
function formatValidationErrors(err: unknown): string[] {
  if (err && typeof err === "object") {
    const issues = (err as { issues?: Array<{ message: string }> }).issues ?? (err as { errors?: unknown[] }).errors;
    if (Array.isArray(issues)) {
      return issues.map((e) => (typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e)));
    }
  }
  return [err instanceof Error ? err.message : String(err)];
}

// ---------------------------------------------------------------------------
// ToolSchemaDefinition
// ---------------------------------------------------------------------------

/** Options for building a ToolSchemaDefinition from Zod. */
export interface FromZodOptions {
  /** Optional name for the JSON Schema (used by zod-to-json-schema). */
  schemaName?: string;
}

function extractDefinitionRef(ref: string): string | undefined {
  const match = /^#\/(?:definitions|\$defs)\/(.+)$/.exec(ref);
  return match?.[1];
}

function sanitizeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _meta, definitions: _definitions, $defs: _defs, ...rest } = schema;
  return rest;
}

/**
 * zod-to-json-schema can return `{ $ref, definitions }` when a schema name is provided.
 * OpenAI tools require `function.parameters` to be a direct JSON schema object.
 */
function toDirectParametersSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  if ("type" in jsonSchema || "properties" in jsonSchema) {
    return sanitizeJsonSchema(jsonSchema);
  }

  const ref = typeof jsonSchema["$ref"] === "string" ? jsonSchema["$ref"] : undefined;
  const defName = ref ? extractDefinitionRef(ref) : undefined;
  const definitions = jsonSchema["definitions"];
  const defs = jsonSchema["$defs"];

  if (
    defName &&
    definitions &&
    typeof definitions === "object" &&
    !Array.isArray(definitions) &&
    defName in definitions
  ) {
    const definition = (definitions as Record<string, unknown>)[defName];
    if (definition && typeof definition === "object" && !Array.isArray(definition)) {
      return sanitizeJsonSchema(definition as Record<string, unknown>);
    }
  }

  if (defName && defs && typeof defs === "object" && !Array.isArray(defs) && defName in defs) {
    const definition = (defs as Record<string, unknown>)[defName];
    if (definition && typeof definition === "object" && !Array.isArray(definition)) {
      return sanitizeJsonSchema(definition as Record<string, unknown>);
    }
  }

  return { type: "object", properties: jsonSchema ?? {} };
}

/**
 * Definition of a tool's parameter schema with validation and LLM conversion.
 * Use fromZod() to create from a Zod schema, or construct with raw parameters.
 */
export class ToolSchemaDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema object for the parameters (type: object, properties, required, etc.). */
  readonly parameters: Record<string, unknown>;
  private readonly _validator?: (args: unknown) => unknown;

  constructor(params: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    /** Optional validator; if not set, validate() only checks required keys. */
    validate?: (args: unknown) => unknown;
  }) {
    this.name = params.name;
    this.description = params.description;
    this.parameters = params.parameters;
    this._validator = params.validate;
  }

  /**
   * Validate arguments against the schema.
   * When built from Zod, uses Zod's parse(); otherwise checks required keys from parameters.required.
   * @throws ToolValidationError if validation fails
   */
  validate(args: Record<string, unknown>): Record<string, unknown> {
    if (this._validator) {
      try {
        const validated = this._validator(args) as Record<string, unknown>;
        return validated ?? {};
      } catch (err) {
        const messages = formatValidationErrors(err);
        throw new ToolValidationError(`Tool "${this.name}" validation failed`, {
          toolName: this.name,
          validationErrors: messages,
        });
      }
    }
    // Fallback: require keys from parameters.required
    const required = this.parameters["required"] as string[] | undefined;
    if (Array.isArray(required)) {
      const missing = required.filter((key) => !(key in args));
      if (missing.length > 0) {
        throw new ToolValidationError(
          `Missing required parameter(s): ${missing.join(", ")}`,
          { toolName: this.name, validationErrors: missing.map((m) => `Missing: ${m}`) },
        );
      }
    }
    return { ...args };
  }

  /** Return the full JSON Schema for parameters (object with type, properties, required). */
  toJsonSchema(): Record<string, unknown> {
    return { ...this.parameters };
  }

  /** Return the LLM-facing ToolSchema (name, description, parameters). */
  toLLMSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: this.toJsonSchema(),
    };
  }
}

// ---------------------------------------------------------------------------
// fromZod
// ---------------------------------------------------------------------------

/**
 * Build a ToolSchemaDefinition from a Zod schema.
 * Uses zod-to-json-schema for conversion and the Zod schema for validate().
 */
export function fromZod(
  name: string,
  description: string,
  zodSchema: z.ZodType<Record<string, unknown>>,
  options?: FromZodOptions,
): ToolSchemaDefinition {
  const jsonSchema = zodToJsonSchema(
    zodSchema,
    options?.schemaName ? { name: options.schemaName } : undefined,
  ) as Record<string, unknown>;
  const params = toDirectParametersSchema(jsonSchema);

  const validator = (args: unknown) => {
    return zodSchema.parse(args) as Record<string, unknown>;
  };

  return new ToolSchemaDefinition({
    name,
    description,
    parameters: params,
    validate: validator,
  });
}

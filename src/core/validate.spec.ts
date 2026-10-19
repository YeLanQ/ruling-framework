import { describe, expect, it } from "vitest";

import type { JsonSchema } from "./types.js";
import { validateSchema } from "./validate.js";

describe("JSON Schema subset validation", () => {
  it("accepts a valid object payload", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { path: { type: "string", minLength: 1 } },
      required: ["path"],
      additionalProperties: false
    };
    expect(validateSchema(schema, { path: "a.md" })).toEqual([]);
  });

  it("reports missing required, wrong types and extra fields", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { path: { type: "string" }, count: { type: "number", minimum: 0 } },
      required: ["path"],
      additionalProperties: false
    };
    const errors = validateSchema(schema, { count: "1", extra: true });
    expect(errors.some((error) => error.includes("path 为必填"))).toBe(true);
    expect(errors.some((error) => error.includes("count 必须是数字"))).toBe(true);
    expect(errors.some((error) => error.includes("extra 不在允许字段内"))).toBe(true);
  });

  it("fails closed on an unknown schema type instead of silently passing", () => {
    const schema = { type: "integer" } as unknown as JsonSchema;
    expect(validateSchema(schema, 5)).toEqual(['params 的类型不受支持："integer"']);
  });

  it("passes values through when no type constraint is given", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { value: { description: "任意标量" } },
      required: ["value"]
    };
    expect(validateSchema(schema, { value: 120 })).toEqual([]);
    expect(validateSchema(schema, { value: "12mm" })).toEqual([]);
    expect(validateSchema(schema, { value: true })).toEqual([]);
  });

  it("validates array items and enum", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["draft", "active"] }
      }
    };
    expect(validateSchema(schema, { tags: ["a", 1], status: "gone" })).toHaveLength(2);
  });
});

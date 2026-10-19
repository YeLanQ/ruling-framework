// Minimal JSON Schema validation for action inputs. The capability surface
// declares just enough schema to reject structurally wrong parameters before
// an executor ever sees them.

import type { JsonSchema } from "./types.js";

export function validateSchema(schema: JsonSchema | undefined, value: unknown): string[] {
  if (!schema) return [];
  const errors: string[] = [];
  validateInto(schema, value, "params", errors);
  return errors;
}

function validateInto(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;

  if (schema.enum && !schema.enum.includes(value as string | number | boolean)) {
    errors.push(`${path} 必须是 ${schema.enum.join(" | ")}`);
    return;
  }

  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        errors.push(`${path} 必须是对象`);
        return;
      }
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${path}.${key} 为必填`);
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (key in record) validateInto(child, record[key], `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in (schema.properties ?? {}))) errors.push(`${path}.${key} 不在允许字段内`);
        }
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`${path} 必须是数组`);
        return;
      }
      if (schema.items) {
        value.forEach((item, index) => {
          validateInto(schema.items as JsonSchema, item, `${path}[${index}]`, errors);
        });
      }
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        errors.push(`${path} 必须是字符串`);
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path} 长度不得小于 ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path} 长度不得大于 ${schema.maxLength}`);
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push(`${path} 必须是数字`);
        return;
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path} 不得小于 ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path} 不得大于 ${schema.maximum}`);
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") errors.push(`${path} 必须是布尔值`);
      break;
    }
    default: {
      // 显式提供的非法类型 fail-closed；缺失 type 表示“任意标量”，不约束。
      // JSON manifest 经运行时断言后可携带联合之外的字符串，故经 unknown 判断。
      const rawType: unknown = schema.type;
      if (rawType !== undefined) {
        errors.push(`${path} 的类型不受支持：${JSON.stringify(rawType)}`);
      }
      break;
    }
  }
}

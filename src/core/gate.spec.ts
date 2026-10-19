import { describe, expect, it } from "vitest";

import { gate } from "./gate.js";

describe("gate", () => {
  it("lets a green action execute without approval", () => {
    expect(gate({ zone: "green", approved: false, known: true })).toMatchObject({
      decision: "autoExecute"
    });
  });

  it("requires approval for a registered yellow action", () => {
    const result = gate({ zone: "yellow", approved: false, known: true });
    expect(result.decision).toBe("needConfirm");
    expect(result.reason).toContain("黄灯");
  });

  it("executes a registered yellow action after approval", () => {
    expect(gate({ zone: "yellow", approved: true, known: true }).decision).toBe("autoExecute");
  });

  it("never executes an unregistered action, even when approved", () => {
    const result = gate({ zone: "yellow", approved: true, known: false });
    expect(result.decision).toBe("needConfirm");
    expect(result.reason).toContain("未登记");
  });

  it("denies a red action even when approved", () => {
    const result = gate({ zone: "red", approved: true, known: true });
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("红灯");
  });
});

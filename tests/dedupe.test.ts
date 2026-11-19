import { describe, it, expect } from "vitest";
import { nameKey, keyFromDomain, companyKey } from "@/lib/dedupe";
import { scoreCompany } from "@/lib/score";
import { DEFAULT_ICP } from "@/lib/icp";
import { emptyFields } from "@/lib/fields";

describe("dedupe keys", () => {
  it("same company, different domains and casing", () => {
    expect(companyKey("Coval", "coval.dev")).toBe(companyKey("COVAL", "coval.ai"));
    expect(companyKey("Liberate", "liberateinc.com")).toBe(companyKey("Liberate", "liberate.ai"));
    expect(companyKey("Juicebox Inc.", "juicebox.work")).toBe(nameKey("Juicebox"));
  });
  it("unresolved candidate with no domain still matches by name", () => {
    expect(companyKey("Trebellar", "")).toBe(companyKey("Trebellar", "trebellar.com"));
  });
  it("different companies stay different", () => {
    expect(companyKey("Souk", "souk.app")).not.toBe(companyKey("Sparrow", "sparrow.com"));
    expect(keyFromDomain("https://www.zenity.io/about")).toBe("zenity");
  });
});

describe("score range", () => {
  it("never exceeds 100 even with maxed fields and tiny penalties", () => {
    const f = emptyFields();
    f.is_b2b_saas = { value: true, quote: "q", url: "u" } as any; f.buyer = { value: "enterprise security teams", quote: "q", url: "u" } as any;
    f.enterprise_signal = { value: true, quote: "q", url: "u" } as any; f.compliance_hiring = { value: true, quote: "soc 2", url: "u" } as any;
    f.funding_stage = { value: "Series B", quote: "q", url: "u" } as any; f.open_roles = { value: 40, quote: "q", url: "u" } as any;
    const cfg = { ...DEFAULT_ICP, weights: { saas: 60, stage: 60, enterprise: 60, trigger: 60, data: 60 }, penalties: { certUnverified: 0, stageUnknown: 0 } };
    const r = scoreCompany({ fields: f, discovery: { quote: "SOC 2 audit", source: "hiring" }, flags: [] }, cfg as any);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
  it("tolerates legacy accounts missing newer fields", () => {
    expect(() => scoreCompany({ fields: {} as any, discovery: null, flags: [] }, DEFAULT_ICP)).not.toThrow();
  });
});

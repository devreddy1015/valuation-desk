import { describe, expect, it } from "vitest";
import { financialFamily, isFinancialFirm } from "./markets";

const none = { loansToAssets: null, interestToRevenue: null, revenueToAssets: null };

describe("isFinancialFirm", () => {
  it("keeps banks, insurers and lenders off the DCF", () => {
    expect(isFinancialFirm("Financial Services", "Banks - Regional", none)).toBe(true);
    expect(isFinancialFirm("Financial Services", "Insurance - Life", none)).toBe(true);
    // Bajaj Finance: net loans 89% of assets
    expect(isFinancialFirm("Financial Services", "Credit Services", { loansToAssets: 0.89, interestToRevenue: 1.47, revenueToAssets: 0.09 })).toBe(true);
    // American Express: net loans 74% of assets
    expect(isFinancialFirm("Financial Services", "Credit Services", { loansToAssets: 0.74, interestToRevenue: 0.35, revenueToAssets: 0.24 })).toBe(true);
  });
  it("keeps fee businesses on the DCF", () => {
    // Visa and Mastercard: no loan book, revenue 40-60% of assets
    expect(isFinancialFirm("Financial Services", "Credit Services", { loansToAssets: null, interestToRevenue: null, revenueToAssets: 0.4 })).toBe(false);
    // PayPal: a small loan book
    expect(isFinancialFirm("Financial Services", "Credit Services", { loansToAssets: 0.11, interestToRevenue: 0.02, revenueToAssets: 0.41 })).toBe(false);
    // HDFC AMC, BSE, S&P Global
    expect(isFinancialFirm("Financial Services", "Asset Management", { loansToAssets: null, interestToRevenue: 0.01, revenueToAssets: 0.41 })).toBe(false);
    expect(isFinancialFirm("Financial Services", "Financial Data & Stock Exchanges", { loansToAssets: null, interestToRevenue: 0.05, revenueToAssets: 0.33 })).toBe(false);
    expect(isFinancialFirm("Financial Services", "Insurance Brokers", none)).toBe(false);
  });
  it("treats an investment holding company as financial", () => {
    // Jio Financial: revenue 2% of assets, the value sits on the balance sheet
    expect(isFinancialFirm("Financial Services", "Asset Management", { loansToAssets: null, interestToRevenue: 0.02, revenueToAssets: 0.02 })).toBe(true);
  });
  it("needs the financial sector", () => {
    expect(isFinancialFirm("Technology", "Software", { loansToAssets: 0.9, interestToRevenue: 0.9, revenueToAssets: 0.01 })).toBe(false);
  });
});

describe("financialFamily", () => {
  it("groups comparable financial firms", () => {
    expect(financialFamily("Insurance - Life")).toBe("insurers");
    expect(financialFamily("Banks - Regional")).toBe("lenders");
    expect(financialFamily("Credit Services")).toBe("lenders");
    expect(financialFamily("Capital Markets")).toBe("markets");
  });
});

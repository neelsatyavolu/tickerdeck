import { describe, expect, it } from "vitest";
import { forecastExposures } from "./service";

describe("forecastExposures", () => {
  it("declines crypto, whose seven-day week the trading-day model would misread", async () => {
    await expect(forecastExposures([{ symbol: "BTC-USD", value: 100 }], "3m")).rejects.toThrow(/crypto/i);
    await expect(forecastExposures([{ symbol: "AAPL", value: 0 }, { symbol: "ETH-USD", value: 5 }], "1y")).rejects.toThrow(/crypto/i);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStale, sourcePublished } from "./dates.js";

describe("sourcePublished", () => {
  it("reads ISO dates, RSS dates and Unix milliseconds", () => {
    assert.deepEqual(sourcePublished("2026-10-07T10:13:19-04:00"), { publishedAt: "2026-10-07T14:13:19.000Z", publishedAtSource: "source" });
    assert.equal(sourcePublished("Tue, 17 Nov 2026 09:00:00 GMT").publishedAt, "2026-11-17T09:00:00.000Z");
    assert.equal(sourcePublished(1_795_000_000_000).publishedAt, new Date(1_795_000_000_000).toISOString());
  });

  it("gives nothing for an absent or broken date", () => {
    assert.deepEqual(sourcePublished(undefined), {});
    assert.deepEqual(sourcePublished(""), {});
    assert.deepEqual(sourcePublished("вчера"), {});
  });
});

describe("isStale", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it("compares the age with the limit", () => {
    assert.equal(isStale("2026-10-01T00:00:00Z", 30, now), true);
    assert.equal(isStale("2026-11-01T00:00:00Z", 30, now), false);
  });

  it("never drops without a date or a limit", () => {
    assert.equal(isStale(undefined, 30, now), false);
    assert.equal(isStale("2020-01-01T00:00:00Z", undefined, now), false);
  });
});

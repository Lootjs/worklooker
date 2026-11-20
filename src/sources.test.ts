import assert from "node:assert/strict";
import { it } from "node:test";
import { himalayasQueries } from "./himalayas.js";
import { splitCompany } from "./rss.js";

it("splits We Work Remotely titles into company and role", () => {
  assert.deepEqual(splitCompany("Mercury: Engineering Manager - Bank Accounts"), { company: "Mercury", title: "Engineering Manager - Bank Accounts" });
  assert.deepEqual(splitCompany("Senior Frontend Engineer"), { title: "Senior Frontend Engineer" });
});

it("searches Himalayas by the profile's English roles only", () => {
  assert.deepEqual(himalayasQueries(["Head of Frontend", "техлид*", "tech lead", "Tech Lead", "front-end lead", "руководител* разработки"]), ["head of frontend", "tech lead", "front-end lead"]);
});

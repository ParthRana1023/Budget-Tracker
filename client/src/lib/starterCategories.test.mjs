import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { STARTER_CATEGORIES } from "./starterCategories.mjs";

const sqlPath = fileURLToPath(new URL("../../../server/src/db/migrations/20261103_canonical_categories.sql", import.meta.url));

test("the JS fallback list matches the SQL function exactly (names, types, order)", () => {
  const sql = readFileSync(sqlPath, "utf8");
  const values = sql.slice(sql.indexOf("from (values"), sql.indexOf(") as s(name, type)"));
  const fromSql = [...values.matchAll(/\('([^']+)',\s*'(fixed|flexible)'\)/g)].map(([, name, type]) => ({ name, type }));
  assert.equal(fromSql.length, 13);
  assert.deepEqual(STARTER_CATEGORIES, fromSql);
});

test("5 fixed and 8 flexible, no duplicate names", () => {
  assert.equal(STARTER_CATEGORIES.filter((c) => c.type === "fixed").length, 5);
  assert.equal(STARTER_CATEGORIES.filter((c) => c.type === "flexible").length, 8);
  assert.equal(new Set(STARTER_CATEGORIES.map((c) => c.name.toLowerCase())).size, 13);
});

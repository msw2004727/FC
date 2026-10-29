"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  normalizeCustomRoleDocs,
  buildRoleSequence,
  buildRoleLevelMap,
  resolveRoleGraph,
  createRoleGraphLoader,
} = require("../../functions/role-hierarchy");

const BUILTIN_LEVELS = {
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
};
const BUILTIN_KEYS = Object.keys(BUILTIN_LEVELS);
const configSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "js", "config.js"),
  "utf8"
);

function record(key, afterRole) {
  return { id: key, data: { key, afterRole } };
}

function createFrontendOracle(records) {
  const start = configSource.indexOf("const BUILTIN_ROLE_KEYS");
  const end = configSource.indexOf("function getRuntimeRoleInfo", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const customRoles = [...records]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map(doc => ({ ...doc.data }));
  const context = vm.createContext({
    FirebaseService: { _cache: { customRoles } },
  });
  return vm.runInContext(
    `${configSource.slice(start, end)}\ngetRuntimeRoleLevel;`,
    context
  );
}

function expectReachableParity(records) {
  const graph = resolveRoleGraph(records);
  const oracle = createFrontendOracle(records);

  Object.entries(graph.levels).forEach(([key, level]) => {
    expect(level).toBe(oracle(key));
  });
  return { graph, oracle };
}

describe("role-hierarchy normalization and traversal", () => {
  test("empty collection preserves all built-in levels", () => {
    const { graph } = expectReachableParity([]);
    expect(graph).toEqual({
      ok: true,
      levels: BUILTIN_LEVELS,
      invalidKeys: [],
      unreachable: [],
    });
    expect(buildRoleSequence([])).toEqual({
      sequence: BUILTIN_KEYS,
      unreachable: [],
    });
  });

  test("one custom role interpolates between captain and venue_owner", () => {
    const { graph } = expectReachableParity([record("assistant", "captain")]);
    expect(graph.ok).toBe(true);
    expect(graph.levels.assistant).toBe(2.5);
  });

  test("siblings use document ID order even when input is reversed", () => {
    const records = [
      record("c_sibling", "captain"),
      record("a_sibling", "captain"),
      record("b_sibling", "captain"),
    ];
    const normalized = normalizeCustomRoleDocs(records);
    expect(normalized.validRoles.map(role => role.id)).toEqual([
      "a_sibling", "b_sibling", "c_sibling",
    ]);
    const built = buildRoleSequence([...normalized.validRoles].reverse());
    expect(built.sequence).toEqual([
      "user", "coach", "captain",
      "a_sibling", "b_sibling", "c_sibling",
      "venue_owner", "admin", "super_admin",
    ]);

    const { graph } = expectReachableParity(records);
    expect(graph.levels.a_sibling).toBe(2.25);
    expect(graph.levels.b_sibling).toBe(2.5);
    expect(graph.levels.c_sibling).toBe(2.75);
    expect(resolveRoleGraph([...records].reverse())).toEqual(graph);
  });

  test("nested descendants are traversed before the next sibling", () => {
    const records = [
      record("z_sibling", "captain"),
      record("m_child", "a_parent"),
      record("a_parent", "captain"),
    ];
    const { validRoles } = normalizeCustomRoleDocs(records);
    expect(buildRoleSequence(validRoles).sequence).toEqual([
      "user", "coach", "captain",
      "a_parent", "m_child", "z_sibling",
      "venue_owner", "admin", "super_admin",
    ]);
    const { graph } = expectReachableParity(records);
    expect(graph.levels.a_parent).toBe(2.25);
    expect(graph.levels.m_child).toBe(2.5);
    expect(graph.levels.z_sibling).toBe(2.75);
  });

  BUILTIN_KEYS.slice(0, -1).forEach((parent, index) => {
    test(`custom role in ${parent} interval matches frontend interpolation`, () => {
      const { graph } = expectReachableParity([record("custom", parent)]);
      expect(graph.ok).toBe(true);
      expect(graph.levels.custom).toBe(index + 0.5);
    });
  });

  [
    { name: "omitted afterRole", data: { key: "custom" } },
    { name: "empty afterRole", data: { key: "custom", afterRole: "" } },
  ].forEach(({ name, data }) => {
    test(`${name} defaults to captain`, () => {
      const { graph } = expectReachableParity([{ id: "custom", data }]);
      expect(graph.ok).toBe(true);
      expect(graph.levels.custom).toBe(2.5);
    });
  });

  const invalidCases = [
    {
      name: "key differs from document ID",
      doc: { id: "document", data: { key: "different" } },
    },
    {
      name: "built-in key collision",
      doc: { id: "admin", data: { key: "admin" } },
    },
    {
      name: "missing key",
      doc: { id: "document", data: {} },
    },
    {
      name: "empty key",
      doc: { id: "document", data: { key: "" } },
    },
    {
      name: "whitespace key",
      doc: { id: " ", data: { key: " " } },
    },
    {
      name: "non-string key",
      doc: { id: "document", data: { key: 123 } },
    },
    {
      name: "numeric afterRole",
      doc: { id: "custom", data: { key: "custom", afterRole: 2 } },
    },
    {
      name: "null afterRole",
      doc: { id: "custom", data: { key: "custom", afterRole: null } },
    },
    {
      name: "array afterRole",
      doc: { id: "custom", data: { key: "custom", afterRole: [] } },
    },
    {
      name: "non-object document data",
      doc: { id: "custom", data: [] },
    },
  ];

  invalidCases.forEach(({ name, doc }) => {
    test(`${name} invalidates the graph and records the document ID`, () => {
      const normalized = normalizeCustomRoleDocs([doc]);
      expect(normalized.validRoles).toEqual([]);
      expect(normalized.invalidKeys).toEqual([doc.id]);
      const graph = resolveRoleGraph([doc]);
      expect(graph.ok).toBe(false);
      expect(graph.invalidKeys).toEqual([doc.id]);
      expect({ ...graph.levels }).toEqual(BUILTIN_LEVELS);
    });
  });

  test("duplicate document keys invalidate the graph", () => {
    const graph = resolveRoleGraph([
      record("duplicate", "captain"),
      record("duplicate", "admin"),
    ]);
    expect(graph.ok).toBe(false);
    expect(graph.invalidKeys).toEqual(["duplicate"]);
  });

  test("cross-realm plain document objects are accepted", () => {
    const data = vm.runInNewContext('({ key: "custom", afterRole: "captain" })');
    const graph = resolveRoleGraph([{ id: "custom", data }]);
    expect(graph.ok).toBe(true);
    expect(graph.levels.custom).toBe(2.5);
  });
});

describe("role-hierarchy rejects frontend-only fallback levels", () => {
  [
    {
      name: "orphan",
      records: [record("orphan", "missing")],
      keys: ["orphan"],
    },
    {
      name: "self cycle",
      records: [record("self", "self")],
      keys: ["self"],
    },
    {
      name: "mutual cycle",
      records: [record("a", "b"), record("b", "a")],
      keys: ["a", "b"],
    },
    {
      name: "descendant of an orphan",
      records: [record("child", "orphan"), record("orphan", "missing")],
      keys: ["child", "orphan"],
    },
  ].forEach(({ name, records, keys }) => {
    test(`${name}: backend unknown, frontend fallback strictly between 4 and 5`, () => {
      const { graph, oracle } = expectReachableParity(records);
      const { validRoles } = normalizeCustomRoleDocs(records);
      const built = buildRoleSequence(validRoles);
      expect(graph.ok).toBe(false);
      expect([...built.unreachable].sort()).toEqual([...keys].sort());
      expect([...graph.unreachable].sort()).toEqual([...keys].sort());

      keys.forEach(key => {
        expect(built.sequence).not.toContain(key);
        expect(graph.levels[key] ?? "unknown").toBe("unknown");
        expect(oracle(key)).toBeGreaterThan(4);
        expect(oracle(key)).toBeLessThan(5);
      });
    });
  });

  test("valid nodes retain parity even when another node is unreachable", () => {
    const { graph, oracle } = expectReachableParity([
      record("valid", "venue_owner"),
      record("orphan", "missing"),
    ]);
    expect(graph.ok).toBe(false);
    expect(graph.levels.valid).toBe(3.5);
    expect(graph.levels.orphan).toBeUndefined();
    expect(oracle("orphan")).toBeGreaterThan(4);
    expect(oracle("orphan")).toBeLessThan(5);
  });

  test("level-map builder never maps a super_admin tail into the admin interval", () => {
    const levels = buildRoleLevelMap([...BUILTIN_KEYS, "tail"]);
    expect(levels.tail ?? "unknown").toBe("unknown");
  });

  test("a super_admin descendant has no usable interval and invalidates the graph", () => {
    const records = [
      record("tail", "super_admin"),
      record("tail_child", "tail"),
    ];
    const { graph, oracle } = expectReachableParity(records);
    expect(graph.ok).toBe(false);
    expect(graph.unreachable).toEqual(["tail", "tail_child"]);
    ["tail", "tail_child"].forEach(key => {
      expect(graph.levels[key] ?? "unknown").toBe("unknown");
      expect(oracle(key)).toBeGreaterThan(4);
      expect(oracle(key)).toBeLessThan(5);
    });
  });
});

describe("createRoleGraphLoader", () => {
  test("uses one unbounded customRoles collection get", async () => {
    const docs = [
      { id: "z", data: () => ({ key: "z", afterRole: "captain" }) },
      { id: "a", data: () => ({ key: "a", afterRole: "captain" }) },
    ];
    const get = jest.fn(async () => ({ docs }));
    const db = { collection: jest.fn(() => ({ get })) };
    const graph = await createRoleGraphLoader({ db })();

    expect(db.collection).toHaveBeenCalledTimes(1);
    expect(db.collection).toHaveBeenCalledWith("customRoles");
    expect(get).toHaveBeenCalledTimes(1);
    expect(graph.ok).toBe(true);
    expect(graph.levels.a).toBe(2 + 1 / 3);
    expect(graph.levels.z).toBe(2 + 2 / 3);
  });

  test("rethrows the original read error", async () => {
    const failure = new Error("fixture read failure");
    const db = {
      collection: () => ({
        get: async () => { throw failure; },
      }),
    };
    await expect(createRoleGraphLoader({ db })()).rejects.toBe(failure);
  });
});

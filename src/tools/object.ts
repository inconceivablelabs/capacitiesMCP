// File: src/tools/object.ts
//
// create_object (cap-6dy.11) and update_object (cap-6dy.12) — the generic
// write tools. Both compose a typed-wrapper `properties` map from human-readable
// input (scalar properties, label options by NAME, entity relations by NAME
// resolved strictly via resolveEntities) and share the wrapper-building /
// relation-planning / entity-auto-create machinery below.
//
// Contract: VALIDATE FULLY BEFORE WRITING. Every input problem is accumulated
// and returned as one isError message WITHOUT writing anything — no half-built
// objects and no orphaned auto-created relation targets. Only once all wrappers
// are valid do we POST/PATCH /object, then optionally append a markdown body via
// /blocks/append.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient, CapacitiesAPIError, WaitBudget, WINDOW_MS } from "../client/capacities.js";
import { CapacitiesStructure, PropertyDefinition } from "../client/types.js";
import { resolveEntities, SEARCH_LIMIT } from "./resolution.js";
import { MARKDOWN_BODY_NOTE } from "./descriptions.js";
// Shared with resolution.ts — was a byte-identical local dupe (cap-6dy.24 #4).
import { normalizeName as normalize } from "../utils/normalize.js";

// Scalar property types handled by the `properties` map.
const SCALAR_TYPES = new Set(["text", "url", "number", "boolean", "date"]);

function toArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

// Per-category rate-limit ceiling (30 requests / 60s window). Used for the
// pre-flight demand check.
const RATE_WINDOW_MAX = 30;

// Pre-flight budget check (cap-6dy.19 D): if a composite write's resolution
// searches or auto-creates exceed a single rate-limit window, the write still
// proceeds (paced internally) but the success output carries an informational
// warning nudging the LLM to split large writes. WARN, never reject.
// `searchDemand` counts raw relation-name values (approximate — dedup happens
// later); `objectDemand` counts planned auto-creates + the object itself.
function largeBatchWarning(
  relations: Record<string, string | string[]> | undefined,
  relationPlans: RelationPlan[]
): string | null {
  let searchDemand = 0;
  for (const v of Object.values(relations ?? {})) {
    searchDemand += Array.isArray(v) ? v.length : 1;
  }
  const objectDemand = relationPlans.reduce((n, p) => n + p.toCreate.length, 0) + 1;
  if (searchDemand > RATE_WINDOW_MAX || objectDemand > RATE_WINDOW_MAX) {
    return (
      `Note: large write — ${searchDemand} relation refs / ${objectDemand} target writes ` +
      `against a 30-per-60s limit; may pace internally (up to ~60s). Split into smaller batches for snappier writes.`
    );
  }
  return null;
}

// --- Property-key resolution: NAME or id (D2) -------------------------------
//
// `properties`/`labels`/`relations` map keys accept either a property-def id
// (exact match, checked first) or a property NAME (case-insensitive, matched
// against the structure's propertyDefinitions). Structure is already in hand
// (create_object/update_object both fetch space info), so this is free — no
// extra API calls. Id wins outright over any looser name match (A3).
export interface PropertyIndex {
  byId: Map<string, PropertyDefinition>;
  byName: Map<string, PropertyDefinition[]>;
}

export function buildPropertyIndex(structure: CapacitiesStructure): PropertyIndex {
  const byId = new Map<string, PropertyDefinition>();
  const byName = new Map<string, PropertyDefinition[]>();
  for (const p of structure.propertyDefinitions) {
    byId.set(p.id, p);
    const nameKey = normalize(p.name);
    const arr = byName.get(nameKey) ?? [];
    arr.push(p);
    byName.set(nameKey, arr);
  }
  return { byId, byName };
}

type PropResolution = { def: PropertyDefinition } | { problem: string };

export function resolvePropertyKey(index: PropertyIndex, key: string): PropResolution {
  const byId = index.byId.get(key);
  if (byId) return { def: byId };
  const matches = index.byName.get(normalize(key)) ?? [];
  if (matches.length === 1) return { def: matches[0] };
  if (matches.length > 1) {
    return {
      problem: `\`${key}\` is ambiguous — matches ${matches.length} properties by name; use the property id`
    };
  }
  return { problem: `unknown property \`${key}\`` };
}

// --- Shared wrapper-building machinery (cap-6dy.12) ------------------------

// A planned relation write. Resolution is READ-ONLY; `toCreate` names are
// materialized only after the problem gate by finalizeRelationPlans.
export interface RelationPlan {
  propId: string;
  defName: string;
  linkedIds: string[];
  linkedNames: string[];
  toCreate: string[];
  targetStructure?: string;
}

export interface WrapperBuild {
  wrappers: Record<string, unknown>;
  problems: string[];
  setSummary: string[];
  relationPlans: RelationPlan[];
}

export interface WrapperInputs {
  title?: string;
  properties?: Record<string, string | number | boolean>;
  labels?: Record<string, string | string[]>;
  relations?: Record<string, string | string[]>;
  createMissingRelations: boolean;
}

/**
 * WRITE-FREE. Builds title/scalar/label typed-wrapper property values,
 * accumulates every input problem (unknown/read-only/wrong-map/etc.), and PLANS
 * — but does not execute — relation auto-creation. Relation resolution here is
 * read-only; materializing missing targets is deferred to finalizeRelationPlans
 * so a later validation failure never leaves orphaned entities behind.
 *
 * `title` is optional: the title wrapper is set only when provided (create
 * always passes it; update may omit it).
 */
export async function buildWrappers(
  client: CapacitiesClient,
  structure: CapacitiesStructure,
  inputs: WrapperInputs,
  // Operation-level bounded-wait budget, forwarded to relation resolution so its
  // per-name searches are paced across a window reset (cap-6dy.19).
  pace?: WaitBudget
): Promise<WrapperBuild> {
  const { title, properties, labels, relations, createMissingRelations } = inputs;

  const propIndex = buildPropertyIndex(structure);

  const titlePropId =
    structure.propertyDefinitions.find(p => p.type === "title")?.id ?? "title";

  const wrappers: Record<string, unknown> = {};
  if (title !== undefined) {
    wrappers[titlePropId] = { type: "title", title: { value: title } };
  }

  const problems: string[] = [];
  const setSummary: string[] = [];
  const relationPlans: RelationPlan[] = [];

  // Scalar properties.
  for (const [key, value] of Object.entries(properties ?? {})) {
    const resolved = resolvePropertyKey(propIndex, key);
    if ("problem" in resolved) {
      problems.push(resolved.problem);
      continue;
    }
    const def = resolved.def;
    const propId = def.id;
    if (!def.writable) {
      problems.push(`\`${key}\` is read-only`);
      continue;
    }
    if (def.type === "label" || def.type === "entity") {
      problems.push(
        `use the ${def.type === "label" ? "labels" : "relations"} map for \`${key}\``
      );
      continue;
    }
    if (!SCALAR_TYPES.has(def.type)) {
      problems.push(`type \`${def.type}\` is not supported`);
      continue;
    }

    switch (def.type) {
      case "text":
        wrappers[propId] = { type: "text", text: { value: String(value) } };
        setSummary.push(`${def.name}=${String(value)}`);
        break;
      case "url":
        wrappers[propId] = { type: "url", url: { value: String(value) } };
        setSummary.push(`${def.name}=${String(value)}`);
        break;
      case "number": {
        const n = Number(value);
        if (Number.isNaN(n)) {
          problems.push(`\`${key}\` value is not a number: ${String(value)}`);
          break;
        }
        wrappers[propId] = { type: "number", number: { value: n } };
        setSummary.push(`${def.name}=${n}`);
        break;
      }
      case "boolean": {
        let b: boolean;
        if (typeof value === "boolean") {
          b = value;
        } else if (typeof value === "string") {
          const s = value.trim().toLowerCase();
          if (s === "true") {
            b = true;
          } else if (s === "false") {
            b = false;
          } else {
            problems.push(`\`${key}\` value is not a boolean: ${String(value)}`);
            break;
          }
        } else if (typeof value === "number") {
          if (value === 1) {
            b = true;
          } else if (value === 0) {
            b = false;
          } else {
            problems.push(`\`${key}\` value is not a boolean: ${String(value)}`);
            break;
          }
        } else {
          problems.push(`\`${key}\` value is not a boolean: ${String(value)}`);
          break;
        }
        wrappers[propId] = { type: "boolean", boolean: { value: b } };
        setSummary.push(`${def.name}=${b}`);
        break;
      }
      case "date": {
        if (typeof value !== "string") {
          problems.push(
            `\`${key}\` date must be an ISO-8601 string, got ${typeof value}: ${String(value)}`
          );
          break;
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          problems.push(`\`${key}\` value is not a valid date: ${String(value)}`);
          break;
        }
        const iso = parsed.toISOString();
        wrappers[propId] = {
          type: "date",
          date: { start: iso, dateResolution: "time" }
        };
        setSummary.push(`${def.name}=${iso}`);
        break;
      }
    }
  }

  // Labels (set by option NAME).
  for (const [key, rawNames] of Object.entries(labels ?? {})) {
    const resolved = resolvePropertyKey(propIndex, key);
    if ("problem" in resolved) {
      problems.push(resolved.problem);
      continue;
    }
    const def = resolved.def;
    const propId = def.id;
    if (!def.writable) {
      problems.push(`\`${key}\` is read-only`);
      continue;
    }
    if (def.type !== "label") {
      problems.push(`\`${key}\` is not a label property`);
      continue;
    }

    const names = toArray(rawNames);
    if (!def.multiple && names.length > 1) {
      problems.push(`\`${key}\` is single-select`);
      continue;
    }

    const options = def.labelSet ?? [];
    const matched: { id: string; name: string }[] = [];
    let hadUnknown = false;
    for (const name of names) {
      const opt = options.find(o => normalize(o.name) === normalize(name));
      if (!opt) {
        const valid = options.map(o => o.name).join(", ");
        problems.push(`unknown option \`${name}\` for \`${key}\`; valid: ${valid}`);
        hadUnknown = true;
        continue;
      }
      matched.push({ id: opt.id, name: opt.name });
    }
    if (hadUnknown) continue;

    wrappers[propId] = { type: "label", label: matched };
    setSummary.push(`${def.name}=${matched.map(m => m.name).join(", ")}`);
  }

  // Relations (set by entity NAME, resolved strictly). Resolution here is
  // READ-ONLY — any auto-creation of missing targets is DEFERRED to
  // finalizeRelationPlans (after the caller's problem gate), so a validation
  // failure in a later property never leaves orphaned entities behind.
  for (const [key, rawNames] of Object.entries(relations ?? {})) {
    const resolved = resolvePropertyKey(propIndex, key);
    if ("problem" in resolved) {
      problems.push(resolved.problem);
      continue;
    }
    const def = resolved.def;
    const propId = def.id;
    if (!def.writable) {
      problems.push(`\`${key}\` is read-only`);
      continue;
    }
    if (def.type !== "entity") {
      problems.push(`\`${key}\` is not a relation (entity) property`);
      continue;
    }

    const names = toArray(rawNames);
    // resolveEntities is write-free — it only classifies (linked/unmatched/
    // ambiguous/truncated); auto-create is handled later by finalizeRelationPlans.
    const r = await resolveEntities(client, names, def.allowedStructures, { pace });

    if (r.ambiguous.length > 0) {
      for (const a of r.ambiguous) {
        const cands = a.candidates.map(c => `${c.title} (${c.id})`).join(", ");
        problems.push(
          `ambiguous relation \`${a.name}\` for \`${propId}\`: multiple matches: ${cands}`
        );
      }
      continue;
    }

    // cap-6dy.22: the title search hit the 50-result cap with no exact match, so a
    // matching object may exist beyond it. Refuse rather than risk an auto-created
    // duplicate — even if create_missing_relations is off, a "not found" here would
    // be misleading. Ask for a more specific/unique name.
    if (r.truncated.length > 0) {
      problems.push(
        `could not confirm ${r.truncated.join(", ")} for \`${propId}\`: the title search returned the maximum ${SEARCH_LIMIT} results with no exact match, so a matching object may exist beyond the cap. Use a more specific/unique name to avoid creating a duplicate.`
      );
      continue;
    }

    const linkedIds = r.linked.map(l => l.id);
    const linkedNames = r.linked.map(l => l.name);

    if (r.unmatched.length > 0) {
      if (!createMissingRelations) {
        problems.push(
          `unresolved \`${propId}\` names: ${r.unmatched.join(", ")} (pass create_missing_relations:true to create)`
        );
        continue;
      }
      // Auto-create needs exactly one target structure to create into.
      if (!def.allowedStructures || def.allowedStructures.length !== 1) {
        problems.push(
          `cannot auto-create ${r.unmatched.join(", ")} for \`${propId}\`: relation permits ${def.allowedStructures?.length ?? 0} target structures, need exactly 1`
        );
        continue;
      }
      relationPlans.push({
        propId,
        defName: def.name,
        linkedIds,
        linkedNames,
        toCreate: r.unmatched,
        targetStructure: def.allowedStructures[0]
      });
    } else {
      relationPlans.push({ propId, defName: def.name, linkedIds, linkedNames, toCreate: [] });
    }
  }

  return { wrappers, problems, setSummary, relationPlans };
}

/**
 * Executed only AFTER the caller's problem gate. Creates any missing relation
 * targets (title-only objects of the plan's targetStructure), finalizes each
 * relation's entity wrapper, appends relation summary lines, and records the
 * created names into `createdEntities`.
 */
export async function finalizeRelationPlans(
  client: CapacitiesClient,
  structures: CapacitiesStructure[],
  wrappers: Record<string, unknown>,
  relationPlans: RelationPlan[],
  setSummary: string[],
  createdEntities: string[],
  // Operation-level bounded-wait budget, forwarded to the auto-create calls so a
  // many-target composite write is paced across a window reset (cap-6dy.19).
  pace?: WaitBudget
): Promise<void> {
  const createEntity = async (name: string, structureId: string): Promise<string> => {
    const target = structures.find(s => s.id === structureId);
    const titleId =
      target?.propertyDefinitions.find(p => p.type === "title")?.id ?? "title";
    const obj = await client.createObject({
      structureId,
      properties: { [titleId]: { type: "title", title: { value: name } } }
    }, pace);
    createdEntities.push(name);
    return obj.id;
  };

  for (const plan of relationPlans) {
    const ids = [...plan.linkedIds];
    const names = [...plan.linkedNames];
    for (const name of plan.toCreate) {
      const id = await createEntity(name, plan.targetStructure!);
      ids.push(id);
      names.push(name);
    }
    wrappers[plan.propId] = { type: "entity", entity: ids.map(id => ({ id })) };
    if (names.length > 0) setSummary.push(`${plan.defName}=${names.join(", ")}`);
  }
}

// --- Tool registration -----------------------------------------------------

export function setupObjectTools(server: McpServer, client: CapacitiesClient) {
  server.registerTool(
    "create_object",
    {
      title: "Create Capacities Object",
      description:
        "Create a new object of any structure in your Capacities space. " +
        "Call `get_space_info` first to get structure_id, property ids, label options, and relation target types. " +
        "Scalar properties (text/url/number/boolean/date) go in `properties` keyed by property NAME or id; dates are ISO-8601 strings. " +
        "Labels go in `labels` (keyed by property NAME or id, values are option NAMES) and relations go in `relations` (keyed by property NAME or id, values are entity NAMES). " +
        "Relations and labels are set by NAME and resolved strictly — an unknown name is an error, never a guess. " +
        "Pass `create_missing_relations: true` to auto-create unmatched relation targets. " +
        "`update_object` (not this tool) replaces; this creates.",
      inputSchema: {
        structure_id: z
          .string()
          .describe("Structure id (UUID or built-in id like RootTask) from get_space_info"),
        title: z.string().describe("Title of the new object"),
        properties: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe(
            "Scalar props keyed by property NAME or id: text/url/number/boolean/date. Date = ISO-8601 string."
          ),
        labels: z
          .record(z.union([z.string(), z.array(z.string())]))
          .optional()
          .describe("Label props keyed by property NAME or id; value(s) are option NAME(s)"),
        relations: z
          .record(z.union([z.string(), z.array(z.string())]))
          .optional()
          .describe("Entity (relation) props keyed by property NAME or id; value(s) are entity NAME(s), resolved strictly"),
        create_missing_relations: z
          .boolean()
          .default(false)
          .describe("Auto-create relation targets that don't already exist"),
        body: z.string().optional().describe("Markdown body appended to the object after creation." + MARKDOWN_BODY_NOTE),
        collections: z.array(z.string()).optional().describe("Collection ids to add the object to")
      }
    },
    async ({
      structure_id,
      title,
      properties,
      labels,
      relations,
      create_missing_relations,
      body,
      collections
    }) => {
      try {
        // 1. Resolve the target structure.
        const { structures } = await client.getSpaceInfo();
        const structure = structures.find(s => s.id === structure_id);
        if (!structure) {
          const available = structures.map(s => `${s.id} (${s.title})`).join(", ");
          return {
            content: [
              {
                type: "text",
                text: `Structure "${structure_id}" not found. Available structures: ${available}`
              }
            ],
            isError: true
          };
        }

        // Operation-level bounded-wait budget (~one window). Shared across the
        // resolution searches, the auto-create loop, and the final write so a
        // many-relation write can absorb one window reset (cap-6dy.19).
        const budget: WaitBudget = { remainingMs: WINDOW_MS };

        // 2. Build all wrappers (write-free; relation auto-create is planned only).
        const { wrappers, problems, setSummary, relationPlans } = await buildWrappers(
          client,
          structure,
          { title, properties, labels, relations, createMissingRelations: create_missing_relations },
          budget
        );

        // 3. Fail-before-create if any problems accumulated.
        if (problems.length > 0) {
          return {
            content: [
              { type: "text", text: "Cannot create object:\n- " + problems.join("\n- ") }
            ],
            isError: true
          };
        }

        // 4. All validation passed — now (and only now) materialize missing
        //    relation targets and finalize their entity wrappers.
        const createdEntities: string[] = [];
        try {
          await finalizeRelationPlans(
            client,
            structures,
            wrappers,
            relationPlans,
            setSummary,
            createdEntities,
            budget
          );
        } catch (error) {
          const msg =
            error instanceof CapacitiesAPIError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error);
          const reuseNote =
            createdEntities.length > 0
              ? ` These were already created and will be reused (not duplicated) if you retry: ${createdEntities.join(", ")}.`
              : "";
          return {
            content: [
              {
                type: "text",
                text: `Failed while creating relation targets: ${msg}.${reuseNote} The object itself was not created.`
              }
            ],
            isError: true
          };
        }

        // 5. Create the object (paced with the same operation budget).
        const created = await client.createObject({
          structureId: structure_id,
          properties: wrappers,
          ...(collections ? { collections } : {})
        }, budget);

        // 6. Optionally append the markdown body (object already exists).
        let bodyStatus = "";
        if (body) {
          try {
            await client.appendBlocks({ id: created.id, markdown: body });
            bodyStatus = "\nBody: appended";
          } catch (e) {
            bodyStatus = `\nBody: append FAILED — ${
              e instanceof Error ? e.message : String(e)
            }`;
          }
        }

        // 7. Success summary.
        const summaryLine =
          setSummary.length > 0 ? `\nProperties set: ${setSummary.join("; ")}` : "";
        const createdLine =
          createdEntities.length > 0
            ? `\nCreated relation targets: ${createdEntities.join(", ")}`
            : "";
        const warning = largeBatchWarning(relations, relationPlans);
        const warnLine = warning ? `\n${warning}` : "";

        return {
          content: [
            {
              type: "text",
              text:
                `Created ${structure.title} "${title}"\nID: ${created.id}` +
                summaryLine +
                createdLine +
                bodyStatus +
                warnLine
            }
          ]
        };
      } catch (error) {
        // 8. Surface CapacitiesAPIError bodies (e.g. a 400 with a validation body)
        //    so the LLM can self-correct.
        const message =
          error instanceof CapacitiesAPIError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        return {
          content: [{ type: "text", text: `Failed to create object: ${message}` }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "update_object",
    {
      title: "Update Capacities Object",
      description:
        "Replace typed properties of an existing object (PATCH /object). Only the properties you name are " +
        "changed; unnamed properties are left intact. WARNING: for a named property this REPLACES its value " +
        "— it does NOT append. Naming a multi-value relation/label drops the prior list and sets exactly " +
        "what you pass. To ADD to a relation, first read the current values (this tool reports them) and " +
        "pass the full desired list. The optional `body` param is a convenience: after the PATCH, it also " +
        "appends markdown to the object's body (POST /blocks/append) — the same additive write " +
        "`append_to_object` performs on its own. " +
        "Labels and relations are set by NAME and resolved strictly — an unknown name is an error. " +
        "`properties`/`labels`/`relations` map keys accept a property NAME or id. " +
        "Pass `create_missing_relations: true` to auto-create unmatched relation targets.",
      inputSchema: {
        objectId: z.string().describe("objectId of the object to update"),
        title: z.string().optional().describe("New title for the object"),
        properties: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe(
            "Scalar props keyed by property NAME or id: text/url/number/boolean/date. REPLACES each named value."
          ),
        labels: z
          .record(z.union([z.string(), z.array(z.string())]))
          .optional()
          .describe("Label props keyed by property NAME or id; value(s) are option NAME(s). REPLACES the named prop."),
        relations: z
          .record(z.union([z.string(), z.array(z.string())]))
          .optional()
          .describe("Entity (relation) props keyed by property NAME or id; value(s) are entity NAME(s). REPLACES the named prop."),
        create_missing_relations: z
          .boolean()
          .default(false)
          .describe("Auto-create relation targets that don't already exist"),
        body: z.string().optional().describe("Markdown body appended to the object after the update." + MARKDOWN_BODY_NOTE),
        collections: z.array(z.string()).optional().describe("Collection ids to set on the object")
      }
    },
    async ({
      objectId,
      title,
      properties,
      labels,
      relations,
      create_missing_relations,
      body,
      collections
    }) => {
      try {
        // 0. No-op guard: nothing to write. #PATH_DECISION — return a friendly
        //    message rather than issuing an empty PATCH.
        const hasWork =
          title !== undefined ||
          (properties && Object.keys(properties).length > 0) ||
          (labels && Object.keys(labels).length > 0) ||
          (relations && Object.keys(relations).length > 0) ||
          body !== undefined ||
          collections !== undefined;
        if (!hasWork) {
          return {
            content: [
              {
                type: "text",
                text: `Nothing to update for ${objectId} — provide a title, properties, labels, relations, body, or collections.`
              }
            ]
          };
        }

        // 1. Read the current STRUCTURED object (typed-wrapper properties, for
        //    structureId + prior replace-audit values) and the space structures.
        //    getSpaceInfo takes no input from getObject, so run them concurrently
        //    (distinct rate windows — object vs space) (cap-6dy.24 #2).
        const [current, { structures }] = await Promise.all([
          client.getObject(objectId),
          client.getSpaceInfo()
        ]);
        const structure = structures.find(s => s.id === current.structureId);
        if (!structure) {
          const available = structures.map(s => `${s.id} (${s.title})`).join(", ");
          return {
            content: [
              {
                type: "text",
                text: `Structure "${current.structureId}" for object ${objectId} not found. Available structures: ${available}`
              }
            ],
            isError: true
          };
        }

        // Operation-level bounded-wait budget (~one window), shared across
        // resolution searches, auto-creates, and the final PATCH (cap-6dy.19).
        const budget: WaitBudget = { remainingMs: WINDOW_MS };

        // 3. Build wrappers (write-free; relation auto-create is planned only).
        const { wrappers, problems, setSummary, relationPlans } = await buildWrappers(
          client,
          structure,
          { title, properties, labels, relations, createMissingRelations: create_missing_relations },
          budget
        );

        // 4. Fail-before-write if any problems accumulated — write NOTHING.
        if (problems.length > 0) {
          return {
            content: [
              { type: "text", text: "Cannot update object:\n- " + problems.join("\n- ") }
            ],
            isError: true
          };
        }

        // 5. Replace-audit: for every multi-value (label/entity) prop we are about
        //    to write, capture the PRIOR value from the structured object so the
        //    success message can show `replaced <name>: <prior> → <new>`. This
        //    operationalizes the replace warning. Best-effort: structured entity
        //    values carry ids (not titles), so relations report a prior count.
        //    Keys accept a property NAME or id (D2) — resolve to the real id
        //    before indexing into `current.properties`, which the API keys by id.
        //    Built AFTER the fail gate so the early-return path skips it (cap-6dy.24 #5).
        const propIndex = buildPropertyIndex(structure);

        const replaceAudit: string[] = [];
        const namedMultiKeys = [
          ...Object.keys(labels ?? {}),
          ...Object.keys(relations ?? {})
        ];
        for (const key of namedMultiKeys) {
          const resolved = resolvePropertyKey(propIndex, key);
          if ("problem" in resolved) continue; // already surfaced as a problem
          const def = resolved.def;
          const prior = (current.properties ?? {})[def.id] as any;
          if (def.type === "label") {
            const priorNames: string[] = Array.isArray(prior?.label)
              ? prior.label.map((o: any) => o?.name).filter(Boolean)
              : [];
            const nextNames = toArray(labels![key]);
            replaceAudit.push(
              `replaced ${def.name}: ${
                priorNames.length ? priorNames.join(", ") : "(empty)"
              } → ${nextNames.join(", ")}`
            );
          } else if (def.type === "entity") {
            const priorCount = Array.isArray(prior?.entity) ? prior.entity.length : 0;
            const nextCount = toArray(relations![key]).length;
            replaceAudit.push(
              `replaced ${def.name}: ${priorCount} linked → ${nextCount} linked`
            );
          }
        }

        // 6. All validation passed — materialize missing relation targets.
        const createdEntities: string[] = [];
        try {
          await finalizeRelationPlans(
            client,
            structures,
            wrappers,
            relationPlans,
            setSummary,
            createdEntities,
            budget
          );
        } catch (error) {
          const msg =
            error instanceof CapacitiesAPIError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error);
          const reuseNote =
            createdEntities.length > 0
              ? ` These were already created and will be reused (not duplicated) if you retry: ${createdEntities.join(", ")}.`
              : "";
          return {
            content: [
              {
                type: "text",
                text: `Failed while creating relation targets: ${msg}.${reuseNote} The object itself was not updated.`
              }
            ],
            isError: true
          };
        }

        // 7. PATCH the object (merges by key; replaces each named prop's value;
        //    paced with the same operation budget).
        const updated = await client.updateObject({
          id: objectId,
          properties: wrappers,
          ...(collections ? { collections } : {})
        }, budget);

        // 8. Optionally append the markdown body (update already succeeded).
        let bodyStatus = "";
        if (body) {
          try {
            await client.appendBlocks({ id: updated.id ?? objectId, markdown: body });
            bodyStatus = "\nBody: appended";
          } catch (e) {
            bodyStatus = `\nBody: append FAILED — ${
              e instanceof Error ? e.message : String(e)
            }`;
          }
        }

        // 9. Success summary.
        const summaryLine =
          setSummary.length > 0 ? `\nProperties set: ${setSummary.join("; ")}` : "";
        const auditLine =
          replaceAudit.length > 0 ? `\n${replaceAudit.join("\n")}` : "";
        const createdLine =
          createdEntities.length > 0
            ? `\nCreated relation targets: ${createdEntities.join(", ")}`
            : "";
        const warning = largeBatchWarning(relations, relationPlans);
        const warnLine = warning ? `\n${warning}` : "";

        return {
          content: [
            {
              type: "text",
              text:
                `Updated ${structure.title} ${objectId}` +
                summaryLine +
                auditLine +
                createdLine +
                bodyStatus +
                warnLine
            }
          ]
        };
      } catch (error) {
        const message =
          error instanceof CapacitiesAPIError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        return {
          content: [{ type: "text", text: `Failed to update object: ${message}` }],
          isError: true
        };
      }
    }
  );

  // --- Thin object tools (cap-6dy.13) --------------------------------------
  // Each wraps a single client call: append body, read-as-markdown, delete.

  server.registerTool(
    "append_to_object",
    {
      title: "Append to Capacities Object",
      description:
        "Append markdown to the END of an existing object's body (POST /blocks/append) — additive, never " +
        "removes, and never touches typed properties. This is the body counterpart to update_object, which " +
        "replaces typed properties (scalars/labels/relations) via PATCH /object. Use update_object to change " +
        "properties; use this to add notes/body.",
      inputSchema: {
        objectId: z.string().describe("objectId of the object to append to"),
        markdown: z.string().describe("Markdown content to append to the object's body." + MARKDOWN_BODY_NOTE)
      }
    },
    async ({ objectId, markdown }) => {
      try {
        await client.appendBlocks({ id: objectId, markdown });
        return {
          content: [{ type: "text", text: `Appended body to object ${objectId}.` }]
        };
      } catch (error) {
        const message =
          error instanceof CapacitiesAPIError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        return {
          content: [{ type: "text", text: `Failed to append to object: ${message}` }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "get_object",
    {
      title: "Get Capacities Object (Markdown)",
      description:
        "Read an object rendered as Markdown (YAML frontmatter of its properties + body).",
      inputSchema: {
        objectId: z.string().describe("objectId of the object to read")
      }
    },
    async ({ objectId }) => {
      try {
        const obj = await client.getObjectMarkdown(objectId);
        const header = obj.structureId ? `Structure: ${obj.structureId}\n\n` : "";
        return {
          content: [{ type: "text", text: header + (obj.markdown ?? "") }]
        };
      } catch (error) {
        const message =
          error instanceof CapacitiesAPIError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        return {
          content: [{ type: "text", text: `Failed to read object: ${message}` }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "delete_object",
    {
      title: "Delete Capacities Object",
      description:
        "Delete an object. By default (hard_delete=false) it moves to trash and is " +
        "recoverable in Capacities. Pass hard_delete=true to permanently delete — " +
        "this cannot be undone.",
      inputSchema: {
        objectId: z.string().describe("objectId of the object to delete"),
        hard_delete: z
          .boolean()
          .default(false)
          .describe(
            "false (default) moves to trash (recoverable); true permanently deletes (cannot be undone)"
          )
      }
    },
    async ({ objectId, hard_delete }) => {
      try {
        await client.deleteObject(objectId, hard_delete);
        const disposition = hard_delete
          ? "permanently deleted (cannot be undone)"
          : "moved to trash (recoverable in Capacities)";
        return {
          content: [{ type: "text", text: `Object ${objectId} ${disposition}.` }]
        };
      } catch (error) {
        const message =
          error instanceof CapacitiesAPIError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        return {
          content: [{ type: "text", text: `Failed to delete object: ${message}` }],
          isError: true
        };
      }
    }
  );
}

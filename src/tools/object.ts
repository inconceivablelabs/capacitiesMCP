// File: src/tools/object.ts
//
// create_object — the flagship generic-create tool (cap-6dy.11). Composes a
// POST /object call from human-readable input: scalar properties, label options
// by NAME, and entity relations by NAME (resolved strictly via resolveEntities).
//
// Contract: VALIDATE FULLY BEFORE WRITING. Every input problem is accumulated
// and returned as one isError message WITHOUT creating anything — no half-built
// objects. Only once all wrappers are valid do we POST /object, then optionally
// append a markdown body via /blocks/append.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient, CapacitiesAPIError } from "../client/capacities.js";
import { PropertyDefinition } from "../client/types.js";
import { resolveEntities } from "./resolution.js";

// Scalar property types handled by the `properties` map.
const SCALAR_TYPES = new Set(["text", "url", "number", "boolean", "date"]);

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function toArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

export function setupObjectTools(server: McpServer, client: CapacitiesClient) {
  server.registerTool(
    "create_object",
    {
      title: "Create Capacities Object",
      description:
        "Create a new object of any structure in your Capacities space. " +
        "Call `get_space_info` first to get structure_id, property ids, label options, and relation target types. " +
        "Scalar properties (text/url/number/boolean/date) go in `properties` keyed by property id; dates are ISO-8601 strings. " +
        "Labels go in `labels` (keyed by property id, values are option NAMES) and relations go in `relations` (keyed by property id, values are entity NAMES). " +
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
            "Scalar props keyed by property-def id: text/url/number/boolean/date. Date = ISO-8601 string."
          ),
        labels: z
          .record(z.union([z.string(), z.array(z.string())]))
          .optional()
          .describe("Label props keyed by property-def id; value(s) are option NAME(s)"),
        relations: z
          .record(z.union([z.string(), z.array(z.string())]))
          .optional()
          .describe("Entity (relation) props keyed by property-def id; value(s) are entity NAME(s), resolved strictly"),
        create_missing_relations: z
          .boolean()
          .default(false)
          .describe("Auto-create relation targets that don't already exist"),
        body: z.string().optional().describe("Markdown body appended to the object after creation"),
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
          const available = structures
            .map(s => `${s.id} (${s.title})`)
            .join(", ");
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

        const propMap = new Map<string, PropertyDefinition>();
        for (const p of structure.propertyDefinitions) propMap.set(p.id, p);

        // 2. Title wrapper under the structure's title prop id.
        const titlePropId =
          structure.propertyDefinitions.find(p => p.type === "title")?.id ?? "title";

        const wrappers: Record<string, unknown> = {
          [titlePropId]: { type: "title", title: { value: title } }
        };

        const problems: string[] = [];
        // Short human-readable summary fragments for the success message.
        const setSummary: string[] = [];
        const createdEntities: string[] = [];

        // 3a. Scalar properties.
        for (const [propId, value] of Object.entries(properties ?? {})) {
          const def = propMap.get(propId);
          if (!def) {
            problems.push(`unknown property \`${propId}\``);
            continue;
          }
          if (!def.writable) {
            problems.push(`\`${propId}\` is read-only`);
            continue;
          }
          if (def.type === "label" || def.type === "entity") {
            problems.push(
              `use the ${def.type === "label" ? "labels" : "relations"} map for \`${propId}\``
            );
            continue;
          }
          if (!SCALAR_TYPES.has(def.type)) {
            problems.push(`type \`${def.type}\` not supported in create_object v1`);
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
                problems.push(`\`${propId}\` value is not a number: ${String(value)}`);
                break;
              }
              wrappers[propId] = { type: "number", number: { value: n } };
              setSummary.push(`${def.name}=${n}`);
              break;
            }
            case "boolean":
              wrappers[propId] = { type: "boolean", boolean: { value: Boolean(value) } };
              setSummary.push(`${def.name}=${Boolean(value)}`);
              break;
            case "date": {
              const parsed = new Date(value as string);
              if (Number.isNaN(parsed.getTime())) {
                problems.push(`\`${propId}\` value is not a valid date: ${String(value)}`);
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

        // 3b. Labels (set by option NAME).
        for (const [propId, rawNames] of Object.entries(labels ?? {})) {
          const def = propMap.get(propId);
          if (!def) {
            problems.push(`unknown property \`${propId}\``);
            continue;
          }
          if (!def.writable) {
            problems.push(`\`${propId}\` is read-only`);
            continue;
          }
          if (def.type !== "label") {
            problems.push(`\`${propId}\` is not a label property`);
            continue;
          }

          const names = toArray(rawNames);
          if (!def.multiple && names.length > 1) {
            problems.push(`\`${propId}\` is single-select`);
            continue;
          }

          const options = def.labelSet ?? [];
          const matched: { id: string; name: string }[] = [];
          let hadUnknown = false;
          for (const name of names) {
            const opt = options.find(o => normalize(o.name) === normalize(name));
            if (!opt) {
              const valid = options.map(o => o.name).join(", ");
              problems.push(
                `unknown option \`${name}\` for \`${propId}\`; valid: ${valid}`
              );
              hadUnknown = true;
              continue;
            }
            matched.push({ id: opt.id, name: opt.name });
          }
          if (hadUnknown) continue;

          wrappers[propId] = { type: "label", label: matched };
          setSummary.push(`${def.name}=${matched.map(m => m.name).join(", ")}`);
        }

        // 3c. Relations (set by entity NAME, resolved strictly). Resolution here
        //     is READ-ONLY — any auto-creation of missing targets is DEFERRED
        //     until after the problem gate (step 5b), so a validation failure in
        //     a later property never leaves orphaned entities behind. This keeps
        //     the fail-before-create guarantee true for created targets too.
        const relationPlans: {
          propId: string;
          defName: string;
          linkedIds: string[];
          linkedNames: string[];
          toCreate: string[];
          targetStructure?: string;
        }[] = [];

        for (const [propId, rawNames] of Object.entries(relations ?? {})) {
          const def = propMap.get(propId);
          if (!def) {
            problems.push(`unknown property \`${propId}\``);
            continue;
          }
          if (!def.writable) {
            problems.push(`\`${propId}\` is read-only`);
            continue;
          }
          if (def.type !== "entity") {
            problems.push(`\`${propId}\` is not a relation (entity) property`);
            continue;
          }

          const names = toArray(rawNames);
          // No createEntity passed → resolveEntities performs no writes.
          const r = await resolveEntities(client, names, def.allowedStructures, {});

          if (r.ambiguous.length > 0) {
            for (const a of r.ambiguous) {
              const cands = a.candidates
                .map(c => `${c.title} (${c.id})`)
                .join(", ");
              problems.push(
                `ambiguous relation \`${a.name}\` for \`${propId}\`: multiple matches: ${cands}`
              );
            }
            continue;
          }

          const linkedIds = r.linked.map(l => l.id);
          const linkedNames = r.linked.map(l => l.name);

          if (r.unmatched.length > 0) {
            if (!create_missing_relations) {
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

        // 4. Fail-before-create if any problems accumulated.
        if (problems.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: "Cannot create object:\n- " + problems.join("\n- ")
              }
            ],
            isError: true
          };
        }

        // 5a. All validation passed — now (and only now) create any missing
        //     relation targets and finalize their entity wrappers.
        const createEntity = async (name: string, structureId: string): Promise<string> => {
          const target = structures.find(s => s.id === structureId);
          const titleId =
            target?.propertyDefinitions.find(p => p.type === "title")?.id ?? "title";
          const obj = await client.createObject({
            structureId,
            properties: { [titleId]: { type: "title", title: { value: name } } }
          });
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

        // 5b. Create the object.
        const created = await client.createObject({
          structureId: structure_id,
          properties: wrappers,
          ...(collections ? { collections } : {})
        });

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

        return {
          content: [
            {
              type: "text",
              text:
                `Created ${structure.title} "${title}"\nID: ${created.id}` +
                summaryLine +
                createdLine +
                bodyStatus
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
}

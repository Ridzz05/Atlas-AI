/**
 * How an ATLAS tool name is spelled on the wire.
 *
 * ATLAS names tools with a namespace dot — `web.search`, `lead.score`,
 * `memory.propose_write` — and addresses them by that name in agent definitions, allowlists, the
 * approval matrix and the audit trail. The [OI] function-calling format allows only
 * `[a-zA-Z0-9_-]` in `function.name`, and a gateway that enforces the format rejects the whole
 * request rather than the offending field: zRouter answers a dotted name with HTTP 400 and
 * `{"error":{"message":"Invalid request. Check your request parameters."}}`, so every agent that
 * declared a tool failed before the model was reached, with nothing in the response naming the
 * cause.
 *
 * The transport is the only layer that knows this constraint, so it owns the translation. The
 * translation has to be reversible: the name the runner hands to the Tool Gateway must be the name
 * the registry is keyed by.
 *
 * Encoding is a per-request bijection, not a naming convention: two tools whose names collide once
 * encoded (`web.search` and `web_search`) get distinct wire names, and each maps back to exactly
 * one registry name.
 */

const DISALLOWED = /[^a-zA-Z0-9_-]/g;
const MAX_WIRE_NAME_LENGTH = 64;

export class ToolNameCodec {
  private readonly wireNames = new Map<string, string>();
  private readonly registryNames = new Map<string, string>();

  /** The name to send for `name`, assigning one on first use. */
  public toWire(name: string): string {
    const existing = this.wireNames.get(name);
    if (existing) return existing;

    const wire = this.assign(name);
    this.wireNames.set(name, wire);
    this.registryNames.set(wire, name);
    return wire;
  }

  /**
   * The registry name behind a wire name.
   *
   * A model can name a tool that was never offered — the answer is the name it sent, so the Tool
   * Gateway rejects it as unknown instead of this layer inventing a mapping.
   */
  public toRegistry(wireName: string): string {
    return this.registryNames.get(wireName) ?? wireName;
  }

  private assign(name: string): string {
    const base = name.replace(DISALLOWED, '_') || 'tool';
    let candidate = base.slice(0, MAX_WIRE_NAME_LENGTH);
    let suffix = 2;

    while (this.registryNames.has(candidate)) {
      const tail = `_${suffix}`;
      candidate = `${base.slice(0, MAX_WIRE_NAME_LENGTH - tail.length)}${tail}`;
      suffix += 1;
    }

    return candidate;
  }
}

/** Whether a name can be sent as-is; the format the wire protocol declares. */
export function isWireSafeToolName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_WIRE_NAME_LENGTH && !DISALLOWED.test(name);
}

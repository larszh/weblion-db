import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages';
import type { AiToolName } from '@weblion/shared';
import { toStrictJsonSchema } from '../schema';
import { checkWebsiteDns, getWebsite, listWebsites } from './websites';
import { getDnsRecords, getDomain, listDomains } from './domains';
import { getMailDnsSetup, getMailDomain, listMailDomains } from './mail';
import { getMonitor, getMonitoring } from './monitoring';
import { getAuditLog, getBillingSummary, getOrgOverview } from './org';
import { proposeDnsRecord } from './proposals';
import { getServer, getServerActivity, getServerMetrics, listServers } from './servers';
import { getCloudStorage, getPhoneSystems, getStreaming } from './services';
import type { AiTool } from './types';

/**
 * The assistant's 22 tools (ai 8.2 to 8.4), sorted by name so the tool list, and with it the cached prompt prefix,
 * is byte-identical in every request (prompt caching is a prefix match: tools, then system, then messages).
 */
export const AI_TOOLS: readonly AiTool[] = [
  checkWebsiteDns,
  getAuditLog,
  getBillingSummary,
  getCloudStorage,
  getDnsRecords,
  getDomain,
  getMailDnsSetup,
  getMailDomain,
  getMonitor,
  getMonitoring,
  getOrgOverview,
  getPhoneSystems,
  getServer,
  getServerActivity,
  getServerMetrics,
  getStreaming,
  getWebsite,
  listDomains,
  listMailDomains,
  listServers,
  listWebsites,
  proposeDnsRecord,
].sort((a, b) => a.name.localeCompare(b.name));

const BY_NAME = new Map<string, AiTool>(AI_TOOLS.map((t) => [t.name, t]));

export function toolByName(name: string): AiTool | undefined {
  return BY_NAME.get(name);
}

export function isToolName(name: string): name is AiToolName {
  return BY_NAME.has(name);
}

let definitions: BetaTool[] | null = null;

/**
 * The tool definitions of the request: strict schemas (the arguments match the schema) and eager input streaming
 * (inputs stream as generated; the API then no longer validates them, so the chat validates every parsed input
 * with the tool's zod schema before it runs, ai 6.4). Built once, so the bytes never change.
 */
export function toolDefinitions(): BetaTool[] {
  definitions ??= AI_TOOLS.map((t) => ({
    name: t.name,
    description: `${t.description}${t.live ? ' Live: asks a provider, slower and limited.' : ''}`,
    input_schema: toStrictJsonSchema(t.input) as BetaTool.InputSchema,
    strict: true,
    eager_input_streaming: true,
  }));
  return definitions;
}

/**
 * Monitors of the same organization that target a server (its IP addresses and rDNS names) or a
 * domain (the name or one of its subdomains), with status, uptime and response time. Rendered on
 * the server overview tab and the domain overview; shows nothing unless the organization has the
 * "monitoring" module, the user has monitor:read and a monitor matches. Placeholder until the
 * card is built.
 */
export function RelatedMonitorsCard(_: { kind: 'server' | 'domain'; id: string }) {
  return null;
}

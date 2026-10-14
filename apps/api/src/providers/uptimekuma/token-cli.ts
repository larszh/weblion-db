/**
 * pnpm --filter @weblion/api kuma:token -- --url https://status.example.ch --user admin
 *
 * Signs in to Uptime Kuma once (password and, if enabled, the two-factor code read from the
 * terminal without echo) and prints only the session token, for UPTIMEKUMA_SESSION_TOKEN. The
 * password is never written anywhere. Placeholder until the sign-in is implemented.
 */
process.stderr.write('kuma:token is not implemented yet\n');
process.exitCode = 1;

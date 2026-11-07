/**
 * Keys whose values never reach the audit log or the AI: passwords, tokens, API and private keys, Mailcow's
 * DKIM import (private_key_file) and identity provider bindpass, 3CX SIP credentials (AuthID, AuthPassword),
 * the voicemail PIN (VMPIN), license keys, one-time tickets and provisioning links, Jellyfin's NewPw,
 * CurrentPw, Pw and Pin, and credentials, cookies and session ids of any kind (plan F13, ai 11.2).
 *
 * No `g` flag: the pattern is used with `test()` and must not keep a lastIndex between calls.
 */
export const SECRET_KEY_PATTERN =
  /pass|secret|token|auth_?code|api_?key|priv(ate)?_?key|auth_?id|licen[cs]e_?key|pin$|ticket|prov(isioning)?_?link|pw$|credential|cookie|^session/i;

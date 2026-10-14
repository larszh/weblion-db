#!/usr/bin/env bash
# Installs the agent of the weblion console on a CloudPanel server (as root):
# - the user weblion-agent, which may log in only with the console's key, only from the console's
#   addresses, and then runs nothing but "sudo -n /usr/local/sbin/weblion-clp" without arguments;
# - the root wrapper weblion-clp with its configuration, protected list, state directory, log
#   rotation and the timer that measures disk usage.
# Idempotent: running it again updates the script and the access files and keeps the managed
# list in /var/lib/weblion-clp and the settings in /etc/weblion-clp.
set -euo pipefail
umask 022

AGENT_USER=weblion-agent
AGENT_HOME=/var/lib/weblion-agent
SCRIPT_TARGET=/usr/local/sbin/weblion-clp
FORCED_COMMAND="/usr/bin/sudo -n $SCRIPT_TARGET"
CONFIG_DIR=/etc/weblion-clp
STATE_DIR=/var/lib/weblion-clp
LOG_FILE=/var/log/weblion-clp.log
SUDOERS=/etc/sudoers.d/weblion-agent
SSHD_DROPIN=/etc/ssh/sshd_config.d/50-weblion-agent.conf
LOGROTATE=/etc/logrotate.d/weblion-clp
UNIT_DIR=/etc/systemd/system
TIMER=weblion-clp-usage.timer
MIN_CLOUDPANEL=2.5.0
SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'
USER_RE='^[a-z_][a-z0-9_-]{0,31}$'
KEY_RE='^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}( [A-Za-z0-9._@+-]{1,64})?$'

usage() {
  cat <<'EOF'
Usage: sudo ./install.sh --public-key "ssh-ed25519 AAAA... weblion-console" --from "<IPv4>,<IPv6>"
                         [--protect-domain <domain>]... [--protect-user <user>]...
                         [--nodejs] [--allow-remote-adopt]
       sudo ./install.sh --uninstall

  --public-key KEY          the console's public key (Admin > Provider > CloudPanel), ssh-ed25519 only
  --from LIST               addresses or networks the console connects from, separated by commas
  --protect-domain DOMAIN   a site the console may never touch (the console's own site, every
                            operator site); repeatable
  --protect-user USER       a Linux user whose sites the console may never touch; repeatable
  --nodejs                  allow Node.js sites on this server (config.json "nodejs")
  --allow-remote-adopt      let staff adopt existing sites from the console (off by default:
                            root adopts with "weblion-clp adopt <domain>")
  --uninstall               remove the user, sudoers file, sshd drop-in, timer and script; keeps
                            /var/lib/weblion-clp (managed sites) and /etc/weblion-clp

Run it again to update the agent; the managed sites and settings stay. Files are taken from the
directory of this script (copy the whole deploy/cloudpanel-agent directory to the server).
EOF
}

fail() {
  echo "install.sh: $*" >&2
  exit 1
}

usage_error() {
  echo "install.sh: $*" >&2
  echo "Run ./install.sh --help for the options." >&2
  exit 2
}

warn() {
  echo "WARNING: $*" >&2
}

# --- arguments (checked before anything is touched) ----------------------------------------------

PUBLIC_KEY=""
FROM=""
PROTECT_DOMAINS=()
PROTECT_USERS=()
NODEJS=0
REMOTE_ADOPT=0
UNINSTALL=0

value() {
  [ "$2" -ge 2 ] || usage_error "$1 needs a value"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --public-key) value "$1" $#; PUBLIC_KEY=$2; shift 2 ;;
    --from) value "$1" $#; FROM=$2; shift 2 ;;
    --protect-domain) value "$1" $#; PROTECT_DOMAINS+=("${2,,}"); shift 2 ;;
    --protect-user) value "$1" $#; PROTECT_USERS+=("$2"); shift 2 ;;
    --nodejs) NODEJS=1; shift ;;
    --allow-remote-adopt) REMOTE_ADOPT=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage_error "unknown option ${1:0:40}" ;;
  esac
done

if [ "$UNINSTALL" -eq 0 ]; then
  [ -n "$PUBLIC_KEY" ] || usage_error "--public-key is required"
  [ -n "$FROM" ] || usage_error "--from is required (the console's addresses)"
  [[ $PUBLIC_KEY =~ $KEY_RE ]] ||
    usage_error "--public-key must be one line \"ssh-ed25519 AAAA... comment\" (the console's key)"
  command -v python3 >/dev/null || fail "python3 is required"
  # Addresses or networks only: the value goes into from="..." of authorized_keys.
  python3 -I -c '
import ipaddress, sys
for item in sys.argv[1].split(","):
    if ipaddress.ip_network(item, strict=False).prefixlen == 0:
        raise ValueError(item)
' "$FROM" 2>/dev/null || usage_error "--from must be IP addresses or networks separated by commas, e.g. 203.0.113.5,2001:db8::5"
  for domain in ${PROTECT_DOMAINS[@]+"${PROTECT_DOMAINS[@]}"}; do
    [[ $domain =~ $DOMAIN_RE ]] || usage_error "--protect-domain: not a domain name: ${domain:0:60}"
  done
  for user in ${PROTECT_USERS[@]+"${PROTECT_USERS[@]}"}; do
    [[ $user =~ $USER_RE ]] || usage_error "--protect-user: not a user name: ${user:0:40}"
  done
fi

[ "$(id -u)" -eq 0 ] || fail "run this as root (sudo ./install.sh ...)"

reload_sshd() {
  # Only a running sshd is reloaded: on socket-activated systems (Ubuntu 22.10 and newer) a
  # restart would conflict with ssh.socket, and every new connection reads the files anyway.
  systemctl try-reload-or-restart ssh.service 2>/dev/null ||
    systemctl try-reload-or-restart sshd.service 2>/dev/null ||
    warn "sshd could not be reloaded; reload it by hand"
}

# --- uninstall ---------------------------------------------------------------------------------

if [ "$UNINSTALL" -eq 1 ]; then
  rm -f "$SUDOERS" "$SSHD_DROPIN"
  reload_sshd
  if id "$AGENT_USER" >/dev/null 2>&1; then
    pkill -KILL -u "$AGENT_USER" 2>/dev/null || true
    userdel "$AGENT_USER"
  fi
  rm -rf "$AGENT_HOME"
  systemctl disable --now "$TIMER" 2>/dev/null || true
  rm -f "$UNIT_DIR/$TIMER" "$UNIT_DIR/weblion-clp-usage.service" "$LOGROTATE" "$SCRIPT_TARGET"
  systemctl daemon-reload 2>/dev/null || true
  echo "weblion-clp removed. Kept: $STATE_DIR (managed sites), $CONFIG_DIR (settings, protected list), $LOG_FILE."
  exit 0
fi

# --- 1. checks -----------------------------------------------------------------------------------

[ -r /etc/os-release ] || fail "/etc/os-release is missing"
os_id=$(. /etc/os-release && echo "${ID:-} ${ID_LIKE:-}")
[[ " $os_id " == *" debian "* || " $os_id " == *" ubuntu "* ]] || fail "only Debian and Ubuntu are supported"
cloudpanel=$(dpkg-query -W -f='${Version}' cloudpanel 2>/dev/null) || fail "CloudPanel is not installed"
dpkg --compare-versions "$cloudpanel" ge "$MIN_CLOUDPANEL" ||
  fail "CloudPanel $cloudpanel is older than $MIN_CLOUDPANEL; update CloudPanel first"
[ -x /usr/bin/python3 ] || fail "/usr/bin/python3 is missing"
/usr/bin/python3 -I -c 'import sqlite3, json' || fail "python3 lacks the sqlite3 or json module"
[ -f /usr/bin/clpctl ] || fail "/usr/bin/clpctl is missing"
[ -f "$SOURCE_DIR/weblion-clp" ] || fail "weblion-clp is missing next to install.sh ($SOURCE_DIR)"
/usr/bin/python3 -I "$SOURCE_DIR/weblion-clp" --help >/dev/null || fail "weblion-clp does not run with this python3"
for tool in sshd visudo useradd usermod chpasswd systemctl ssh-keygen; do
  command -v "$tool" >/dev/null || fail "$tool is missing"
done
[ -x /usr/bin/sudo ] || fail "/usr/bin/sudo is missing"
command -v mysql >/dev/null || warn "the mysql client is missing; databases will not work"
sshd -T >/dev/null || fail "sshd -T fails; fix the sshd configuration first"
grep -Eq '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config ||
  fail "/etc/ssh/sshd_config does not include /etc/ssh/sshd_config.d/*.conf"
grep -Eq '^[@#]includedir[[:space:]]+/etc/sudoers\.d' /etc/sudoers || fail "/etc/sudoers does not include /etc/sudoers.d"
# Nobody but root may replace the wrapper.
sbin_mode=$(stat -c '%a' /usr/local/sbin)
[ "$(stat -c '%u' /usr/local/sbin)" = 0 ] && (((8#$sbin_mode & 8#022) == 0)) ||
  fail "/usr/local/sbin must belong to root and must not be writable by others"

# --- 2. the agent user ---------------------------------------------------------------------------

if ! id "$AGENT_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$AGENT_HOME" --create-home --shell /bin/sh "$AGENT_USER"
fi
# sshd runs the forced command through the login shell, so not nologin; no extra groups.
usermod --home "$AGENT_HOME" --shell /bin/sh -G '' "$AGENT_USER"
# Root owns the home and the key file: the account cannot change its own access.
install -d -o root -g root -m 0755 "$AGENT_HOME" "$AGENT_HOME/.ssh"

# --- 3. authorized_keys --------------------------------------------------------------------------

keys=$(mktemp "$AGENT_HOME/.ssh/.authorized_keys.XXXXXX")
printf 'restrict,from="%s",command="%s" %s\n' "$FROM" "$FORCED_COMMAND" "$PUBLIC_KEY" >"$keys"
chown root:root "$keys"
chmod 0644 "$keys"
mv -f "$keys" "$AGENT_HOME/.ssh/authorized_keys"

# --- 4. sshd -------------------------------------------------------------------------------------

install -d -m 0755 /etc/ssh/sshd_config.d
dropin=$(mktemp /etc/ssh/sshd_config.d/.weblion-agent.XXXXXX)
cat >"$dropin" <<EOF
# weblion console agent (deploy/cloudpanel-agent/install.sh): key only, no tty, no forwarding,
# and whatever the client asks, only the root wrapper runs.
Match User $AGENT_USER
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitUserRC no
    ForceCommand $FORCED_COMMAND
EOF
chmod 0644 "$dropin"
mv -f "$dropin" "$SSHD_DROPIN"
if ! sshd -t; then
  rm -f "$SSHD_DROPIN"
  fail "sshd refused $SSHD_DROPIN; it was removed again"
fi
if ! effective=$(sshd -T -C "user=$AGENT_USER,host=localhost,addr=127.0.0.1"); then
  rm -f "$SSHD_DROPIN"
  fail "sshd -T -C user=$AGENT_USER failed; the drop-in was removed"
fi
for expected in "forcecommand $FORCED_COMMAND" "permittty no" "allowtcpforwarding no" \
  "authenticationmethods publickey" "passwordauthentication no"; do
  if ! grep -qxF "$expected" <<<"$effective"; then
    rm -f "$SSHD_DROPIN"
    fail "sshd does not apply \"$expected\" to $AGENT_USER (another Match block first?); the drop-in was removed"
  fi
done
if grep -qxF "forcecommand $FORCED_COMMAND" <<<"$(sshd -T -C user=root,host=localhost,addr=127.0.0.1)"; then
  rm -f "$SSHD_DROPIN"
  fail "the Match block of $SSHD_DROPIN also applies to other users; the drop-in was removed"
fi
if grep -qx 'usepam no' <<<"$effective"; then
  # Without PAM sshd refuses locked ("!") accounts; "*" matches no password either.
  usermod -p '*' "$AGENT_USER"
else
  usermod -L "$AGENT_USER"
fi
reload_sshd

# --- 5. sudoers ----------------------------------------------------------------------------------

# A name with a dot: sudo ignores the file until it is checked and renamed.
rules=$(mktemp /etc/sudoers.d/.weblion-agent.XXXXXX)
cat >"$rules" <<EOF
# weblion console agent (deploy/cloudpanel-agent/install.sh): only the wrapper, without arguments.
Defaults:$AGENT_USER !requiretty, !lecture, env_reset, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"
$AGENT_USER ALL=(root) NOPASSWD: $SCRIPT_TARGET ""
EOF
chown root:root "$rules"
chmod 0440 "$rules"
if ! visudo -cf "$rules" >/dev/null; then
  rm -f "$rules"
  fail "visudo refused the sudoers rule"
fi
mv -f "$rules" "$SUDOERS"
listing=$(sudo -n -l -U "$AGENT_USER" 2>/dev/null) || true
grep -qF "$SCRIPT_TARGET" <<<"$listing" || fail "sudo does not list $SCRIPT_TARGET for $AGENT_USER; check /etc/sudoers"

# --- 6. script, configuration, protected list, state, log ---------------------------------------

install -o root -g root -m 0755 "$SOURCE_DIR/weblion-clp" "$SCRIPT_TARGET.new"
mv -f "$SCRIPT_TARGET.new" "$SCRIPT_TARGET"
install -d -o root -g root -m 0755 "$CONFIG_DIR"
install -d -o root -g root -m 0700 "$STATE_DIR"
# New: the defaults with the given switches. Existing: kept, the given switches turned on.
/usr/bin/python3 -I - "$CONFIG_DIR/config.json" "$NODEJS" "$REMOTE_ADOPT" <<'EOF'
import json, os, sys

path, nodejs, adopt = sys.argv[1], sys.argv[2] == "1", sys.argv[3] == "1"
try:
    with open(path, encoding="utf-8") as handle:
        config = json.load(handle)
    changed = False
except FileNotFoundError:
    config = {
        "agentUser": "weblion-agent",
        "allowRemoteAdopt": False,
        "nodejs": False,
        "nodejsPorts": [3001, 3999],
        "phpVersions": None,
        "dbQuietSeconds": [2, 9],
        "panelDb": "/home/clp/htdocs/app/data/db.sq3",
        "clpctl": "/usr/bin/clpctl",
        "mysql": "/usr/bin/mysql",
        "minCloudPanel": "2.5.0",
    }
    changed = True
for key, wanted in (("nodejs", nodejs), ("allowRemoteAdopt", adopt)):
    if wanted and config.get(key) is not True:
        config[key] = True
        changed = True
if changed:
    with open(path + ".new", "w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")
    os.chmod(path + ".new", 0o644)
    os.replace(path + ".new", path)
EOF
if [ ! -f "$CONFIG_DIR/protected.conf" ]; then
  printf '%s\n' "# Sites and users weblion-clp never adopts, creates, changes or deletes." \
    "# One entry per line: \"domain <name>\" or \"user <name>\"." >"$CONFIG_DIR/protected.conf"
  chmod 0644 "$CONFIG_DIR/protected.conf"
fi
for domain in ${PROTECT_DOMAINS[@]+"${PROTECT_DOMAINS[@]}"}; do
  "$SCRIPT_TARGET" protect domain "$domain"
done
for user in ${PROTECT_USERS[@]+"${PROTECT_USERS[@]}"}; do
  "$SCRIPT_TARGET" protect user "$user"
done
[ -e "$LOG_FILE" ] || install -o root -g root -m 0600 /dev/null "$LOG_FILE"
cat >"$LOGROTATE" <<EOF
$LOG_FILE {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    create 0600 root root
}
EOF
chmod 0644 "$LOGROTATE"

# --- 7. usage timer ------------------------------------------------------------------------------

cat >"$UNIT_DIR/weblion-clp-usage.service" <<EOF
[Unit]
Description=Measure disk and database usage of the console's websites (weblion-clp)

[Service]
Type=oneshot
ExecStart=$SCRIPT_TARGET refresh-usage
Nice=19
IOSchedulingClass=idle
EOF
cat >"$UNIT_DIR/$TIMER" <<'EOF'
[Unit]
Description=Measure website usage every 6 hours (weblion-clp)

[Timer]
OnBootSec=15min
OnUnitActiveSec=6h
RandomizedDelaySec=30min

[Install]
WantedBy=timers.target
EOF
chmod 0644 "$UNIT_DIR/weblion-clp-usage.service" "$UNIT_DIR/$TIMER"
systemctl daemon-reload
systemctl enable --now "$TIMER" >/dev/null

# --- 8. selftest and the values for the console ---------------------------------------------------

echo
selftest=0
"$SCRIPT_TARGET" selftest || selftest=$?
# Each reads its whole input (no early exit, which would break the pipe under pipefail).
port=$(sshd -T 2>/dev/null | awk '$1 == "port" && !seen { print $2; seen = 1 }') || true
fingerprint=$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{ print $2 }') || true
addresses=$(ip -o addr show scope global 2>/dev/null | awk '{ sub(/\/.*/, "", $4); print $4 }' | paste -sd, -) || true
cat <<EOF

Enter in the console (Admin > Provider > CloudPanel):
  Host:              $(hostname -f 2>/dev/null || hostname)
  Port:              ${port:-22}
  User:              $AGENT_USER
  Host key:          ${fingerprint:-unknown (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub)}
  Server addresses:  ${addresses:-unknown}
Then "Verbindung testen" and "Synchronisieren". Existing sites stay untouched; to manage one,
run "sudo weblion-clp adopt <domain>" here and synchronise.
EOF
if [ "$selftest" -ne 0 ]; then
  fail "the selftest found problems (see FAIL above)"
fi

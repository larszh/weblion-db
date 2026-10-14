"""
Tests of weblion-clp and install.sh. Run from the repository root:

    python3 -I -m unittest discover -s deploy/cloudpanel-agent/tests -v

Standard library only, no root, no network, nothing outside a temporary directory: every path
and program of the agent comes from its Paths object and config.json, which point at fakes
(tests/fakes/fake_tool.py, copied under each program's name) and at a CloudPanel SQLite
database the test creates. The clock and sleep are injected, so nothing waits for real.
"""

import contextlib
import datetime
import fcntl
import importlib.machinery
import importlib.util
import io
import json
import os
import pwd
import re
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest import mock

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(HERE)
SCRIPT = os.path.join(AGENT_DIR, "weblion-clp")
INSTALLER = os.path.join(AGENT_DIR, "install.sh")
FAKE_TOOL = os.path.join(HERE, "fakes", "fake_tool.py")
TOOLS = ("clpctl", "mysql", "chpasswd", "pkill", "crontab", "dpkg-query", "ip", "du", "nice", "ionice", "hang")

# 2026-10-11 12:00:30 UTC: second 30, outside clp-agent's write slot.
NOW = datetime.datetime(2026, 10, 11, 12, 0, 30, tzinfo=datetime.timezone.utc).timestamp()
NOW_ISO = "2026-10-11T12:00:30Z"
REAL = "Real-Passw0rd.4711"
DB_REAL = "Db-Secret#2026.ok"
MASTER = 'M4ster"pw\\x|y'
THROWAWAY = re.compile(r"[A-Za-z0-9]{32}")

PANEL_SCHEMA = """
CREATE TABLE site (id INTEGER PRIMARY KEY AUTOINCREMENT, domain_name TEXT NOT NULL, type TEXT NOT NULL,
  user TEXT NOT NULL, user_password TEXT, root_directory TEXT, application TEXT, vhost_template TEXT,
  reverse_proxy_url TEXT, certificate_id INTEGER, varnish_cache INTEGER,
  allow_traffic_from_cloudflare_only INTEGER, created_at TEXT);
CREATE TABLE php_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, php_version TEXT, pool_port INTEGER);
CREATE TABLE nodejs_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, nodejs_version TEXT, port INTEGER);
CREATE TABLE python_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, python_version TEXT, port INTEGER);
CREATE TABLE certificate (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, type TEXT, expires_at TEXT,
  certificate TEXT);
CREATE TABLE database (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, name TEXT);
CREATE TABLE database_user (id INTEGER PRIMARY KEY AUTOINCREMENT, database_id INTEGER, user_name TEXT);
CREATE TABLE ftp_user (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, user_name TEXT, home_directory TEXT);
CREATE TABLE cron_job (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, minute TEXT, hour TEXT, day TEXT,
  month TEXT, weekday TEXT, command TEXT);
CREATE TABLE user (id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT, password TEXT, role TEXT, status INTEGER);
"""

# An old panel: only the required columns, no certificate, settings or user tables.
MINIMAL_SCHEMA = """
CREATE TABLE site (id INTEGER PRIMARY KEY AUTOINCREMENT, domain_name TEXT NOT NULL, type TEXT NOT NULL,
  user TEXT NOT NULL);
CREATE TABLE database (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, name TEXT);
"""

_MODULE = None


def agent_module():
    """The script has no .py extension, so it is loaded by path (once)."""
    global _MODULE
    if _MODULE is None:
        loader = importlib.machinery.SourceFileLoader("weblion_clp", SCRIPT)
        spec = importlib.util.spec_from_loader("weblion_clp", loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        _MODULE = module
    return _MODULE


class FakeClock:
    def __init__(self, now):
        self.now = now
        self.sleeps = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class Server:
    """A fake CloudPanel server in a temporary directory."""

    def __init__(self, test, schema=PANEL_SCHEMA):
        self.root = tempfile.mkdtemp(prefix="weblion-clp-test-")
        test.addCleanup(shutil.rmtree, self.root, True)
        self.module = agent_module()
        self.clock = FakeClock(NOW)
        self.answers = []
        for directory in ("bin", "etc", "var", "home", "php-bin", "php-etc", "proc", "crontabs"):
            os.makedirs(self.path(directory))
        with open(FAKE_TOOL, encoding="utf-8") as handle:
            source = handle.read().split("\n", 1)[1]
        for tool in TOOLS:
            with open(self.path("bin", tool), "w", encoding="utf-8") as handle:
                handle.write("#!%s\n%s" % (sys.executable, source))
            os.chmod(self.path("bin", tool), 0o755)
        self.panel_db = self.path("db.sq3")
        with contextlib.closing(sqlite3.connect(self.panel_db)) as db:
            db.executescript(schema)
        for name in ("php8.1", "php8.3", "php8.4", "php", "php-config8.4"):
            open(self.path("php-bin", name), "w").close()
        with open(self.path("proc", "tcp"), "w", encoding="ascii") as handle:
            handle.write("  sl  local_address rem_address   st\n")
            handle.write("   0: 00000000:0BB9 00000000:0000 0A 00000000:00000000\n")  # 3001 listening
            handle.write("   1: 0100007F:0BBD 0100007F:D2C8 01 00000000:00000000\n")  # 3005 connected
        with open(self.path("os-release"), "w", encoding="utf-8") as handle:
            handle.write('NAME="Debian GNU/Linux"\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n')
        self.save_state(
            {
                "now": NOW,
                "panelDb": self.panel_db,
                "home": self.path("home"),
                "dpkgVersion": "2.5.4-3+clp-bookworm",
                "templates": [
                    ["Generic", ""],
                    ["WordPress", ""],
                    ["WooCommerce", ""],
                    ["Laravel 12", "public"],
                    ["Static", ""],
                    ["Nodejs", ""],
                ],
                "master": {"host": "127.0.0.1", "user": "root", "password": MASTER, "port": "3306"},
                "passwd": {"root": 0, "clp": 999, "weblion-agent": 998, "backup": 34, "taken-user": 1500},
                "nextUid": 1001,
                "linuxPasswords": {},
                "mysql": {"schemas": ["mysql", "sys"], "users": [], "passwords": {}, "sessions": {}, "sizes": {}},
                "modes": {},
                "echo": {},
                "du": {},
                "ipAddr": [
                    {
                        "ifname": "eth0",
                        "addr_info": [
                            {"family": "inet", "local": "195.201.10.10"},
                            {"family": "inet", "local": "10.0.0.5"},
                            {"family": "inet", "local": "203.0.113.10"},
                            {"family": "inet6", "local": "2a01:4f8:c0c:1234::1"},
                            {"family": "inet6", "local": "2001:db8::10"},
                            {"family": "inet6", "local": "fe80::1"},
                        ],
                    },
                ],
            }
        )
        self.config = {
            "agentUser": "weblion-agent",
            "allowRemoteAdopt": False,
            "nodejs": False,
            "nodejsPorts": [3001, 3999],
            "phpVersions": None,
            "dbQuietSeconds": [2, 9],
            "panelDb": self.panel_db,
            "clpctl": self.path("bin", "clpctl"),
            "mysql": self.path("bin", "mysql"),
            "minCloudPanel": "2.5.0",
        }
        self.write_config()
        paths = self.module.Paths()
        paths.config = self.path("etc", "config.json")
        paths.protected = self.path("etc", "protected.conf")
        paths.managed = self.path("var", "lib", "managed.json")
        paths.usage = self.path("var", "lib", "usage.json")
        paths.run_dir = self.path("run")
        paths.lock = self.path("run", "weblion-clp.lock")
        paths.log = self.path("var", "weblion-clp.log")
        paths.os_release = self.path("os-release")
        paths.php_bin_dir = self.path("php-bin")
        paths.php_etc_dir = self.path("php-etc")
        paths.proc_net_tcp = (self.path("proc", "tcp"), self.path("proc", "tcp6"))
        paths.crontabs = self.path("crontabs")
        paths.sudoers = self.path("etc", "sudoers-weblion-agent")
        paths.sshd_dropin = self.path("etc", "sshd-weblion-agent.conf")
        paths.shell = sys.executable
        for tool in ("chpasswd", "pkill", "crontab", "ip", "du", "nice", "ionice"):
            setattr(paths, tool, self.path("bin", tool))
        paths.dpkg_query = self.path("bin", "dpkg-query")
        self.paths = paths

    def path(self, *parts):
        return os.path.join(self.root, *parts)

    # --- state of the fakes ----------------------------------------------------------------

    def state(self):
        with open(self.path("bin", "state.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def save_state(self, state):
        with open(self.path("bin", "state.json"), "w", encoding="utf-8") as handle:
            json.dump(state, handle)

    def change_state(self, change):
        state = self.state()
        change(state)
        self.save_state(state)

    def mode(self, name, mode):
        self.change_state(lambda s: s["modes"].__setitem__(name, mode))

    def write_config(self, **changes):
        self.config.update(changes)
        with open(self.path("etc", "config.json"), "w", encoding="utf-8") as handle:
            json.dump(self.config, handle)

    def protect(self, *lines):
        with open(self.path("etc", "protected.conf"), "w", encoding="utf-8") as handle:
            handle.write("# operator sites\n" + "\n".join(lines) + "\n")

    def calls(self, program=None):
        try:
            with open(self.path("bin", "calls.jsonl"), encoding="utf-8") as handle:
                found = [json.loads(line) for line in handle]
        except FileNotFoundError:
            return []
        return [c for c in found if program is None or c["program"] == program]

    def clpctl_commands(self):
        return [c["argv"][0] for c in self.calls("clpctl")]

    def changing_calls(self):
        """Every call except the read-only version check."""
        return [c for c in self.calls() if c["program"] != "dpkg-query"]

    def managed(self):
        try:
            with open(self.paths.managed, encoding="utf-8") as handle:
                return json.load(handle)["sites"]
        except FileNotFoundError:
            return {}

    def log_lines(self):
        try:
            with open(self.paths.log, encoding="utf-8") as handle:
                return [json.loads(line) for line in handle]
        except FileNotFoundError:
            return []

    def panel(self, sql, args=()):
        with contextlib.closing(sqlite3.connect(self.panel_db)) as db:
            rows = db.execute(sql, args).fetchall()
            db.commit()
            return rows

    def getpwnam(self, name):
        uid = self.state()["passwd"].get(name)
        if uid is None:
            raise KeyError(name)
        return pwd.struct_passwd((name, "x", uid, uid, "", self.path("home", name), "/bin/bash"))

    def add_site(
        self,
        domain,
        user,
        kind="php",
        php="8.3",
        application="WordPress",
        managed=True,
        databases=(),
        cert_days=None,
        port=None,
        record=None,
    ):
        site_id = self.panel(
            "INSERT INTO site (domain_name, type, user, root_directory, application, created_at)"
            " VALUES (?, ?, ?, '', ?, '2026-01-02 03:04:05') RETURNING id",
            (domain, kind, user, application if kind == "php" else None),
        )[0][0]
        if kind == "php":
            self.panel("INSERT INTO php_settings (site_id, php_version) VALUES (?, ?)", (site_id, php))
        if kind == "nodejs":
            self.panel(
                "INSERT INTO nodejs_settings (site_id, nodejs_version, port) VALUES (?, '22', ?)", (site_id, port)
            )
        for name in databases:
            database_id = self.panel(
                "INSERT INTO database (site_id, name) VALUES (?, ?) RETURNING id", (site_id, name)
            )[0][0]
            self.panel("INSERT INTO database_user (database_id, user_name) VALUES (?, ?)", (database_id, name))

        def change(state):
            state["passwd"].setdefault(user, state["nextUid"])
            state["nextUid"] += 1
            for name in databases:
                state["mysql"]["schemas"].append(name)
                state["mysql"]["users"] += [[name, "localhost"], [name, "127.0.0.1"]]

        self.change_state(change)
        os.makedirs(self.path("home", user, ".ssh"), exist_ok=True)
        if cert_days is not None:
            expires = datetime.datetime.fromtimestamp(NOW + cert_days * 86400, datetime.timezone.utc)
            cert_id = self.panel(
                "INSERT INTO certificate (site_id, type, expires_at, certificate) VALUES (?, '1', ?, NULL) RETURNING id",
                (site_id, expires.strftime("%Y-%m-%d %H:%M:%S")),
            )[0][0]
            self.panel("UPDATE site SET certificate_id = ? WHERE id = ?", (cert_id, site_id))
        if managed:
            sites = self.managed()
            sites[domain] = dict(
                {
                    "siteUser": user,
                    "source": "adopt",
                    "createdAt": NOW_ISO,
                    "requestId": str(uuid.uuid4()),
                    "letsEncrypt": False,
                    "incomplete": False,
                },
                **(record or {}),
            )
            os.makedirs(os.path.dirname(self.paths.managed), exist_ok=True)
            with open(self.paths.managed, "w", encoding="utf-8") as handle:
                json.dump({"version": 1, "sites": sites}, handle)
        return site_id

    # --- requests --------------------------------------------------------------------------

    def agent(self, **attributes):
        agent = self.module.Agent(
            paths=self.paths,
            clock=self.clock,
            sleep=self.clock.sleep,
            geteuid=lambda: 0,
            getpwnam=self.getpwnam,
            environ={},
            hostname=lambda: "web1.example.test",
        )
        for key, value in attributes.items():
            setattr(agent, key, value)
        return agent

    def request(self, op, args=None, secrets=None, raw=None, **attributes):
        if raw is None:
            envelope = {"v": 1, "op": op, "requestId": str(uuid.uuid4()), "args": args or {}}
            if secrets is not None:
                envelope["secrets"] = secrets
            raw = (json.dumps(envelope) + "\n").encode("utf-8")
        out = io.StringIO()
        code = self.agent(**attributes).serve(io.BytesIO(raw), out)
        text = out.getvalue()
        self.answers.append(text)
        lines = text.splitlines()
        assert len(lines) == 1, text
        answer = json.loads(lines[0])
        assert answer["v"] == 1 and answer["ok"] == (code == 0), (code, answer)
        return answer

    def create(self, **overrides):
        args = {
            "domain": "shop.example.ch",
            "type": "php",
            "phpVersion": "8.4",
            "template": "WordPress",
            "siteUser": "shop-example-ch",
        }
        secrets = {"password": REAL}
        database = overrides.pop("database", None)
        if database:
            args["database"] = {"name": database, "userName": database}
            secrets["databasePassword"] = DB_REAL
        args.update(overrides)
        for key in [k for k, v in args.items() if v is None]:
            del args[key]
        return self.request("create", args, secrets)


class AgentTestCase(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.server = Server(self)
        self.module = self.server.module

    def assertError(self, answer, code, field=None):
        self.assertFalse(answer["ok"], answer)
        self.assertEqual(answer["error"]["code"], code, answer)
        if field is not None:
            self.assertEqual(answer["error"].get("field"), field, answer)
        return answer["error"]

    def assertNoSecretLeft(self, *secret_values):
        """None of the values in any argv, the log, an answer, the state files or the panel database."""
        server = self.server
        texts = [json.dumps([c["argv"] for c in server.calls()])] + server.answers
        for path in (server.paths.log, server.paths.managed, server.paths.usage):
            if os.path.exists(path):
                with open(path, encoding="utf-8") as handle:
                    texts.append(handle.read())
        texts.append(json.dumps(server.panel("SELECT * FROM site")))
        for value in secret_values:
            for text in texts:
                self.assertNotIn(value, text)


# --- 1. the envelope ------------------------------------------------------------------------------


class EnvelopeTest(AgentTestCase):
    def check_invalid(self, raw, field=None):
        answer = self.server.request(None, raw=raw)
        self.assertError(answer, "invalid", field)
        self.assertEqual(self.server.calls(), [])
        return answer

    def test_wrong_version(self):
        self.check_invalid(b'{"v": 2, "op": "list", "requestId": "%s", "args": {}}\n' % str(uuid.uuid4()).encode(), "v")
        self.check_invalid(
            b'{"v": true, "op": "list", "requestId": "%s", "args": {}}\n' % str(uuid.uuid4()).encode(), "v"
        )

    def test_unknown_op(self):
        for op in ("site:add:php", "shell", "", "LIST"):
            raw = json.dumps({"v": 1, "op": op, "requestId": str(uuid.uuid4()), "args": {}}).encode() + b"\n"
            self.check_invalid(raw, "op")

    def test_unknown_argument_and_field(self):
        answer = self.server.request("get", {"domain": "shop.example.ch", "force": True})
        self.assertError(answer, "invalid", "force")
        answer = self.server.request("list", {"domain": "shop.example.ch"})
        self.assertError(answer, "invalid", "domain")
        raw = json.dumps({"v": 1, "op": "list", "requestId": str(uuid.uuid4()), "args": {}, "sudo": "x"}).encode()
        self.check_invalid(raw + b"\n", "sudo")
        self.assertEqual(self.server.calls(), [])

    def test_secrets(self):
        self.assertError(self.server.request("list", {}, {"password": REAL}), "invalid", "password")
        self.assertError(
            self.server.request("password", {"domain": "shop.example.ch"}, {"password": REAL, "x": "y"}), "invalid", "x"
        )
        raw = json.dumps({"v": 1, "op": "list", "requestId": str(uuid.uuid4()), "args": {}, "secrets": {"a": 1}})
        self.check_invalid(raw.encode() + b"\n", "secrets")
        raw = json.dumps({"v": 1, "op": "list", "requestId": str(uuid.uuid4()), "args": {}, "secrets": []})
        self.check_invalid(raw.encode() + b"\n", "secrets")
        self.assertEqual(self.server.calls(), [])

    def test_oversized_and_malformed(self):
        envelope = {"v": 1, "op": "list", "requestId": str(uuid.uuid4()), "args": {}, "x": "a" * 70000}
        self.check_invalid(json.dumps(envelope).encode() + b"\n")
        self.check_invalid(b"[1, 2, 3]\n")
        self.check_invalid(b'"list"\n')
        self.check_invalid(b"not json\n")
        self.check_invalid(b"\xff\xfe{}\n")
        self.check_invalid(b"")
        self.check_invalid(b"[" * 60000 + b"\n")  # nested too deep for the parser, under 64 KiB
        raw = json.dumps({"v": 1, "op": "list", "requestId": "1; rm -rf /", "args": {}}).encode()
        self.check_invalid(raw + b"\n", "requestId")
        raw = json.dumps({"v": 1, "op": "list", "requestId": str(uuid.uuid4()), "args": []}).encode()
        self.check_invalid(raw + b"\n", "args")

    def test_only_the_first_line_counts(self):
        raw = json.dumps({"v": 1, "op": "forget", "requestId": str(uuid.uuid4()), "args": {"domain": "a.example.ch"}})
        answer = self.server.request(None, raw=raw.encode() + b"\n" + b'{"v": 1, "op": "create"}\n')
        self.assertTrue(answer["ok"], answer)

    def test_reads_a_pipe_and_gives_up_in_time(self):
        read, write = os.pipe()
        with os.fdopen(read, "rb") as stream, os.fdopen(write, "wb") as writer:
            writer.write(b'{"v": 1}\n')
            writer.flush()
            self.assertEqual(self.module.read_stdin(stream), b'{"v": 1}')
        read, write = os.pipe()
        with os.fdopen(read, "rb") as stream, os.fdopen(write, "wb"):
            with self.assertRaises(self.module.AgentError) as caught:
                self.module.read_stdin(stream, timeout=0)
            self.assertEqual(caught.exception.code, "invalid")

    def test_refuses_without_root(self):
        out = io.StringIO()
        raw = json.dumps({"v": 1, "op": "list", "requestId": str(uuid.uuid4()), "args": {}}).encode() + b"\n"
        code = self.server.agent(geteuid=lambda: 1000).serve(io.BytesIO(raw), out)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.getvalue())["error"]["code"], "internal")
        self.assertEqual(self.server.calls(), [])


# --- 2. argument patterns -------------------------------------------------------------------------


class PatternTest(AgentTestCase):
    def check(self, function, good, bad):
        for value in good:
            self.assertEqual(function(value), value)
        for value in bad:
            with self.assertRaises(self.module.AgentError, msg=repr(value)) as caught:
                function(value)
            self.assertEqual(caught.exception.code, "invalid")

    def test_domain(self):
        self.check(
            self.module.v_domain,
            ["shop.example.ch", "www.mueller-shop.ch", "xn--mller-kva.ch", "a.b.ch", "x.xn--p1ai"],
            [
                "Shop.example.ch",
                "shop.example.ch\n",
                "1.2.3.4",
                "localhost",
                "a b.ch",
                "shop.ch/x",
                "../etc",
                "shop.ch; rm -rf /",
                "$(id).ch",
                "`id`.ch",
                "-shop.ch",
                "shop-.ch",
                "müller.ch",
                "ѕhop.ch",
                "shop..ch",
                "a.c",
                "x" * 64 + ".ch",
                None,
                7,
                ["shop.ch"],
            ],
        )

    def test_site_user(self):
        good = ["shop-example-ch", "abc", "a" * 32, "w123-ch"]
        bad = [
            "ab",
            "a" * 33,
            "1shop",
            "shop-",
            "Shop",
            "shop_user",
            "shop user",
            "shop\n",
            "shop;id",
            "$(id)",
            "`id`",
            "../x",
            "root",
            "clp",
            "mysql",
            "www-data",
            "debian",
            "weblion-cp",
            "weblion",
            "weblion-agent",
            "ѕhop",
            None,
        ]
        self.check(lambda v: self.module.v_site_user(v, "weblion-agent"), good, bad)
        with self.assertRaises(self.module.AgentError):
            self.module.v_site_user("other-agent", "other-agent")

    def test_versions_templates_types(self):
        self.check(self.module.v_php_version, ["8.4", "7.4"], ["8.10", "84", "8.4\n", "８.４", "8.4; id", "", None])
        self.check(self.module.v_nodejs_version, ["22", "24", "12"], ["21", "22.1", "v22", "22\n", None])
        self.check(
            self.module.v_template,
            ["WordPress", "Laravel 12", "PrestaShop 1.7", "Generic"],
            ["Generic; x", "Generic\n", " Generic", "Word$(id)", "a" * 42, "Wörd", "../x", "", None],
        )
        self.check(self.module.v_type, ["php", "static", "nodejs"], ["python", "reverse-proxy", "PHP", "", None])

    def test_database_names(self):
        check = self.module.v_db_name
        self.check(
            lambda v: check(v, "name"),
            ["shop_wp", "a1", "a" * 32],
            ["_shop", "a", "a" * 33, "Shop", "shop-wp", "shop wp", "mysql", "sys", "shop`x", "shop'x", "shop\n", None],
        )
        self.assertEqual(check("shop_example_ch_wp", "name", "shop_example_ch_"), "shop_example_ch_wp")
        with self.assertRaises(self.module.AgentError):
            check("other_wp", "name", "shop_example_ch_")
        self.assertEqual(self.module.db_prefix("shop-example-ch"), "shop_example_ch_")
        self.assertEqual(self.module.db_prefix("a-very-long-site-user-name"), "a_very_long_site_")
        self.assertEqual(self.module.db_prefix("abcdefghijklmno-x"), "abcdefghijklmno_")

    def test_password(self):
        self.check(
            lambda v: self.module.v_password(v, "password"),
            [REAL, DB_REAL, "a" * 12, "x" * 128, "!#%*+,-./;<=>?@^_{|}~ab"],
            [
                "a" * 11,
                "x" * 129,
                "Passw0rd$1234",
                "Passw0rd'1234",
                'Passw0rd"1234',
                "Passw0rd 1234",
                "Passw0rd:1234",
                "Passw0rd\\1234",
                "Passw0rd`1234",
                "Passw0rd(1234",
                "Passw0rd&1234",
                "Passw0rd1234\n",
                "Passwört12345",
                None,
            ],
        )

    def test_create_arguments_by_type(self):
        def parse(args, secret_values):
            return self.module.parse_create(self.module.DEFAULT_CONFIG, args, secret_values)

        base = {"domain": "shop.example.ch", "siteUser": "shop-example-ch"}
        secret_values = {"password": REAL}
        cases = [
            (dict(base, type="php", template="Generic"), "phpVersion"),
            (dict(base, type="php", phpVersion="8.4"), "template"),
            (dict(base, type="static", template="Generic"), "template"),
            (dict(base, type="nodejs"), "nodejsVersion"),
            (dict(base, type="static", nodejsVersion="22"), "nodejsVersion"),
            (dict(base, type="static", database={"name": "other_wp", "userName": "other_wp"}), "database"),
            (dict(base, type="static", database={"name": "shop_example_ch_wp"}), "database"),
            (dict(base, type="python"), "type"),
            (dict(base, type="static", siteUser="root"), "siteUser"),
        ]
        for args, field in cases:
            with self.assertRaises(self.module.AgentError, msg=repr(args)) as caught:
                parse(args, dict(secret_values, databasePassword=DB_REAL) if "database" in args else secret_values)
            self.assertEqual((caught.exception.code, caught.exception.field), ("invalid", field), args)
        with self.assertRaises(self.module.AgentError) as caught:
            parse(dict(base, type="static"), {"password": REAL, "databasePassword": DB_REAL})
        self.assertEqual(caught.exception.field, "databasePassword")
        with self.assertRaises(self.module.AgentError) as caught:
            parse(dict(base, type="static"), {})
        self.assertEqual(caught.exception.field, "password")
        self.assertEqual(parse(dict(base, type="static", database=None), secret_values)["type"], "static")


# --- 3. to 6. and 10.: create -----------------------------------------------------------------------


class CreateTest(AgentTestCase):
    def test_php_site(self):
        server = self.server
        answer = server.create()
        self.assertTrue(answer["ok"], answer)
        home = server.path("home", "shop-example-ch")
        self.assertEqual(
            answer["data"],
            {
                "site": {
                    "domain": "shop.example.ch",
                    "type": "php",
                    "siteUser": "shop-example-ch",
                    "homeDirectory": home,
                    "webRoot": home + "/htdocs/shop.example.ch",
                    "application": "WordPress",
                    "phpVersion": "8.4",
                    "nodejsVersion": None,
                    "appPort": None,
                    "createdAt": NOW_ISO,
                    "certificate": None,
                    "databases": [],
                    "usage": None,
                },
                "warnings": [],
            },
        )
        add = [c["argv"] for c in server.calls("clpctl") if c["argv"][0] == "site:add:php"]
        self.assertEqual(len(add), 1)
        throwaway = add[0][-1].split("=", 1)[1]
        self.assertTrue(THROWAWAY.fullmatch(throwaway), throwaway)
        self.assertEqual(
            add[0],
            [
                "site:add:php",
                "--domainName=shop.example.ch",
                "--phpVersion=8.4",
                "--vhostTemplate=WordPress",
                "--siteUser=shop-example-ch",
                "--siteUserPassword=" + throwaway,
            ],
        )
        self.assertEqual([c["stdin"] for c in server.calls("chpasswd")], ["shop-example-ch:%s\n" % REAL])
        self.assertEqual(server.state()["linuxPasswords"]["shop-example-ch"], REAL)
        # The window in which the throw-away password could have been used is closed.
        self.assertEqual([c["argv"] for c in server.calls("pkill")], [["-KILL", "-u", "shop-example-ch"]] * 2)
        self.assertEqual([c["argv"] for c in server.calls("crontab")], [["-r", "-u", "shop-example-ch"]])
        self.assertEqual(os.path.getsize(os.path.join(home, ".ssh", "authorized_keys")), 0)
        record = server.managed()["shop.example.ch"]
        self.assertEqual(
            {k: v for k, v in record.items() if k != "requestId"},
            {
                "siteUser": "shop-example-ch",
                "source": "create",
                "createdAt": NOW_ISO,
                "letsEncrypt": False,
                "incomplete": False,
            },
        )
        self.assertEqual(stat.S_IMODE(os.stat(server.paths.managed).st_mode), 0o600)
        self.assertEqual(
            [c["program"] for c in server.calls()],
            ["dpkg-query", "clpctl", "clpctl", "chpasswd", "pkill", "crontab", "pkill"],
        )
        self.assertNoSecretLeft(REAL)
        self.assertIn(throwaway, server.panel("SELECT user_password FROM site")[0][0])
        log = server.log_lines()
        self.assertEqual(len(log), 1)
        self.assertEqual((log[0]["op"], log[0]["domain"], log[0]["code"]), ("create", "shop.example.ch", "ok"))
        self.assertTrue(set(log[0]) >= {"requestId", "ms", "time"})

    def test_static_site(self):
        answer = self.server.create(type="static", phpVersion=None, template=None)
        self.assertTrue(answer["ok"], answer)
        self.assertEqual((answer["data"]["site"]["type"], answer["data"]["site"]["application"]), ("static", None))
        argv = [c["argv"] for c in self.server.calls("clpctl") if c["argv"][0].startswith("site:add")][0]
        self.assertEqual(argv[:3], ["site:add:static", "--domainName=shop.example.ch", "--siteUser=shop-example-ch"])
        self.assertEqual(len(argv), 4)

    def test_nodejs_site_gets_a_free_port(self):
        server = self.server
        server.add_site("other.example.ch", "other-example-ch", kind="nodejs", port=3002, managed=False)
        answer = server.create(type="nodejs", phpVersion=None, template=None, nodejsVersion="22")
        self.assertError(answer, "invalid", "type")
        self.assertNotIn("site:add:nodejs", server.clpctl_commands())
        server.write_config(nodejs=True)
        answer = server.create(type="nodejs", phpVersion=None, template=None, nodejsVersion="22")
        self.assertTrue(answer["ok"], answer)
        argv = [c["argv"] for c in server.calls("clpctl") if c["argv"][0] == "site:add:nodejs"][0]
        # 3001 is listening, 3002 belongs to another site, 3005 is only a connection.
        self.assertEqual(
            argv[:4], ["site:add:nodejs", "--domainName=shop.example.ch", "--nodejsVersion=22", "--appPort=3003"]
        )
        site = answer["data"]["site"]
        self.assertEqual((site["nodejsVersion"], site["appPort"], site["phpVersion"]), ("22", 3003, None))

    def test_template_and_php_version_must_exist(self):
        server = self.server
        self.assertError(server.create(template="Joomla"), "invalid", "template")
        self.assertError(server.create(template="Static"), "invalid", "template")
        self.assertError(server.create(phpVersion="8.2"), "invalid", "phpVersion")
        server.write_config(phpVersions=["8.3"])
        self.assertError(server.create(phpVersion="8.4"), "invalid", "phpVersion")
        self.assertTrue(server.create(phpVersion="8.3", template="Laravel 12")["ok"])
        site = server.managed()
        self.assertIn("shop.example.ch", site)
        self.assertEqual(
            [c["argv"][0] for c in server.calls("clpctl")].count("site:add:php"), 1, "only the valid request ran"
        )

    def test_protected_and_existing(self):
        server = self.server
        server.protect("domain cp.example.ch", "user weblion-cp-site")
        server.add_site("taken.example.ch", "taken-example-ch", managed=False, databases=["taken_example_ch_wp"])
        server.add_site("www.alias.example.ch", "alias-example-ch", managed=False)
        cases = [
            (dict(domain="cp.example.ch"), "protected", "domain"),
            (dict(domain="www.cp.example.ch"), "protected", "domain"),
            (dict(siteUser="weblion-cp-site"), "invalid", "siteUser"),
            (dict(siteUser="backup"), "protected", "siteUser"),
            (dict(siteUser="taken-user"), "exists", "siteUser"),
            (dict(domain="taken.example.ch", siteUser="taken-new"), "exists", "domain"),
            (dict(domain="alias.example.ch", siteUser="alias-new"), "exists", "domain"),
        ]
        for overrides, code, field in cases:
            self.assertError(server.create(**overrides), code, field)
        server.protect("user protected-user")
        self.assertError(server.create(siteUser="protected-user"), "protected", "siteUser")
        self.assertError(
            server.create(siteUser="shop-example-ch", database="taken_example_ch_wp"), "invalid", "database"
        )
        # A database name taken in CloudPanel or only in MySQL.
        server.change_state(lambda s: s["mysql"]["schemas"].append("shop_example_ch_db"))
        self.assertError(server.create(database="shop_example_ch_db"), "exists", "database")
        server.add_site("x.example.ch", "x-example-ch", managed=False)
        server.panel("INSERT INTO database (site_id, name) VALUES (99, 'shop_example_ch_old')")
        self.assertError(server.create(database="shop_example_ch_old"), "exists", "database")
        self.assertFalse([c for c in server.calls("clpctl") if c["argv"][0].startswith("site:add")])
        self.assertEqual(server.calls("chpasswd"), [])
        self.assertEqual(server.managed().keys() - {"taken.example.ch", "www.alias.example.ch", "x.example.ch"}, set())

    def test_no_site_created_although_clpctl_exited_0(self):
        server = self.server
        server.mode("site:add:php", "no_row")
        error = self.assertError(server.create(), "clpctl_failed")
        self.assertIs(error["rolledBack"], True)
        self.assertIn("too short", error["output"])
        self.assertNotIn("site:delete", server.clpctl_commands())
        self.assertEqual(server.calls("chpasswd"), [])
        self.assertEqual(server.managed(), {})

    def test_rollback_when_the_password_cannot_be_set(self):
        server = self.server
        server.mode("chpasswd", "fail")
        error = self.assertError(server.create(), "clpctl_failed")
        self.assertIs(error["rolledBack"], True)
        deletes = [c["argv"] for c in server.calls("clpctl") if c["argv"][0] == "site:delete"]
        self.assertEqual(deletes, [["site:delete", "--domainName=shop.example.ch", "--force"]])
        self.assertEqual(server.panel("SELECT * FROM site"), [])
        self.assertNotIn("shop-example-ch", server.state()["passwd"])
        self.assertEqual(server.managed(), {})

    def test_failed_rollback_leaves_an_incomplete_managed_site(self):
        server = self.server
        server.mode("chpasswd", "fail")
        server.mode("site:delete", "fail")
        error = self.assertError(server.create(), "clpctl_failed")
        self.assertIs(error["rolledBack"], False)
        self.assertIs(server.managed()["shop.example.ch"]["incomplete"], True)
        # The site is still there, managed: the console can delete it later.
        self.assertEqual(len(server.panel("SELECT * FROM site")), 1)
        server.change_state(lambda s: s["modes"].clear())
        self.assertTrue(server.request("password", {"domain": "shop.example.ch"}, {"password": REAL})["ok"])
        self.assertIs(server.managed()["shop.example.ch"]["incomplete"], False)

    def test_timeout_before_the_site_exists(self):
        server = self.server
        agent_templates = self.module.Agent.templates

        def slow_templates(agent):
            server.clock.now += 400
            return agent_templates(agent)

        with mock.patch.object(self.module.Agent, "templates", slow_templates):
            error = self.assertError(server.create(), "timeout")
        self.assertIs(error["rolledBack"], True)
        self.assertNotIn("site:add:php", server.clpctl_commands())

    def test_timeout_after_the_site_exists_rolls_back(self):
        server = self.server
        clpctl = self.module.Agent.clpctl

        def slow_clpctl(agent, *args, **kwargs):
            result = clpctl(agent, *args, **kwargs)
            if args[0] == "site:add:php":
                server.clock.now += 400
            return result

        with mock.patch.object(self.module.Agent, "clpctl", slow_clpctl):
            error = self.assertError(server.create(), "timeout")
        self.assertIs(error["rolledBack"], True)
        self.assertIn("ran out of time before chpasswd", error["message"])
        self.assertEqual(server.clpctl_commands()[-1], "site:delete")
        self.assertEqual(server.panel("SELECT * FROM site"), [])
        self.assertEqual(server.managed(), {})

    def test_with_a_database(self):
        server = self.server
        answer = server.create(database="shop_example_ch_wp")
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(answer["data"]["warnings"], [])
        self.assertEqual(
            answer["data"]["site"]["databases"],
            [{"name": "shop_example_ch_wp", "users": ["shop_example_ch_wp"], "sizeBytes": None}],
        )
        add = [c["argv"] for c in server.calls("clpctl") if c["argv"][0] == "db:add"][0]
        throwaway = add[-1].split("=", 1)[1]
        self.assertTrue(THROWAWAY.fullmatch(throwaway))
        self.assertEqual(
            add,
            [
                "db:add",
                "--domainName=shop.example.ch",
                "--databaseName=shop_example_ch_wp",
                "--databaseUserName=shop_example_ch_wp",
                "--databaseUserPassword=" + throwaway,
            ],
        )
        passwords = server.state()["mysql"]["passwords"]
        self.assertEqual(passwords, {"shop_example_ch_wp@localhost": DB_REAL, "shop_example_ch_wp@127.0.0.1": DB_REAL})
        statements = "".join(c["stdin"] for c in server.calls("mysql"))
        self.assertIn("KILL 41;", statements)
        self.assertEqual(server.state()["mysql"]["sessions"]["shop_example_ch_wp"], [])
        # The master credentials only ever lived in a private option file, removed afterwards.
        option_files = [c["optionFile"] for c in server.calls("mysql")]
        self.assertTrue(option_files)
        for info in option_files:
            self.assertEqual((info["mode"], info["dirMode"]), (0o600, 0o700))
            self.assertIn('password="M4ster\\"pw\\\\x|y"', info["content"])
            self.assertFalse(os.path.exists(info["path"]))
        self.assertEqual(os.listdir(server.paths.run_dir), ["weblion-clp.lock"])
        self.assertNoSecretLeft(REAL, DB_REAL, MASTER)

    def test_failed_database_keeps_the_site(self):
        server = self.server
        server.mode("db:add", "fail")
        answer = server.create(database="shop_example_ch_wp")
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(len(answer["data"]["warnings"]), 1)
        self.assertTrue(answer["data"]["warnings"][0].startswith("The database could not be created: "))
        self.assertEqual(answer["data"]["site"]["databases"], [])
        self.assertIn("shop.example.ch", server.managed())
        self.assertNotIn("ALTER USER", "".join(c["stdin"] for c in server.calls("mysql")))

    def test_database_without_its_user_is_rolled_back(self):
        server = self.server
        server.mode("db:add", "no_user")
        answer = server.create(database="shop_example_ch_wp")
        self.assertTrue(answer["ok"], answer)
        self.assertIn("did not create the database", answer["data"]["warnings"][0])
        self.assertIn("db:delete", server.clpctl_commands())
        self.assertEqual(server.panel("SELECT * FROM database"), [])

    def test_secrets_are_redacted(self):
        server = self.server
        server.mode("site:add:php", "no_row")
        server.change_state(
            lambda s: s["echo"].__setitem__(
                "site:add:php",
                'An error has occurred, error message: Command " : /usr/bin/sudo /usr/sbin/useradd -p '
                "$(/usr/bin/openssl passwd -6 '{password}') -m 'shop-example-ch'\" failed. --siteUserPassword={password} "
                "ALTER USER 'x'@'y' IDENTIFIED BY 'z' real=%s db=%s master=%s" % (REAL, DB_REAL, MASTER),
            )
        )
        error = self.assertError(server.create(database="shop_example_ch_wp"), "clpctl_failed")
        throwaway = [c["argv"] for c in server.calls("clpctl") if c["argv"][0] == "site:add:php"][0][-1].split("=")[1]
        self.assertIn("passwd -6 '•••'", error["output"])
        self.assertIn("--siteUserPassword=•••", error["output"])
        self.assertIn("IDENTIFIED BY '•••'", error["output"])
        self.assertIn("real=•••", error["output"])
        self.assertNoSecretLeft(REAL, DB_REAL, MASTER)
        # The throw-away value is only in clpctl's own argv.
        for text in server.answers + [json.dumps(server.log_lines())]:
            self.assertNotIn(throwaway, text)

    def test_timeout_kills_the_whole_process_group(self):
        server = self.server
        with self.assertRaises(self.module.AgentError) as caught:
            server.agent().run([server.path("bin", "hang")], timeout=1)
        self.assertEqual(caught.exception.code, "timeout")
        with open(server.path("bin", "hang.pid"), encoding="ascii") as handle:
            pid = int(handle.read())
        # The child is gone, or a zombie its new parent has not collected yet.
        give_up = time.monotonic() + 5
        while True:
            try:
                with open("/proc/%d/stat" % pid, encoding="ascii") as handle:
                    state = handle.read().rsplit(")", 1)[1].split()[0]
            except FileNotFoundError:
                state = None
            if state in (None, "Z") or time.monotonic() > give_up:
                break
            time.sleep(0.05)
        self.assertIn(state, (None, "Z"))

    def test_redact(self):
        agent = self.server.agent()
        agent.secrets += ["abc", "Secret-1234"]
        text = agent.redact(
            "x Secret-1234 abc openssl passwd -6 'aa bb' IDENTIFIED by 'q' --databaseUserPassword=zz9 --password=p "
            + "y" * 3000
        )
        self.assertTrue(
            text.startswith(
                "x ••• abc openssl passwd -6 '•••' IDENTIFIED BY '•••' --databaseUserPassword=••• --password=••• yy"
            ),
            text[:120],
        )
        self.assertEqual(len(text), 2000)


# --- 7. to 9.: changes of existing sites ---------------------------------------------------------------


class GuardTest(AgentTestCase):
    REQUESTS = [
        ("delete", {}, None),
        ("password", {}, {"password": REAL}),
        ("db-add", {"name": "site_example_ch_x", "userName": "site_example_ch_x"}, {"password": DB_REAL}),
        ("db-delete", {"name": "site_example_ch_wp"}, None),
        ("db-password", {"name": "site_example_ch_wp", "userName": "site_example_ch_wp"}, {"password": DB_REAL}),
        ("cert", {}, None),
    ]

    def check_refused(self, domain, code):
        for op, args, secret_values in self.REQUESTS:
            answer = self.server.request(op, dict(args, domain=domain), secret_values)
            self.assertError(answer, code)
        self.assertEqual(self.server.changing_calls(), [])

    def test_unmanaged_site(self):
        self.server.add_site("site.example.ch", "site-example-ch", managed=False, databases=["site_example_ch_wp"])
        self.check_refused("site.example.ch", "not_managed")

    def test_protected_domain(self):
        self.server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"])
        self.server.protect("domain site.example.ch")
        self.check_refused("site.example.ch", "protected")
        self.server.protect("domain www.site.example.ch")
        self.check_refused("site.example.ch", "protected")

    def test_protected_user(self):
        self.server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"])
        self.server.protect("user site-example-ch")
        self.check_refused("site.example.ch", "protected")

    def test_site_user_changed(self):
        self.server.add_site(
            "site.example.ch", "site-example-ch", databases=["site_example_ch_wp"], record={"siteUser": "someone-else"}
        )
        self.check_refused("site.example.ch", "not_managed")

    def test_missing_in_cloudpanel(self):
        self.server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"])
        self.server.panel("DELETE FROM site")
        self.check_refused("site.example.ch", "not_found")

    def test_database_of_another_site(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"])
        server.add_site("other.example.ch", "other-example-ch", databases=["other_example_ch_wp"])
        answer = server.request("db-delete", {"domain": "site.example.ch", "name": "other_example_ch_wp"})
        self.assertError(answer, "not_found", "name")
        answer = server.request("db-delete", {"domain": "site.example.ch", "name": "site_example_ch_none"})
        self.assertError(answer, "not_found", "name")
        answer = server.request(
            "db-password",
            {"domain": "site.example.ch", "name": "other_example_ch_wp", "userName": "other_example_ch_wp"},
            {"password": DB_REAL},
        )
        self.assertError(answer, "not_found", "name")
        answer = server.request(
            "db-password",
            {"domain": "site.example.ch", "name": "site_example_ch_wp", "userName": "other_example_ch_wp"},
            {"password": DB_REAL},
        )
        self.assertError(answer, "not_found", "userName")
        self.assertEqual(server.changing_calls(), [])


class DeleteTest(AgentTestCase):
    def setUp(self):
        super().setUp()
        self.server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"])
        os.makedirs(os.path.dirname(self.server.paths.usage), exist_ok=True)
        with open(self.server.paths.usage, "w", encoding="utf-8") as handle:
            json.dump({"site.example.ch": {"diskBytes": 1, "databases": {}, "measuredAt": NOW_ISO}}, handle)

    def test_delete(self):
        server = self.server
        answer = server.request("delete", {"domain": "site.example.ch"})
        self.assertEqual(answer, {"v": 1, "ok": True, "data": {"warnings": []}})
        self.assertEqual(
            [c["argv"] for c in server.calls("clpctl") if c["argv"][0] != "db:show:master-credentials"],
            [["site:delete", "--domainName=site.example.ch", "--force"]],
        )
        # Leftovers are looked for by the names read before the delete.
        self.assertIn("WHERE SCHEMA_NAME IN ('site_example_ch_wp')", server.calls("mysql")[0]["stdin"])
        self.assertEqual(server.managed(), {})
        with open(server.paths.usage, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle), {})

    def test_leftovers_are_removed_with_warnings(self):
        server = self.server
        server.mode("site:delete", "leave_databases")
        with open(server.path("crontabs", "site-example-ch"), "w", encoding="utf-8") as handle:
            handle.write("* * * * * curl http://example.invalid\n")
        answer = server.request("delete", {"domain": "site.example.ch"})
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(
            sorted(answer["data"]["warnings"]),
            sorted(
                [
                    "CloudPanel left the database site_example_ch_wp behind; it has been removed",
                    "CloudPanel left the database user site_example_ch_wp@localhost behind; it has been removed",
                    "CloudPanel left the database user site_example_ch_wp@127.0.0.1 behind; it has been removed",
                    "The crontab of the removed user site-example-ch has been deleted",
                ]
            ),
        )
        mysql = server.state()["mysql"]
        self.assertNotIn("site_example_ch_wp", mysql["schemas"])
        self.assertEqual(mysql["users"], [])
        self.assertFalse(os.path.exists(server.path("crontabs", "site-example-ch")))
        self.assertEqual(server.managed(), {})

    def test_a_database_user_of_another_site_stays(self):
        server = self.server
        server.add_site("other.example.ch", "other-example-ch", databases=["other_example_ch_wp"])
        server.panel("INSERT INTO database_user (database_id, user_name) VALUES (2, 'site_example_ch_wp')")
        server.mode("site:delete", "leave_databases")
        answer = server.request("delete", {"domain": "site.example.ch"})
        self.assertEqual(
            answer["data"]["warnings"], ["CloudPanel left the database site_example_ch_wp behind; it has been removed"]
        )
        self.assertIn(["site_example_ch_wp", "localhost"], server.state()["mysql"]["users"])
        self.assertNotIn("DROP USER", "".join(c["stdin"] for c in server.calls("mysql")))

    def test_remaining_linux_user_is_a_warning(self):
        self.server.mode("site:delete", "leave_user")
        answer = self.server.request("delete", {"domain": "site.example.ch"})
        self.assertEqual(answer["data"]["warnings"], ["The Linux user site-example-ch still exists on the server"])

    def test_failed_delete_keeps_the_site_managed(self):
        self.server.mode("site:delete", "fail")
        self.assertError(self.server.request("delete", {"domain": "site.example.ch"}), "clpctl_failed")
        self.assertIn("site.example.ch", self.server.managed())


class DatabaseTest(AgentTestCase):
    def setUp(self):
        super().setUp()
        self.server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"])

    def test_add(self):
        server = self.server
        answer = server.request(
            "db-add",
            {"domain": "site.example.ch", "name": "site_example_ch_shop", "userName": "site_example_ch_shop"},
            {"password": DB_REAL},
        )
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(
            [d["name"] for d in answer["data"]["site"]["databases"]], ["site_example_ch_shop", "site_example_ch_wp"]
        )
        add = [c["argv"] for c in server.calls("clpctl") if c["argv"][0] == "db:add"][0]
        self.assertTrue(THROWAWAY.fullmatch(add[-1].split("=", 1)[1]))
        self.assertEqual(server.state()["mysql"]["passwords"]["site_example_ch_shop@127.0.0.1"], DB_REAL)
        self.assertNoSecretLeft(DB_REAL)

    def test_add_checks_prefix_and_names(self):
        server = self.server
        answer = server.request(
            "db-add", {"domain": "site.example.ch", "name": "other_db", "userName": "other_db"}, {"password": DB_REAL}
        )
        self.assertError(answer, "invalid", "name")
        answer = server.request(
            "db-add",
            {"domain": "site.example.ch", "name": "site_example_ch_wp", "userName": "site_example_ch_new"},
            {"password": DB_REAL},
        )
        self.assertError(answer, "exists", "name")
        answer = server.request(
            "db-add",
            {"domain": "site.example.ch", "name": "site_example_ch_new", "userName": "site_example_ch_wp"},
            {"password": DB_REAL},
        )
        self.assertError(answer, "exists", "userName")
        self.assertNotIn("db:add", server.clpctl_commands())

    def test_failed_add_is_rolled_back(self):
        server = self.server
        server.mode("mysql", "fail")
        answer = server.request(
            "db-add",
            {"domain": "site.example.ch", "name": "site_example_ch_new", "userName": "site_example_ch_new"},
            {"password": DB_REAL},
        )
        error = self.assertError(answer, "clpctl_failed")
        self.assertNotIn("db:add", server.clpctl_commands())
        self.assertNoSecretLeft(DB_REAL, MASTER)
        server.mode("mysql", "ok")
        server.mode("db:add", "no_user")
        error = self.assertError(
            server.request(
                "db-add",
                {"domain": "site.example.ch", "name": "site_example_ch_new", "userName": "site_example_ch_new"},
                {"password": DB_REAL},
            ),
            "clpctl_failed",
        )
        self.assertIs(error["rolledBack"], True)
        self.assertEqual(server.clpctl_commands()[-1], "db:delete")

    def test_delete(self):
        server = self.server
        answer = server.request("db-delete", {"domain": "site.example.ch", "name": "site_example_ch_wp"})
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(answer["data"]["site"]["databases"], [])
        self.assertIn(
            ["db:delete", "--databaseName=site_example_ch_wp", "--force"], [c["argv"] for c in server.calls("clpctl")]
        )
        server.add_site("two.example.ch", "two-example-ch", databases=["two_example_ch_wp"])
        server.mode("db:delete", "fail")
        answer = server.request("db-delete", {"domain": "two.example.ch", "name": "two_example_ch_wp"})
        self.assertError(answer, "clpctl_failed")

    def test_password(self):
        server = self.server
        answer = server.request(
            "db-password",
            {"domain": "site.example.ch", "name": "site_example_ch_wp", "userName": "site_example_ch_wp"},
            {"password": DB_REAL},
        )
        self.assertEqual(answer, {"v": 1, "ok": True, "data": {}})
        self.assertEqual(
            server.state()["mysql"]["passwords"],
            {"site_example_ch_wp@localhost": DB_REAL, "site_example_ch_wp@127.0.0.1": DB_REAL},
        )
        self.assertEqual(server.clpctl_commands(), ["db:show:master-credentials"])
        self.assertNoSecretLeft(DB_REAL, MASTER)


class PasswordAndCertificateTest(AgentTestCase):
    def setUp(self):
        super().setUp()
        self.server.add_site("site.example.ch", "site-example-ch", cert_days=3)

    def test_password(self):
        server = self.server
        answer = server.request("password", {"domain": "site.example.ch"}, {"password": REAL})
        self.assertEqual(answer, {"v": 1, "ok": True, "data": {}})
        self.assertEqual([c["stdin"] for c in server.calls("chpasswd")], ["site-example-ch:%s\n" % REAL])
        # Sessions and processes stay (a Node.js app keeps running).
        self.assertEqual(server.calls("pkill"), [])
        self.assertEqual(server.calls("clpctl"), [])
        self.assertNoSecretLeft(REAL)

    def test_certificate(self):
        server = self.server
        answer = server.request("cert", {"domain": "site.example.ch"})
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(
            answer["data"]["site"]["certificate"],
            {"type": "2", "letsEncrypt": True, "expiresAt": "2027-01-09T12:00:30Z"},
        )
        self.assertEqual(
            [c["argv"] for c in server.calls("clpctl")],
            [["lets-encrypt:install:certificate", "--domainName=site.example.ch"]],
        )
        self.assertIs(server.managed()["site.example.ch"]["letsEncrypt"], True)

    def test_certificate_failures(self):
        server = self.server
        server.mode("lets-encrypt:install:certificate", "nxdomain")
        error = self.assertError(server.request("cert", {"domain": "site.example.ch"}), "clpctl_failed")
        self.assertIn("DNS problem: NXDOMAIN looking up A for site.example.ch", error["message"])
        server.mode("lets-encrypt:install:certificate", "short")
        error = self.assertError(server.request("cert", {"domain": "site.example.ch"}), "clpctl_failed")
        self.assertIs(server.managed()["site.example.ch"]["letsEncrypt"], False)


# --- reads -------------------------------------------------------------------------------------------


class ReadTest(AgentTestCase):
    def test_list_get_unmanaged(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"], cert_days=60)
        server.add_site("api.example.ch", "api-example-ch", kind="nodejs", port=3002)
        server.add_site("legacy.example.ch", "legacy", managed=False)
        server.add_site("cp.example.ch", "weblion-cp", kind="nodejs", port=3000)
        server.add_site("gone.example.ch", "gone-example-ch")
        server.panel("DELETE FROM site WHERE domain_name = 'gone.example.ch'")
        server.protect("domain cp.example.ch")
        listed = server.request("list")["data"]["sites"]
        self.assertEqual([s["domain"] for s in listed], ["api.example.ch", "site.example.ch"])
        site = listed[1]
        self.assertEqual(site["certificate"], {"type": "1", "letsEncrypt": None, "expiresAt": "2026-12-10T12:00:30Z"})
        self.assertEqual(site["createdAt"], "2026-01-02T03:04:05Z")
        self.assertEqual(
            site["databases"], [{"name": "site_example_ch_wp", "users": ["site_example_ch_wp"], "sizeBytes": None}]
        )
        self.assertEqual((listed[0]["appPort"], listed[0]["nodejsVersion"]), (3002, "22"))
        self.assertIn(
            {"event": "managed_missing", "domains": ["gone.example.ch"]},
            [{k: v for k, v in e.items() if k in ("event", "domains")} for e in server.log_lines()],
        )
        self.assertEqual(server.request("get", {"domain": "site.example.ch"})["data"]["site"], site)
        self.assertError(server.request("get", {"domain": "legacy.example.ch"}), "not_managed")
        self.assertError(server.request("get", {"domain": "gone.example.ch"}), "not_found")
        server.add_site("own.example.ch", "own-example-ch")
        server.protect("domain cp.example.ch", "domain own.example.ch")
        self.assertError(server.request("get", {"domain": "own.example.ch"}), "protected")
        unmanaged = server.request("unmanaged")["data"]
        self.assertEqual(
            unmanaged,
            {
                "sites": [
                    {"domain": "cp.example.ch", "type": "nodejs", "siteUser": "weblion-cp", "protected": True},
                    {"domain": "legacy.example.ch", "type": "php", "siteUser": "legacy", "protected": False},
                    {"domain": "own.example.ch", "type": "php", "siteUser": "own-example-ch", "protected": True},
                ],
                "allowRemoteAdopt": False,
            },
        )
        self.assertEqual(server.changing_calls(), [])

    def test_info(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch")
        server.add_site("legacy.example.ch", "legacy", managed=False)
        server.protect("domain cp.example.ch")
        info = server.request("info")["data"]
        self.assertEqual(
            info,
            {
                "agentVersion": self.module.AGENT_VERSION,
                "protocol": 1,
                "cloudpanelVersion": "2.5.4-3+clp-bookworm",
                "cliVersion": "CloudPanel CLI 6.0.8",
                "hostname": "web1.example.test",
                "os": "Debian GNU/Linux 12 (bookworm)",
                "ipv4": ["195.201.10.10"],
                "ipv6": ["2a01:4f8:c0c:1234::1"],
                "phpVersions": ["8.4", "8.3", "8.1"],
                "templates": [
                    {"name": "Generic", "rootDirectory": ""},
                    {"name": "WordPress", "rootDirectory": ""},
                    {"name": "WooCommerce", "rootDirectory": ""},
                    {"name": "Laravel 12", "rootDirectory": "public"},
                    {"name": "Static", "rootDirectory": ""},
                    {"name": "Nodejs", "rootDirectory": ""},
                ],
                "nodejsVersions": [],
                "nodejsEnabled": False,
                "allowRemoteAdopt": False,
                "protectedDomains": ["cp.example.ch"],
                "counts": {"sites": 2, "managed": 1, "unmanaged": 1},
            },
        )
        server.write_config(nodejs=True, phpVersions=["8.3", "7.4"])
        info = server.request("info")["data"]
        self.assertEqual((info["nodejsVersions"], info["nodejsEnabled"]), (["18", "20", "22", "24"], True))
        self.assertEqual(info["phpVersions"], ["8.3"])

    def test_php_versions_fallback(self):
        server = self.server
        shutil.rmtree(server.path("php-bin"))
        os.makedirs(server.path("php-etc", "8.2", "fpm"))
        os.makedirs(server.path("php-etc", "8.1", "cli"))
        self.assertEqual(server.agent().php_versions(), ["8.2"])


class PanelReadTest(AgentTestCase):
    def test_quiet_window(self):
        server = self.server
        read_at = []
        read_panel = self.module.Agent.read_panel

        def recording(agent):
            read_at.append(server.clock() % 60)
            return read_panel(agent)

        with mock.patch.object(self.module.Agent, "read_panel", recording):
            for second, sleeps in ((5, [5]), (2, [8]), (9, [1]), (10, []), (1, []), (30, [])):
                server.clock.now = NOW - 30 + second
                server.clock.sleeps = []
                server.agent().panel()
                self.assertEqual(server.clock.sleeps, sleeps, second)
                self.assertEqual(read_at[-1], second + sum(sleeps), second)

    def test_locked_database_is_retried_then_busy(self):
        server = self.server
        attempts = []
        read_panel = self.module.Agent.read_panel

        def flaky(agent, failures):
            attempts.append(1)
            if len(attempts) <= failures:
                raise sqlite3.OperationalError("database is locked")
            return read_panel(agent)

        with mock.patch.object(self.module.Agent, "read_panel", lambda agent: flaky(agent, 2)):
            self.assertTrue(server.request("list")["ok"])
        self.assertEqual((len(attempts), server.clock.sleeps), (3, [1, 1]))
        attempts.clear()
        with mock.patch.object(self.module.Agent, "read_panel", lambda agent: flaky(agent, 3)):
            self.assertError(server.request("list"), "busy")
        self.assertEqual(len(attempts), 3)

    def test_never_reads_panel_logins_or_site_passwords(self):
        server = self.server
        connect = sqlite3.connect
        denied = []

        def guarded_connect(*args, **kwargs):
            db = connect(*args, **kwargs)

            def authorizer(action, table, column, _database, _source):
                if action == sqlite3.SQLITE_READ and (table == "user" or (table, column) == ("site", "user_password")):
                    denied.append((table, column))
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK

            db.set_authorizer(authorizer)
            return db

        server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"])
        with mock.patch.object(self.module.sqlite3, "connect", guarded_connect):
            self.assertTrue(server.request("list")["ok"])
            self.assertTrue(server.request("unmanaged")["ok"])
            self.assertTrue(server.create(domain="new.example.ch", siteUser="new-example-ch")["ok"])
        self.assertEqual(denied, [])

    def test_old_panel_without_optional_columns(self):
        server = Server(self, schema=MINIMAL_SCHEMA)
        server.panel("INSERT INTO site (domain_name, type, user) VALUES ('old.example.ch', 'php', 'old-example-ch')")
        server.panel("INSERT INTO database (site_id, name) VALUES (1, 'old_example_ch_db')")
        server.change_state(lambda s: s["passwd"].__setitem__("old-example-ch", 1200))
        os.makedirs(os.path.dirname(server.paths.managed))
        with open(server.paths.managed, "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "sites": {"old.example.ch": {"siteUser": "old-example-ch"}}}, handle)
        listed = server.request("list")["data"]["sites"]
        home = server.path("home", "old-example-ch")
        self.assertEqual(
            listed,
            [
                {
                    "domain": "old.example.ch",
                    "type": "php",
                    "siteUser": "old-example-ch",
                    "homeDirectory": home,
                    "webRoot": home + "/htdocs/old.example.ch",
                    "application": None,
                    "phpVersion": None,
                    "nodejsVersion": None,
                    "appPort": None,
                    "createdAt": None,
                    "certificate": None,
                    "databases": [{"name": "old_example_ch_db", "users": [], "sizeBytes": None}],
                    "usage": None,
                }
            ],
        )

    def test_unknown_layout_is_a_version_error(self):
        server = Server(
            self,
            schema="CREATE TABLE site (id INTEGER, domain_name TEXT, type TEXT);"
            "CREATE TABLE database (id INTEGER, site_id INTEGER, name TEXT);",
        )
        error = self.assertError(server.request("list"), "version")
        self.assertIn("site.user", error["message"])
        server = Server(self, schema="CREATE TABLE site (id INTEGER, domain_name TEXT, type TEXT, user TEXT);")
        self.assertError(server.request("unmanaged"), "version")


# --- 13. adopt and forget ------------------------------------------------------------------------------


class AdoptTest(AgentTestCase):
    def setUp(self):
        super().setUp()
        self.server.add_site("legacy.example.ch", "legacy-site", managed=False)
        self.server.add_site("cp.example.ch", "weblion-cp", managed=False)

    def test_remote_adopt(self):
        server = self.server
        self.assertError(server.request("adopt", {"domain": "legacy.example.ch"}), "adopt_disabled")
        self.assertEqual(server.managed(), {})
        server.write_config(allowRemoteAdopt=True)
        server.protect("domain cp.example.ch")
        self.assertError(server.request("adopt", {"domain": "cp.example.ch"}), "protected")
        server.protect("user weblion-cp")
        self.assertError(server.request("adopt", {"domain": "cp.example.ch"}), "protected")
        self.assertError(server.request("adopt", {"domain": "none.example.ch"}), "not_found")
        answer = server.request("adopt", {"domain": "legacy.example.ch"})
        self.assertEqual(answer["data"]["site"]["siteUser"], "legacy-site")
        self.assertEqual(server.managed()["legacy.example.ch"]["source"], "adopt")
        self.assertError(server.request("adopt", {"domain": "legacy.example.ch"}), "exists", "domain")
        self.assertEqual(server.changing_calls(), [])

    def test_local_adopt(self):
        server = self.server
        out, err = io.StringIO(), io.StringIO()
        agent = server.agent(environ={"SUDO_USER": "weblion-agent"})
        self.assertEqual(agent.local(["adopt", "legacy.example.ch"], out, err), 1)
        self.assertIn("not available to weblion-agent", err.getvalue())
        self.assertEqual(server.managed(), {})
        self.assertEqual(server.agent(geteuid=lambda: 1000).local(["adopt", "legacy.example.ch"], out, err), 1)
        agent = server.agent(environ={"SUDO_USER": "admin"})
        self.assertEqual(agent.local(["adopt", "Legacy.Example.CH"], out, err), 0)
        self.assertEqual(server.managed()["legacy.example.ch"]["source"], "adopt")
        server.protect("user weblion-cp")
        self.assertEqual(server.agent().local(["adopt", "cp.example.ch"], out, err), 1)
        self.assertIn("protected", err.getvalue())

    def test_forget(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch")
        self.assertEqual(server.request("forget", {"domain": "site.example.ch"}), {"v": 1, "ok": True, "data": {}})
        self.assertEqual(server.managed(), {})
        self.assertTrue(server.request("forget", {"domain": "site.example.ch"})["ok"])
        self.assertEqual(len(server.panel("SELECT * FROM site")), 3)


# --- 14. the lock -----------------------------------------------------------------------------------


class LockTest(AgentTestCase):
    def hold(self, operation):
        os.makedirs(self.server.paths.run_dir, mode=0o700, exist_ok=True)
        fd = os.open(self.server.paths.lock, os.O_RDWR | os.O_CREAT, 0o600)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, operation | fcntl.LOCK_NB)
        return fd

    def test_exclusive_waits_then_busy(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch")
        fd = self.hold(fcntl.LOCK_EX)
        answer = server.request("password", {"domain": "site.example.ch"}, {"password": REAL}, lock_wait=3)
        self.assertError(answer, "busy")
        self.assertEqual(server.clock.sleeps, [0.5] * 6)
        self.assertEqual(server.calls(), [])
        self.assertError(server.request("list", lock_wait=1), "busy")
        fcntl.flock(fd, fcntl.LOCK_UN)
        self.assertTrue(server.request("password", {"domain": "site.example.ch"}, {"password": REAL})["ok"])

    def test_reads_share_the_lock(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch")
        self.hold(fcntl.LOCK_SH)
        self.assertTrue(server.request("list", lock_wait=1)["ok"])
        self.assertError(server.request("delete", {"domain": "site.example.ch"}, lock_wait=1), "busy")

    def test_wait_never_exceeds_the_operation_limit(self):
        server = self.server
        self.hold(fcntl.LOCK_EX)
        self.assertError(server.request("get", {"domain": "site.example.ch"}), "busy")
        self.assertEqual(sum(server.clock.sleeps), 20)


# --- 15. the version gate --------------------------------------------------------------------------


class VersionGateTest(AgentTestCase):
    def test_old_cloudpanel(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch")
        server.change_state(lambda s: s.__setitem__("dpkgVersion", "2.4.2-1"))
        for op, args, secret_values in (
            ("delete", {"domain": "site.example.ch"}, None),
            ("password", {"domain": "site.example.ch"}, {"password": REAL}),
            ("cert", {"domain": "site.example.ch"}, None),
        ):
            error = self.assertError(server.request(op, args, secret_values), "version")
            self.assertIn("2.4.2-1", error["message"])
        self.assertError(server.create(), "version")
        self.assertEqual(server.changing_calls(), [])
        self.assertTrue(server.request("list")["ok"])
        self.assertTrue(server.request("get", {"domain": "site.example.ch"})["ok"])
        self.assertEqual(server.request("info")["data"]["cloudpanelVersion"], "2.4.2-1")
        self.assertTrue(server.request("forget", {"domain": "site.example.ch"})["ok"])

    def test_unreadable_version(self):
        self.server.change_state(lambda s: s.__setitem__("dpkgVersion", None))
        self.assertError(self.server.create(), "version")
        self.server.change_state(lambda s: s.__setitem__("dpkgVersion", "1:2.5.0-1+clp-jammy"))
        self.assertTrue(self.server.create()["ok"])

    def test_parse_version(self):
        parse = self.module.parse_version
        self.assertEqual(parse("2.5.4-3+clp-noble"), (2, 5, 4))
        self.assertEqual(parse("1:2.10-1"), (2, 10, 0))
        self.assertIsNone(parse("unknown"))


# --- configuration, log, local commands --------------------------------------------------------------


class ConfigTest(AgentTestCase):
    def test_invalid_config_is_refused(self):
        server = self.server
        for key, value in (
            ("nodejsPorts", [80, 90]),
            ("nodejsPorts", ["3001", 3999]),
            ("dbQuietSeconds", [9, 2]),
            ("clpctl", "clpctl"),
            ("allowRemoteAdopt", "yes"),
            ("phpVersions", ["8"]),
            ("agentUser", "a b"),
        ):
            server.write_config(**{key: value})
            error = self.assertError(server.request("list"), "internal")
            self.assertIn(key, error["message"])
            server.write_config(**{key: Server(self).config[key]})
        self.assertTrue(server.request("list")["ok"])

    def test_protected_list_fails_closed(self):
        self.server.protect("domain cp.example.ch", "domian typo.example.ch")
        error = self.assertError(self.server.request("unmanaged"), "internal")
        self.assertIn("line 3", error["message"])

    def test_unexpected_errors_are_internal_and_logged(self):
        server = self.server
        with mock.patch.object(self.module.Agent, "op_list", lambda agent, args: 1 / 0):
            error = self.assertError(server.request("list"), "internal")
        self.assertNotIn("ZeroDivision", error["message"])
        self.assertTrue(any("ZeroDivisionError" in e.get("traceback", "") for e in server.log_lines()))
        self.assertEqual(stat.S_IMODE(os.stat(server.paths.log).st_mode), 0o600)


class LocalCommandTest(AgentTestCase):
    def run_local(self, *argv, **attributes):
        out, err = io.StringIO(), io.StringIO()
        code = self.server.agent(**attributes).local(list(argv), out, err)
        return code, out.getvalue(), err.getvalue()

    def test_help_and_usage(self):
        code, out, _err = self.run_local("--help", geteuid=lambda: 1000)
        self.assertEqual(code, 0)
        self.assertIn("weblion-clp selftest", out)
        code, _out, err = self.run_local("frobnicate")
        self.assertEqual(code, 2)
        self.assertIn("usage:", err)
        self.assertEqual(self.run_local("status", geteuid=lambda: 1000)[0], 1)

    def test_status(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch", record={"incomplete": True})
        server.add_site("legacy.example.ch", "legacy", managed=False)
        server.add_site("cp.example.ch", "weblion-cp", managed=False)
        server.add_site("gone.example.ch", "gone-example-ch")
        server.panel("DELETE FROM site WHERE domain_name = 'gone.example.ch'")
        server.protect("user weblion-cp")
        code, out, _err = self.run_local("status")
        self.assertEqual(code, 0)
        lines = [re.sub(r"\s+", " ", line).strip() for line in out.splitlines()]
        self.assertEqual(
            lines,
            [
                "DOMAIN TYPE USER STATE",
                "cp.example.ch php weblion-cp protected",
                "legacy.example.ch php legacy unmanaged",
                "site.example.ch php site-example-ch managed, incomplete",
                "gone.example.ch - - managed, missing in CloudPanel",
            ],
        )

    def test_protect(self):
        server = self.server
        self.assertEqual(self.run_local("protect", "domain", "CP.Example.CH")[0], 0)
        self.assertEqual(self.run_local("protect", "user", "weblion-cp")[0], 0)
        code, out, _err = self.run_local("protect", "user", "weblion-cp")
        self.assertEqual((code, out.strip()), (0, "user weblion-cp is protected already"))
        self.assertEqual(self.run_local("protect", "user", "bad user")[0], 1)
        self.assertEqual(self.run_local("protect", "domain", "1.2.3.4")[0], 1)
        with open(server.paths.protected, encoding="utf-8") as handle:
            self.assertEqual(handle.read().splitlines()[1:], ["domain cp.example.ch", "user weblion-cp"])
        self.assertEqual(stat.S_IMODE(os.stat(server.paths.protected).st_mode), 0o644)

    def test_refresh_usage(self):
        server = self.server
        server.add_site("site.example.ch", "site-example-ch", databases=["site_example_ch_wp"])
        server.add_site("legacy.example.ch", "legacy", managed=False)
        server.change_state(
            lambda s: s.update(
                du={"site-example-ch": 52428800}, mysql=dict(s["mysql"], sizes={"site_example_ch_wp": 3145728})
            )
        )
        code, out, _err = self.run_local("refresh-usage")
        self.assertEqual((code, out.strip()), (0, "Measured 1 websites"))
        du = [c for c in server.calls() if c["program"] == "du"]
        self.assertEqual(du[0]["argv"], ["-s", "-B1", "-x", server.path("home", "site-example-ch")])
        self.assertEqual([c["argv"][:2] for c in server.calls("nice")], [["-n", "19"]])
        site = server.request("get", {"domain": "site.example.ch"})["data"]["site"]
        self.assertEqual(site["usage"], {"diskBytes": 52428800, "databaseBytes": 3145728, "measuredAt": NOW_ISO})
        self.assertEqual(site["databases"][0]["sizeBytes"], 3145728)
        self.assertEqual(stat.S_IMODE(os.stat(server.paths.usage).st_mode), 0o600)

    def test_selftest(self):
        server = self.server
        server.add_site("legacy.example.ch", "legacy", managed=False)
        code, out, _err = self.run_local("selftest")
        self.assertEqual(code, 1)
        self.assertIn("FAIL  sudoers file", out)
        self.assertIn("WARN  the protected list is empty", out)
        for path in (server.paths.sudoers, server.paths.sshd_dropin):
            open(path, "w").close()
        server.protect("domain cp.example.ch")
        code, out, _err = self.run_local("selftest")
        self.assertEqual(code, 0, out)
        self.assertNotIn("FAIL", out)
        self.assertIn("OK    CloudPanel database: 1 sites", out)
        self.assertIn("OK    MySQL master credentials", out)
        self.assertNotIn(MASTER, out)
        server.change_state(lambda s: s.__setitem__("dpkgVersion", "2.4.9"))
        code, out, _err = self.run_local("selftest")
        self.assertEqual(code, 1)
        self.assertIn("FAIL  CloudPanel version", out)


class MainTest(unittest.TestCase):
    def test_main_answers_one_line(self):
        module = agent_module()
        server = Server(self)
        umask = os.umask(0o022)
        handlers = signal.getsignal(signal.SIGHUP), signal.getsignal(signal.SIGPIPE)
        stdin = mock.Mock()
        stdin.buffer = io.BytesIO(
            json.dumps({"v": 1, "op": "list", "requestId": str(uuid.uuid4()), "args": {}}).encode() + b"\n"
        )
        try:
            with mock.patch.object(sys, "stdin", stdin), mock.patch.object(sys, "stdout", io.StringIO()) as out:
                code = module.main([], agent=server.agent())
            self.assertEqual(signal.getsignal(signal.SIGHUP), signal.SIG_IGN)
            self.assertEqual(os.umask(0o022), 0o077)
        finally:
            os.umask(umask)
            signal.signal(signal.SIGHUP, handlers[0])
            signal.signal(signal.SIGPIPE, handlers[1])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue()), {"v": 1, "ok": True, "data": {"sites": []}})

    def test_script_help(self):
        done = subprocess.run([sys.executable, "-I", SCRIPT, "--help"], capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 0)
        self.assertIn("weblion-clp adopt <domain>", done.stdout)
        self.assertTrue(os.access(SCRIPT, os.X_OK))
        with open(SCRIPT, encoding="utf-8") as handle:
            self.assertEqual(handle.readline(), "#!/usr/bin/python3 -I\n")

    @unittest.skipIf(os.geteuid() == 0, "as root the script would use the real paths of a server")
    def test_script_refuses_without_root(self):
        line = json.dumps({"v": 1, "op": "list", "requestId": str(uuid.uuid4()), "args": {}}) + "\n"
        done = subprocess.run([sys.executable, "-I", SCRIPT], input=line, capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 1)
        answer = json.loads(done.stdout)
        self.assertEqual((answer["ok"], answer["error"]["code"]), (False, "internal"))


# --- install.sh ----------------------------------------------------------------------------------------


@unittest.skipUnless(shutil.which("bash"), "bash is needed for install.sh")
class InstallerTest(unittest.TestCase):
    KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEbS0E8kCv9yUz4Q3qkV6Yt6fW2t4r7q5m1n0p9o8i7u weblion-console"

    def run_installer(self, *args):
        return subprocess.run(
            ["bash", INSTALLER] + list(args), capture_output=True, text=True, timeout=30, stdin=subprocess.DEVNULL
        )

    def test_syntax_and_help(self):
        self.assertEqual(subprocess.run(["bash", "-n", INSTALLER]).returncode, 0)
        self.assertTrue(os.access(INSTALLER, os.X_OK))
        done = self.run_installer("--help")
        self.assertEqual(done.returncode, 0)
        for option in (
            "--public-key",
            "--from",
            "--protect-domain",
            "--protect-user",
            "--nodejs",
            "--allow-remote-adopt",
            "--uninstall",
        ):
            self.assertIn(option, done.stdout)

    def test_refuses_bad_arguments_before_anything_else(self):
        cases = [
            ([], "--public-key"),
            (["--public-key", self.KEY], "--from"),
            (["--public-key", "ssh-rsa AAAAB3NzaC1yc2E x", "--from", "192.0.2.10"], "ssh-ed25519"),
            (["--public-key", self.KEY + '" ,command="sh', "--from", "192.0.2.10"], "ssh-ed25519"),
            (["--public-key", self.KEY + "\nssh-ed25519 AAAA x", "--from", "192.0.2.10"], "ssh-ed25519"),
            (["--public-key", self.KEY, "--from", "192.0.2.10,*"], "--from"),
            (["--public-key", self.KEY, "--from", '192.0.2.10",command="sh'], "--from"),
            (["--public-key", self.KEY, "--from", "192.0.2.10", "--protect-domain", "a b"], "--protect-domain"),
            (["--public-key", self.KEY, "--from", "192.0.2.10", "--protect-user", "Root!"], "--protect-user"),
            (["--public-key", self.KEY, "--from", "192.0.2.10", "--frobnicate"], "--frobnicate"),
        ]
        for args, expected in cases:
            done = self.run_installer(*args)
            self.assertEqual(done.returncode, 2, (args, done.stdout, done.stderr))
            self.assertIn(expected, done.stderr, args)


if __name__ == "__main__":
    unittest.main()

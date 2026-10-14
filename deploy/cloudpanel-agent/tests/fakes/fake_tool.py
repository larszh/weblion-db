#!/usr/bin/env python3
"""
Fake server programs for the weblion-clp tests: clpctl, mysql, chpasswd, pkill, crontab,
dpkg-query, ip, du, nice and ionice in one file, plus "hang" (a command that never ends).

The tests copy this file under each program's name into a temporary directory. It acts by the
name it was started as, finds its state next to itself (state.json, which also names
CloudPanel's SQLite database) and appends every call (program, argv, stdin) to calls.jsonl.
"state.json" key "modes" switches a program or clpctl command into a failure mode, e.g.
{"site:add:php": "no_row", "chpasswd": "fail"}. Standard library only.
"""

import datetime
import json
import os
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, "state.json")
CALLS = os.path.join(HERE, "calls.jsonl")


def load():
    with open(STATE, encoding="utf-8") as handle:
        return json.load(handle)


def save(state):
    temporary = STATE + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
    os.replace(temporary, STATE)


def record(program, argv, stdin=None, **extra):
    entry = dict(extra, program=program, argv=argv, stdin=stdin)
    with open(CALLS, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")


def panel_time(state, days=0):
    moment = datetime.datetime.fromtimestamp(state["now"] + days * 86400, datetime.timezone.utc)
    return moment.strftime("%Y-%m-%d %H:%M:%S")


def options(args):
    found = {}
    for arg in args:
        match = re.fullmatch(r"--([A-Za-z]+)(?:=(.*))?", arg, re.DOTALL)
        if match:
            found[match.group(1)] = match.group(2) if match.group(2) is not None else True
    return found


def table(rows):
    widths = [max(len(str(row[i])) for row in rows) for i in range(len(rows[0]))]
    line = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    out = [line]
    for number, row in enumerate(rows):
        out.append("| " + " | ".join(str(c).ljust(widths[i]) for i, c in enumerate(row)) + " |")
        if number == 0:
            out.append(line)
    out.append(line)
    return "\n".join(out) + "\n"


# --- clpctl ------------------------------------------------------------------------------------


def drop_site_rows(db, site_id):
    database_ids = [row[0] for row in db.execute("SELECT id FROM database WHERE site_id = ?", (site_id,))]
    for database_id in database_ids:
        db.execute("DELETE FROM database_user WHERE database_id = ?", (database_id,))
    db.execute("DELETE FROM database WHERE site_id = ?", (site_id,))
    for name in ("php_settings", "nodejs_settings", "python_settings", "certificate"):
        db.execute("DELETE FROM %s WHERE site_id = ?" % name, (site_id,))
    db.execute("DELETE FROM site WHERE id = ?", (site_id,))


def drop_mysql(state, names, users):
    mysql = state["mysql"]
    mysql["schemas"] = [s for s in mysql["schemas"] if s not in names]
    mysql["users"] = [u for u in mysql["users"] if u[0] not in users]


def clpctl(state, args):
    command = args[0] if args else ""
    opts = options(args[1:])
    mode = state["modes"].get(command, "ok")
    echo = state.get("echo", {}).get(command)
    password = opts.get("siteUserPassword") or opts.get("databaseUserPassword") or ""
    if echo is not None:
        print(echo.replace("{password}", str(password)))
    if mode == "fail":
        print("An error has occurred, error message: %s failed" % command)
        return 1
    if command == "--version":
        print("CloudPanel CLI 6.0.8")
        return 0
    if command == "vhost-templates:list":
        print(table([["Name", "Root Directory", "Type"]] + [[n, r, "php"] for n, r in state["templates"]]))
        return 0
    if command == "db:show:master-credentials":
        master = state["master"]
        rows = [["Key", "Value"], ["Host", master["host"]], ["User Name", master["user"]]]
        rows += [["Password", master["password"]], ["Port", master["port"]]]
        print(table(rows))
        return 0
    if mode == "no_row":
        # CloudPanel printed an error but exited 0 and created nothing.
        if echo is None:
            print("siteUserPassword: This value is too short. It should have 8 characters or more.")
        return 0
    db = sqlite3.connect(state["panelDb"])
    try:
        code = clpctl_change(state, db, command, opts, mode)
        db.commit()
    finally:
        db.close()
    save(state)
    return code


def clpctl_change(state, db, command, opts, mode):
    domain = opts.get("domainName")
    site = db.execute("SELECT id, user FROM site WHERE domain_name = ?", (domain,)).fetchone() if domain else None
    if command.startswith("site:add:"):
        kind = command.split(":")[2]
        user = opts["siteUser"]
        template = opts.get("vhostTemplate")
        root = dict(state["templates"]).get(template, "") if template else ""
        cursor = db.execute(
            "INSERT INTO site (domain_name, type, user, user_password, root_directory, application, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (domain, kind, user, opts["siteUserPassword"], root, template, panel_time(state)),
        )
        if kind == "php":
            db.execute(
                "INSERT INTO php_settings (site_id, php_version) VALUES (?, ?)", (cursor.lastrowid, opts["phpVersion"])
            )
        if kind == "nodejs":
            db.execute(
                "INSERT INTO nodejs_settings (site_id, nodejs_version, port) VALUES (?, ?, ?)",
                (cursor.lastrowid, opts["nodejsVersion"], int(opts["appPort"])),
            )
        state["passwd"][user] = state["nextUid"]
        state["nextUid"] += 1
        state["linuxPasswords"][user] = opts["siteUserPassword"]
        home = os.path.join(state["home"], user)
        os.makedirs(os.path.join(home, ".ssh"), exist_ok=True)
        with open(os.path.join(home, ".ssh", "authorized_keys"), "w", encoding="utf-8") as handle:
            handle.write("ssh-ed25519 AAAAskeleton planted\n")
        print("Site %s has been added." % domain)
        return 0
    if command == "site:delete":
        if site is None:
            print("domainName: Does not exist.")
            return 1
        names = [r[0] for r in db.execute("SELECT name FROM database WHERE site_id = ?", (site[0],))]
        users = [
            r[0]
            for r in db.execute(
                "SELECT user_name FROM database_user WHERE database_id IN (SELECT id FROM database WHERE site_id = ?)",
                (site[0],),
            )
        ]
        drop_site_rows(db, site[0])
        if mode != "leave_databases":
            drop_mysql(state, names, users)
        if mode != "leave_user":
            state["passwd"].pop(site[1], None)
            shutil.rmtree(os.path.join(state["home"], site[1]), ignore_errors=True)
        print("Site %s has been deleted." % domain)
        return 0
    if command == "db:add":
        if site is None:
            print("domainName: Does not exist.")
            return 1
        name, user = opts["databaseName"], opts["databaseUserName"]
        cursor = db.execute("INSERT INTO database (site_id, name) VALUES (?, ?)", (site[0], name))
        if mode != "no_user":
            db.execute("INSERT INTO database_user (database_id, user_name) VALUES (?, ?)", (cursor.lastrowid, user))
        state["mysql"]["schemas"].append(name)
        for host in ("localhost", "127.0.0.1"):
            state["mysql"]["users"].append([user, host])
            state["mysql"]["passwords"]["%s@%s" % (user, host)] = opts["databaseUserPassword"]
        state["mysql"]["sessions"][user] = ["41"]
        print("Database %s has been added." % name)
        return 0
    if command == "db:delete":
        name = opts.get("databaseName")
        row = db.execute("SELECT id FROM database WHERE name = ?", (name,)).fetchone()
        if row is None:
            print("databaseName: Does not exist.")
            return 1
        users = [r[0] for r in db.execute("SELECT user_name FROM database_user WHERE database_id = ?", (row[0],))]
        db.execute("DELETE FROM database_user WHERE database_id = ?", (row[0],))
        db.execute("DELETE FROM database WHERE id = ?", (row[0],))
        drop_mysql(state, [name], users)
        print("Database %s has been deleted." % name)
        return 0
    if command == "lets-encrypt:install:certificate":
        if site is None:
            print("domainName: Does not exist.")
            return 1
        if mode == "nxdomain":
            print("Lets Encrypt failed: DNS problem: NXDOMAIN looking up A for %s" % domain)
            return 1
        days = 2 if mode == "short" else 90
        pem = "-----BEGIN CERTIFICATE-----\n%s\n-----END CERTIFICATE-----\n" % "TGV0J3MgRW5jcnlwdCBSMTE="
        cursor = db.execute(
            "INSERT INTO certificate (site_id, type, expires_at, certificate) VALUES (?, ?, ?, ?)",
            (site[0], "2", panel_time(state, days), pem),
        )
        db.execute("UPDATE site SET certificate_id = ? WHERE id = ?", (cursor.lastrowid, site[0]))
        print("Certificate has been installed.")
        return 0
    print('{"message":"Error thrown while running command","level":500}')
    print('Command "%s" is not defined.' % command)
    return 1


# --- mysql -------------------------------------------------------------------------------------


def unquote(value):
    return value.replace("''", "'").replace("\\\\", "\\")


def quoted(text):
    return [unquote(v) for v in re.findall(r"'((?:[^'\\]|''|\\\\)*)'", text)]


def mysql(state, args, sql):
    option_file = next((a.split("=", 1)[1] for a in args if a.startswith("--defaults-extra-file=")), None)
    info = None
    if option_file:
        with open(option_file, encoding="utf-8") as handle:
            content = handle.read()
        info = {
            "content": content,
            "mode": stat.S_IMODE(os.stat(option_file).st_mode),
            "dirMode": stat.S_IMODE(os.stat(os.path.dirname(option_file)).st_mode),
            "path": option_file,
        }
    record("mysql", args, sql, optionFile=info)
    if state["modes"].get("mysql") == "fail":
        print("ERROR 2002 (HY000): Can't connect to local MySQL server through socket")
        return 1
    db = state["mysql"]
    out = []
    for statement in [s.strip() for s in sql.split(";\n") if s.strip()]:
        statement = statement.rstrip(";")
        if statement.startswith("SELECT 'schema'"):
            out += ["schema\t%s" % s for s in quoted(statement.split(" IN ", 1)[1]) if s in db["schemas"]]
        elif statement.startswith("SELECT 'user'"):
            wanted = quoted(statement.split(" IN ", 1)[1])
            out += ["user\t%s\t%s" % (u, h) for u, h in db["users"] if u in wanted]
        elif statement.startswith("ALTER USER"):
            user, host, password = quoted(statement)
            db["passwords"]["%s@%s" % (user, host)] = password
        elif statement.startswith("SELECT ID FROM information_schema.PROCESSLIST"):
            out += db["sessions"].get(quoted(statement)[0], [])
        elif statement.startswith("KILL "):
            session = statement.split()[1]
            for user in db["sessions"]:
                db["sessions"][user] = [s for s in db["sessions"][user] if s != session]
        elif statement.startswith("DROP DATABASE"):
            name = statement.split("`")[1]
            db["schemas"] = [s for s in db["schemas"] if s != name]
        elif statement.startswith("DROP USER"):
            user, host = quoted(statement)
            db["users"] = [u for u in db["users"] if u != [user, host]]
        elif statement == "SELECT 1":
            out.append("1")
        elif statement.startswith("SELECT table_schema"):
            out += ["%s\t%d" % (name, size) for name, size in sorted(db["sizes"].items())]
        else:
            print("ERROR 1064 (42000): unknown statement in the fake: %s" % statement)
            return 1
    save(state)
    if out:
        print("\n".join(out))
    return 0


# --- small tools -------------------------------------------------------------------------------


def chpasswd(state, sql):
    if state["modes"].get("chpasswd") == "fail":
        print("chpasswd: (user x) pam_chauthtok() failed, error: Authentication token manipulation error")
        return 1
    for line in sql.splitlines():
        user, password = line.split(":", 1)
        if user not in state["passwd"]:
            print("chpasswd: (line 1, user %s) password not changed" % user)
            return 1
        state["linuxPasswords"][user] = password
    save(state)
    return 0


def main():
    program = os.path.basename(sys.argv[0])
    args = sys.argv[1:]
    stdin = None if sys.stdin is None or sys.stdin.isatty() else sys.stdin.read()
    state = load()
    if program == "mysql":
        return mysql(state, args, stdin or "")
    record(program, args, stdin or None)
    if program == "clpctl":
        return clpctl(state, args)
    if program == "chpasswd":
        return chpasswd(state, stdin or "")
    if program == "pkill":
        return 0 if state["modes"].get("pkill") == "killed" else 1
    if program == "crontab":
        print("no crontab for %s" % args[-1])
        return 1
    if program == "dpkg-query":
        if state["dpkgVersion"] is None:
            print("dpkg-query: no packages found matching cloudpanel")
            return 1
        sys.stdout.write(state["dpkgVersion"])
        return 0
    if program == "ip":
        print(json.dumps(state["ipAddr"]))
        return 0
    if program in ("nice", "ionice"):
        # nice -n 19 <command...>, ionice -c 3 <command...>
        os.execv(args[2], args[2:])
    if program == "hang":
        # Like clpctl (bash running PHP): a child that would go on after its parent is killed.
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        with open(os.path.join(HERE, "hang.pid"), "w", encoding="ascii") as handle:
            handle.write(str(child.pid))
        time.sleep(60)
        return 0
    if program == "du":
        print("du: cannot read directory '%s/.cache': Permission denied" % args[-1])
        print("%d\t%s" % (state["du"].get(os.path.basename(args[-1]), 4096), args[-1]))
        return 0
    print("fake_tool: unknown program %s" % program)
    return 127


if __name__ == "__main__":
    sys.exit(main())

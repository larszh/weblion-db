"""
Tests of weblion-clp. Run from the repository root:

    python3 -I -m unittest discover -s deploy/cloudpanel-agent/tests -v

Placeholder until the agent is implemented: checks that the script loads and answers in the
wire format.
"""

import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "weblion-clp")


def load_agent():
    """The script has no .py extension, so it is loaded by path."""
    loader = importlib.machinery.SourceFileLoader("weblion_clp", SCRIPT)
    spec = importlib.util.spec_from_loader("weblion_clp", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class PlaceholderTest(unittest.TestCase):
    def test_answers_one_json_line(self):
        agent = load_agent()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = agent.main([])
        self.assertEqual(code, 1)
        answer = json.loads(out.getvalue())
        self.assertEqual(answer["v"], agent.PROTOCOL)
        self.assertFalse(answer["ok"])
        self.assertEqual(answer["error"]["code"], "internal")


if __name__ == "__main__":
    unittest.main()

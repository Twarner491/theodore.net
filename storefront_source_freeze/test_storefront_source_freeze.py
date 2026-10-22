#!/usr/bin/env python3
"""Hostile offline tests for the fixed storefront source boundary."""

from __future__ import annotations

import inspect
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_storefront_source_freeze as freeze


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / freeze.MANIFEST_RELATIVE
SCOPE = ROOT / freeze.SCOPE_RELATIVE


def manifest_value(root: Path = ROOT) -> dict[str, object]:
    return json.loads((root / freeze.MANIFEST_RELATIVE).read_bytes())


def copy_candidate(destination: Path) -> Path:
    root = destination / "Project-Documentation-Site"
    value = manifest_value()
    for relative in value["directories"]:
        (root / relative).mkdir(parents=True, exist_ok=True)
    for row in value["files"]:
        target = root / row["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / row["path"], target)
    target = root / freeze.MANIFEST_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(MANIFEST, target)
    return root


def git(root: Path, *arguments: str) -> subprocess.CompletedProcess[bytes]:
    environment = {
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "LANG": "C",
        "LC_ALL": "C",
        "PATH": "/usr/bin:/bin",
    }
    return subprocess.run(
        ["/usr/bin/git", *arguments], cwd=root, env=environment,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        check=True,
    )


def make_clean_git(root: Path) -> str:
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(
        root, "-c", "user.name=Storefront Freeze Test",
        "-c", "user.email=storefront-freeze@example.invalid",
        "commit", "-q", "-m", "fixture",
    )
    return git(root, "rev-parse", "HEAD").stdout.decode().strip()


class StorefrontSourceFreezeTests(unittest.TestCase):
    maxDiff = None

    def assertRefused(self, operation, fragment: str | None = None) -> None:
        with self.assertRaises(freeze.StorefrontFreezeError) as captured:
            operation()
        if fragment is not None:
            self.assertIn(fragment, str(captured.exception))

    def test_current_source_is_exact_and_explicitly_nonrelease(self) -> None:
        result = freeze.verify_source(ROOT)
        value = manifest_value()
        self.assertEqual(result["file_count"], len(value["files"]))
        self.assertEqual(result["directory_count"], len(value["directories"]))
        self.assertFalse(result["release_ready"])
        self.assertEqual(MANIFEST.read_bytes(), freeze.render_manifest(ROOT))
        self.assertEqual(SCOPE.read_bytes(), freeze.canonical_json(json.loads(SCOPE.read_bytes())))
        self.assertEqual(list(inspect.signature(freeze.render_manifest).parameters), ["repo_root"])
        self.assertEqual(list(inspect.signature(freeze.verify_source).parameters), ["repo_root"])

    def test_scope_covers_required_commerce_and_build_boundaries(self) -> None:
        scope = json.loads(SCOPE.read_bytes())
        files = {row["path"] for row in manifest_value()["files"]}
        required = {
            ".github/workflows/ci.yml",
            "docs/CNAME",
            "docs/_redirects",
            "docs/assets/js/store.js",
            "docs/robots.txt",
            "docs/store/avian-visitors.md",
            "docs/sw.js",
            "functions/api/checkout.js",
            "functions/api/inventory-availability.js",
            "functions/api/payment-intent.js",
            "functions/api/stripe-webhook.js",
            "functions/go/[slug].js",
            "hooks/store_products.py",
            "lib/shipping-binding.js",
            "lib/shipping-capture-gate.js",
            "lib/shipping-profile.js",
            "lib/store-inventory-commerce.js",
            "lib/store-inventory-expiry.js",
            "lib/store-inventory.js",
            "migrations/0001_store_inventory.sql",
            "tools/store-inventory.md",
            "tools/rotate-secret.sh",
            "tools/set-live-stripe.sh",
            "tools/setup-rate-limits.sh",
            "tools/verify-store-inventory-export.mjs",
            "workers/store-inventory-expiry.js",
            "workers/wrangler.store-inventory-expiry.example.toml",
            "wrangler.toml",
        }
        self.assertTrue(required.issubset(files))
        held = {
            "docs/assets/js/store.js": "564e479ea3a3f028f65ed9e17b6f7a56516d65d423904bdc6fd70302075a1a1a",
            "docs/store/avian-visitors.md": "6c442fbfdbb7dfcecc3f3c5e30282c9629da51697d3f3bc80ca5233e384ce8a7",
            "functions/api/inventory-availability.js": "3a0275ef214a445e2d9d356bcb019df9dac38777dead495ea9bbebb8702b4d95",
            "functions/api/payment-intent.js": "1aa451bc111efbeed183bbdc7409d42ef549a8ddb417a71d32bd5afabc09beab",
            "functions/api/stripe-webhook.js": "eceba5054254a601b0e131b0bec1b26fa6cdd26f75030accdfaa69a0d495e700",
            "hooks/store_products.py": "b8d6b3d9346c8dfddfe17de1144b91b718206b5f2415c484d6409717bafa58a9",
            "lib/shipping-binding.js": "d823dae98b1e956accd4189c20b0d0a569fc77c01b299cb4b91fe75164b46b67",
            "lib/shipping-capture-gate.js": "4814386f9509f0efafe933fbefc1d1f8dbc6f627d4972931da6640ed87a6f355",
            "lib/shipping-profile.js": "48c4b51b5a8f303bf008e590eb9efea8534237b3d2a0af16f2459f39cf011ad2",
            "lib/store-inventory-commerce.js": "6b9f60067e0fce3543ae112b629e4606c471e775eb22857abf76bb725b4753a2",
            "lib/store-inventory-expiry.js": "64a43dd2e032850a397e265efdea8e6470cd21788a34b5f34091fb4af68509ca",
            "lib/store-inventory.js": "bfbd3f8b7f2784f289caadc2b36473e8867768ddfe2619acece80af3afceda1f",
            "migrations/0001_store_inventory.sql": "48e234930caea283fcffec0eb9d38ac5c86dc5a7251a2842dafebe91c1e8f02e",
            "tools/store-inventory.md": "de286c3ee652bf8cb26dbfcf9e20017977350dbefae697844f93948f4eb3376f",
            "tools/verify-store-inventory-export.mjs": "a3f622cc7760a4109834870f730107d85b6279403fc1e048654a7b6a346c1a9f",
            "workers/store-inventory-expiry.js": "2536dc6e0762c1278fc59e2971005de424e0491e2a771f78a84ca917a410cae7",
            "workers/wrangler.store-inventory-expiry.example.toml": "5c21a4cc3cbf1b59140907f2ebf5b4b2b681ef73effd24ac9733ce1bed433da5",
            "wrangler.toml": "05f6307930f7619d27690dffecb2e173b70126b2dfe6ffe0261758f00510f357",
        }
        records = {row["path"]: row["sha256"] for row in manifest_value()["files"]}
        self.assertEqual({path: records[path] for path in held}, held)

    def test_committed_build_control_substitution_and_additions_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            target = root / "docs/sw.js"
            target.write_bytes(target.read_bytes() + b"\n")
            git(root, "add", "docs/sw.js")
            git(
                root, "-c", "user.name=Storefront Freeze Test",
                "-c", "user.email=storefront-freeze@example.invalid",
                "commit", "-q", "-m", "service worker substitution",
            )
            self.assertRefused(lambda: freeze.verify_source(root), "exact current closure")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            (root / "docs/_headers").write_text("/api/*\n  cache-control: max-age=3600\n")
            git(root, "add", "docs/_headers")
            git(
                root, "-c", "user.name=Storefront Freeze Test",
                "-c", "user.email=storefront-freeze@example.invalid",
                "commit", "-q", "-m", "pages control addition",
            )
            self.assertRefused(lambda: freeze.render_manifest(root), "owned production closure")

    def test_root_auto_config_and_import_shadow_additions_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            (root / ".npmrc").write_text("ignore-scripts=false\n")
            git(root, "add", ".npmrc")
            git(
                root, "-c", "user.name=Storefront Freeze Test",
                "-c", "user.email=storefront-freeze@example.invalid",
                "commit", "-q", "-m", "root npm configuration",
            )
            self.assertRefused(lambda: freeze.render_manifest(root), "root entry closure")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            target = root / "unittest/__main__.py"
            target.parent.mkdir()
            target.write_text("raise SystemExit(0)\n")
            git(root, "add", "unittest/__main__.py")
            git(
                root, "-c", "user.name=Storefront Freeze Test",
                "-c", "user.email=storefront-freeze@example.invalid",
                "commit", "-q", "-m", "root import shadow package",
            )
            self.assertRefused(lambda: freeze.render_manifest(root), "root entry closure")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            (root / "functions/_middleware.js").write_text("export {};\n")
            git(root, "add", "functions/_middleware.js")
            git(
                root, "-c", "user.name=Storefront Freeze Test",
                "-c", "user.email=storefront-freeze@example.invalid",
                "commit", "-q", "-m", "middleware addition",
            )
            self.assertRefused(lambda: freeze.render_manifest(root), "owned production closure")

    def test_substitution_deletion_addition_and_empty_directory_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            target = root / "lib/store-inventory.js"
            target.write_bytes(target.read_bytes() + b"\n")
            self.assertRefused(lambda: freeze.verify_source(root), "exact current closure")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            (root / "functions/api/payment-intent.js").unlink()
            self.assertRefused(lambda: freeze.verify_source(root), "owned production closure")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            (root / "functions/api/extra.js").write_text("export {};\n")
            self.assertRefused(lambda: freeze.verify_source(root), "owned production closure")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            (root / "lib/undeclared-empty").mkdir()
            self.assertRefused(lambda: freeze.verify_source(root), "owned production closure")

    def test_symlink_hardlink_scope_weakening_and_path_escape_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            target = root / "lib/store-inventory.js"
            target.unlink()
            target.symlink_to("shipping-profile.js")
            self.assertRefused(lambda: freeze.verify_source(root), "symlink")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            base = Path(temporary)
            root = copy_candidate(base)
            target = root / "functions/api/payment-intent.js"
            held = base / "held.js"
            target.replace(held)
            os.link(held, target)
            self.assertRefused(lambda: freeze.verify_source(root), "singly linked")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            value = json.loads((root / freeze.SCOPE_RELATIVE).read_bytes())
            value["root_closures"] = value["root_closures"][:-1]
            (root / freeze.SCOPE_RELATIVE).write_bytes(freeze.canonical_json(value))
            self.assertRefused(lambda: freeze.render_manifest(root), "scope contract differs")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            value = manifest_value(root)
            value["files"][0]["path"] = "../escape"
            (root / freeze.MANIFEST_RELATIVE).write_bytes(freeze.canonical_json(value))
            self.assertRefused(lambda: freeze.verify_source(root))

    def test_provisional_sentinels_cannot_verify_or_capture(self) -> None:
        with mock.patch.object(freeze, "SCOPE_SHA256", "PENDING-COMMERCE-HELD"):
            self.assertRefused(lambda: freeze.render_manifest(ROOT), "pending")
        with mock.patch.object(freeze, "CAPTURE_ENABLED", False):
            self.assertRefused(lambda: freeze.capture_manifest(ROOT), "disabled")

    def test_publication_stays_under_the_held_parent_descriptor(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = Path(temporary) / "repo"
            (root / "publish").mkdir(parents=True)
            held_parent = root / "held-parent"
            original_write = os.write
            swapped = False

            def swap_then_write(descriptor: int, raw: bytes) -> int:
                nonlocal swapped
                if not swapped:
                    (root / "publish").rename(held_parent)
                    (root / "publish").mkdir()
                    swapped = True
                return original_write(descriptor, raw)

            with freeze.SourceCustody(root) as custody:
                with mock.patch.object(freeze.os, "write", side_effect=swap_then_write):
                    custody.create_once("publish/value.json", b"held\n")
            self.assertEqual((held_parent / "value.json").read_bytes(), b"held\n")
            self.assertFalse((root / "publish/value.json").exists())

    def test_root_ancestor_swap_cannot_redirect_reads_or_publication(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            base = Path(temporary)
            ancestor = base / "ancestor"
            root = ancestor / "repo"
            outside = base / "outside"
            (root / "publish").mkdir(parents=True)
            (outside / "repo/publish").mkdir(parents=True)
            (root / "value.txt").write_bytes(b"inside\n")
            (outside / "repo/value.txt").write_bytes(b"outside\n")
            renamed = base / "held-ancestor"
            original_open = os.open
            swapped = False

            def swap_after_open(path, flags, mode=0o777, *, dir_fd=None):
                nonlocal swapped
                if dir_fd is None:
                    descriptor = original_open(path, flags, mode)
                else:
                    descriptor = original_open(path, flags, mode, dir_fd=dir_fd)
                if path == "ancestor" and not swapped:
                    ancestor.rename(renamed)
                    ancestor.symlink_to(outside, target_is_directory=True)
                    swapped = True
                return descriptor

            with mock.patch.object(freeze.os, "open", side_effect=swap_after_open):
                with freeze.SourceCustody(root) as custody:
                    self.assertEqual(custody.read("value.txt"), b"inside\n")
                    custody.create_once("publish/new.json", b"inside-new\n")
            self.assertEqual(
                (renamed / "repo/publish/new.json").read_bytes(), b"inside-new\n",
            )
            self.assertFalse((outside / "repo/publish/new.json").exists())

    def test_release_mode_requires_clean_head_equal_unconcealed_source(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            head = make_clean_git(root)
            result = freeze.verify_release(root)
            self.assertTrue(result["release_ready"])
            self.assertEqual(result["git_head"], head)
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            (root / ".gitignore").write_text("functions/api/ignored.js\n")
            make_clean_git(root)
            (root / "functions/api/ignored.js").write_text("export {};\n")
            self.assertRefused(lambda: freeze.verify_release(root), "ignored")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            info_exclude = root / ".git/info/exclude"
            info_exclude.write_text(info_exclude.read_text() + "\nlib/local-only.js\n")
            (root / "lib/local-only.js").write_text("export {};\n")
            self.assertRefused(lambda: freeze.verify_release(root), "locally excluded")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            target = root / "lib/store-inventory.js"
            target.write_bytes(target.read_bytes() + b"\n")
            (root / freeze.MANIFEST_RELATIVE).write_bytes(freeze.render_manifest(root))
            git(
                root, "update-index", "--assume-unchanged", "--",
                "lib/store-inventory.js", freeze.MANIFEST_RELATIVE,
            )
            self.assertRefused(lambda: freeze.verify_release(root), "assume-unchanged")

    def test_release_rejects_forbidden_ignored_root_credentials(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            exclude = root / ".git/info/exclude"
            exclude.write_text(exclude.read_text() + "\n.dev.vars\n")
            (root / ".dev.vars").write_text("SECRET=not-real\n")
            self.assertEqual(
                git(root, "status", "--porcelain=v1", "--untracked-files=all").stdout,
                b"",
            )
            self.assertFalse(freeze.verify_source(root)["release_ready"])
            self.assertRefused(lambda: freeze.verify_release(root), "forbids local")

    def test_replace_objects_and_executable_mode_drift_cannot_conceal_source(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            accepted = make_clean_git(root)
            target = root / "lib/store-inventory.js"
            target.write_bytes(target.read_bytes() + b"\n")
            git(root, "add", "lib/store-inventory.js")
            git(
                root, "-c", "user.name=Storefront Freeze Test",
                "-c", "user.email=storefront-freeze@example.invalid",
                "commit", "-q", "-m", "replaced source commit",
            )
            replaced = git(root, "rev-parse", "HEAD").stdout.decode().strip()
            git(root, "checkout", accepted, "--", "lib/store-inventory.js")
            git(root, "replace", replaced, accepted)
            self.assertEqual(
                git(root, "status", "--porcelain=v1", "--untracked-files=all").stdout,
                b"",
            )
            self.assertRefused(lambda: freeze.verify_release(root), "completely clean")
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            git(root, "config", "core.fileMode", "false")
            target = root / "README.md"
            target.chmod(target.stat().st_mode | 0o111)
            self.assertEqual(
                git(root, "status", "--porcelain=v1", "--untracked-files=all").stdout,
                b"",
            )
            self.assertRefused(lambda: freeze.verify_source(root), "exact current closure")

    def test_committed_production_addition_cannot_be_recaptured_silently(self) -> None:
        with tempfile.TemporaryDirectory(dir="/private/tmp") as temporary:
            root = copy_candidate(Path(temporary))
            make_clean_git(root)
            (root / "lib/arbitrary-production.js").write_text("export {};\n")
            git(root, "add", "lib/arbitrary-production.js")
            git(
                root, "-c", "user.name=Storefront Freeze Test",
                "-c", "user.email=storefront-freeze@example.invalid",
                "commit", "-q", "-m", "arbitrary addition",
            )
            self.assertRefused(lambda: freeze.render_manifest(root), "owned production closure")


if __name__ == "__main__":
    unittest.main()

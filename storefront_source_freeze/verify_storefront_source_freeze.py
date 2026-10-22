#!/usr/bin/env python3
"""Fail-closed source inventory for the production storefront boundary."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
from typing import NoReturn


SCOPE_RELATIVE = "storefront_source_freeze/scope.v1.json"
MANIFEST_RELATIVE = "storefront_source_freeze/source-freeze.v1.json"
SCOPE_SHA256 = "3ec83383914718e43446dbf30e6872854a572800262c2e966e2e7c20fe5fc924"
CAPTURE_ENABLED = True
MAXIMUM_FILE_BYTES = 64 * 1024 * 1024
HEX64 = frozenset("0123456789abcdef")


class StorefrontFreezeError(RuntimeError):
    """The storefront source boundary is incomplete, mutable, or ambiguous."""


def refuse(message: str) -> NoReturn:
    raise StorefrontFreezeError(f"storefront source freeze refusal: {message}")


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ).encode("ascii") + b"\n"


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            refuse(f"canonical JSON repeats object key {key!r}")
        result[key] = value
    return result


def strict_json_bytes(raw: bytes, label: str) -> object:
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_unique_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        refuse(f"{label} is not strict ASCII JSON: {error}")
    if raw != canonical_json(value):
        refuse(f"{label} is not canonical JSON with one final LF")
    return value


def exact_keys(value: object, keys: set[str], label: str) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != keys:
        refuse(f"{label} object shape is invalid")
    return value


def canonical_relative(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        refuse(f"{label} path is invalid")
    pure = PurePosixPath(value)
    if (
        pure.is_absolute()
        or pure.as_posix() != value
        or any(part in {"", ".", ".."} for part in pure.parts)
    ):
        refuse(f"{label} path is not canonical relative POSIX text")
    return value


def _string_list(value: object, label: str) -> list[str]:
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(item, str) or not item for item in value)
        or value != sorted(set(value))
    ):
        refuse(f"{label} must be a nonempty, unique, sorted string list")
    return value


def _identity(info: os.stat_result) -> tuple[int, ...]:
    return (
        info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
        info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns,
    )


class SourceCustody:
    """Hold a repository and use component-wise no-follow descriptor custody."""

    def __init__(self, root: Path):
        text = os.fspath(root)
        if not os.path.isabs(text) or os.path.normpath(text) != text:
            refuse("repository root must be an absolute normalized path")
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        try:
            descriptor = os.open(root.anchor, flags)
            for component in root.parts[1:]:
                next_descriptor = os.open(component, flags, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = next_descriptor
                if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
                    refuse(f"repository ancestor is not a directory: {component}")
            self._root_fd = descriptor
        except OSError as error:
            if "descriptor" in locals():
                os.close(descriptor)
            refuse(f"repository root cannot be held safely: {error}")
        self.root = root

    def close(self) -> None:
        if self._root_fd >= 0:
            os.close(self._root_fd)
            self._root_fd = -1

    def __enter__(self) -> "SourceCustody":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def _open_directory(self, relative: str) -> int:
        parts = PurePosixPath(relative).parts if relative else ()
        descriptor = os.dup(self._root_fd)
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        try:
            for part in parts:
                next_descriptor = os.open(part, flags, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = next_descriptor
                if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
                    refuse(f"source ancestor is not a directory: {relative}")
            return descriptor
        except OSError as error:
            os.close(descriptor)
            refuse(
                f"source ancestor cannot be opened without following links: "
                f"{relative}: {error}"
            )

    def read_with_mode(
        self, relative: str, maximum: int = MAXIMUM_FILE_BYTES,
    ) -> tuple[bytes, str]:
        relative = canonical_relative(relative, "source member")
        pure = PurePosixPath(relative)
        parent = pure.parent.as_posix()
        directory = self._open_directory("" if parent == "." else parent)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        flags |= getattr(os, "O_CLOEXEC", 0)
        try:
            descriptor = os.open(pure.name, flags, dir_fd=directory)
        except OSError as error:
            os.close(directory)
            refuse(
                f"source member cannot be opened without following links: "
                f"{relative}: {error}"
            )
        os.close(directory)
        try:
            before = os.fstat(descriptor)
            if (
                not stat.S_ISREG(before.st_mode)
                or before.st_nlink != 1
                or before.st_size < 0
                or before.st_size > maximum
            ):
                refuse(
                    f"source member is not one bounded singly linked regular file: "
                    f"{relative}"
                )
            chunks: list[bytes] = []
            offset = 0
            while offset < before.st_size:
                chunk = os.pread(descriptor, min(65536, before.st_size - offset), offset)
                if not chunk:
                    refuse(f"source member was truncated while held: {relative}")
                chunks.append(chunk)
                offset += len(chunk)
            if _identity(before) != _identity(os.fstat(descriptor)):
                refuse(f"source member changed while held: {relative}")
            mode = "100755" if before.st_mode & 0o111 else "100644"
            return b"".join(chunks), mode
        finally:
            os.close(descriptor)

    def read(self, relative: str, maximum: int = MAXIMUM_FILE_BYTES) -> bytes:
        return self.read_with_mode(relative, maximum)[0]

    def walk(
        self,
        relative: str,
        *,
        excluded_directories: frozenset[str],
        excluded_files: frozenset[str],
    ) -> tuple[set[str], set[str]]:
        relative = canonical_relative(relative, "closure root")
        files: set[str] = set()
        directories: set[str] = set()

        def visit(path: str) -> None:
            descriptor = self._open_directory(path)
            directories.add(path)
            try:
                names = sorted(os.listdir(descriptor))
                for name in names:
                    if name in {"", ".", ".."} or "/" in name or "\\" in name:
                        refuse(f"closure contains a noncanonical name under {path}")
                    child = f"{path}/{name}"
                    try:
                        info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                    except OSError as error:
                        refuse(f"closure member disappeared: {child}: {error}")
                    if stat.S_ISLNK(info.st_mode):
                        refuse(f"closure contains a symlink: {child}")
                    if stat.S_ISDIR(info.st_mode):
                        if name in excluded_directories:
                            continue
                        visit(child)
                    elif stat.S_ISREG(info.st_mode):
                        if name in excluded_files:
                            continue
                        files.add(child)
                    else:
                        refuse(f"closure contains a special filesystem object: {child}")
            finally:
                os.close(descriptor)

        visit(relative)
        return files, directories

    def root_entries(
        self,
        *,
        excluded_files: set[str],
        excluded_directories: set[str],
    ) -> tuple[set[str], set[str]]:
        descriptor = os.dup(self._root_fd)
        files: set[str] = set()
        directories: set[str] = set()
        try:
            for name in sorted(os.listdir(descriptor)):
                info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                if name in excluded_files:
                    if not stat.S_ISREG(info.st_mode):
                        refuse(f"excluded repository-root file has the wrong type: {name}")
                    continue
                if name in excluded_directories:
                    if not stat.S_ISDIR(info.st_mode):
                        refuse(f"excluded repository-root directory has the wrong type: {name}")
                    continue
                if stat.S_ISDIR(info.st_mode):
                    directories.add(name)
                    continue
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                    refuse(f"repository root contains a linked or special entry: {name}")
                files.add(name)
        finally:
            os.close(descriptor)
        return files, directories

    def create_once(self, relative: str, raw: bytes, mode: int = 0o644) -> None:
        """Publish to one held parent, without resolving any path component twice."""
        relative = canonical_relative(relative, "publication target")
        pure = PurePosixPath(relative)
        parent = pure.parent.as_posix()
        directory = self._open_directory("" if parent == "." else parent)
        flags = os.O_RDWR | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        try:
            descriptor = os.open(pure.name, flags, mode, dir_fd=directory)
        except OSError as error:
            os.close(directory)
            refuse(f"publication target must not already exist: {relative}: {error}")
        try:
            offset = 0
            while offset < len(raw):
                written = os.write(descriptor, raw[offset:])
                if written <= 0:
                    refuse(f"publication write did not make progress: {relative}")
                offset += written
            os.fchmod(descriptor, mode)
            os.fsync(descriptor)
            info = os.fstat(descriptor)
            named = os.stat(pure.name, dir_fd=directory, follow_symlinks=False)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != mode
                or info.st_size != len(raw)
                or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)
                or os.pread(descriptor, len(raw), 0) != raw
            ):
                refuse(f"publication custody is invalid: {relative}")
            os.fsync(directory)
        finally:
            os.close(descriptor)
            os.close(directory)


def load_scope(custody: SourceCustody) -> tuple[dict[str, object], bytes]:
    if len(SCOPE_SHA256) != 64 or any(c not in HEX64 for c in SCOPE_SHA256):
        refuse("storefront scope is pending final commerce-held bytes")
    raw = custody.read(SCOPE_RELATIVE, 1024 * 1024)
    if sha256_bytes(raw) != SCOPE_SHA256:
        refuse("checked-in scope contract differs from the verifier pin")
    scope = exact_keys(strict_json_bytes(raw, "scope contract"), {
        "schema_version", "kind", "tool_root", "root_closures",
        "root_entry_closure",
        "excluded", "release_forbidden_local_paths",
        "release_ignored_scan_paths",
    }, "scope contract")
    if (
        scope["schema_version"] != 1
        or scope["kind"] != "avian-storefront-source-scope-v1"
        or scope["tool_root"] != "storefront_source_freeze"
    ):
        refuse("scope contract identity is invalid")
    for key in (
        "release_forbidden_local_paths",
        "release_ignored_scan_paths",
    ):
        values = _string_list(scope[key], f"scope {key}")
        for index, value in enumerate(values):
            canonical_relative(value, f"scope {key} row {index}")
    roots = scope["root_closures"]
    if not isinstance(roots, list) or not roots:
        refuse("scope root closures are invalid")
    prior = ""
    root_paths: set[str] = set()
    for index, raw_spec in enumerate(roots):
        spec = exact_keys(raw_spec, {
            "path", "file_count", "directory_count", "names_sha256",
        }, f"scope root closure {index}")
        path = canonical_relative(spec["path"], f"scope root closure {index}")
        if path <= prior or path in root_paths:
            refuse("scope root closures are not uniquely path-sorted")
        prior = path
        root_paths.add(path)
        if (
            type(spec["file_count"]) is not int
            or spec["file_count"] < 1
            or type(spec["directory_count"]) is not int
            or spec["directory_count"] < 1
            or not isinstance(spec["names_sha256"], str)
            or len(spec["names_sha256"]) != 64
            or any(character not in HEX64 for character in spec["names_sha256"])
        ):
            refuse(f"scope root closure metadata is invalid: {path}")
    if scope["tool_root"] not in root_paths:
        refuse("scope tool root is not an owned closure root")
    root_entries = exact_keys(scope["root_entry_closure"], {
        "directory_names", "excluded_directory_names", "excluded_file_names",
        "file_names",
    }, "scope root entry closure")
    for key in root_entries:
        _string_list(root_entries[key], f"scope root entry closure {key}")
    if (
        set(root_entries["directory_names"]) != root_paths
        or set(root_entries["directory_names"]) &
            set(root_entries["excluded_directory_names"])
        or set(root_entries["file_names"]) & set(root_entries["excluded_file_names"])
    ):
        refuse("scope root entry closure is contradictory or incomplete")
    excluded = exact_keys(
        scope["excluded"], {"directory_names", "file_names"}, "scope exclusions",
    )
    for key in ("directory_names", "file_names"):
        _string_list(excluded[key], f"scope exclusions {key}")
    if not set(scope["release_forbidden_local_paths"]).issubset(
        set(root_entries["excluded_file_names"])
    ):
        refuse("release-forbidden local files are not explicit root exclusions")
    required_tool_files = {
        SCOPE_RELATIVE,
        "storefront_source_freeze/README.md",
        "storefront_source_freeze/test_storefront_source_freeze.py",
        "storefront_source_freeze/verify_storefront_source_freeze.py",
    }
    for path in required_tool_files:
        custody.read(path)
    return scope, raw


def selected_inventory(
    custody: SourceCustody, scope: dict[str, object], scope_raw: bytes,
) -> tuple[list[dict[str, object]], list[str]]:
    excluded = scope["excluded"]
    root_entry_scope = scope["root_entry_closure"]
    top_level_files, top_level_directories = custody.root_entries(
        excluded_files=set(root_entry_scope["excluded_file_names"]),
        excluded_directories=set(root_entry_scope["excluded_directory_names"]),
    )
    if (
        sorted(top_level_files) != root_entry_scope["file_names"]
        or sorted(top_level_directories) != root_entry_scope["directory_names"]
    ):
        refuse("repository root entry closure differs from fixed scope")
    files: set[str] = set(top_level_files)
    directories: set[str] = set()
    for spec in scope["root_closures"]:
        closure_files, closure_directories = custody.walk(
            spec["path"],
            excluded_directories=frozenset(excluded["directory_names"]),
            excluded_files=frozenset(excluded["file_names"]),
        )
        closure_files.discard(MANIFEST_RELATIVE)
        names = {
            "directories": sorted(closure_directories),
            "files": sorted(closure_files),
        }
        if (
            len(closure_files) != spec["file_count"]
            or len(closure_directories) != spec["directory_count"]
            or sha256_bytes(canonical_json(names)) != spec["names_sha256"]
        ):
            refuse(f"owned production closure differs from fixed scope: {spec['path']}")
        files.update(closure_files)
        directories.update(closure_directories)
    if MANIFEST_RELATIVE in files:
        refuse("storefront manifest cannot inventory itself")
    if len(files) != len(top_level_files) + sum(
        spec["file_count"] for spec in scope["root_closures"]
    ):
        refuse(
            "fixed files overlap owned production roots or root closures overlap"
        )
    records: list[dict[str, object]] = []
    for path in sorted(files):
        raw, mode = custody.read_with_mode(path)
        if path == SCOPE_RELATIVE and raw != scope_raw:
            refuse("scope contract changed while the inventory was held")
        records.append({
            "bytes": len(raw), "mode": mode, "path": path,
            "sha256": sha256_bytes(raw),
        })
    return records, sorted(directories)


def render_manifest(repo_root: Path) -> bytes:
    root = Path(os.path.abspath(repo_root))
    with SourceCustody(root) as custody:
        scope, scope_raw = load_scope(custody)
        files, directories = selected_inventory(custody, scope, scope_raw)
    closure = {"directories": directories, "files": files}
    return canonical_json({
        "directory_count": len(directories),
        "directories": directories,
        "file_count": len(files),
        "files": files,
        "kind": "avian-storefront-source-freeze-v1",
        "schema_version": 1,
        "scope_path": SCOPE_RELATIVE,
        "scope_sha256": sha256_bytes(scope_raw),
        "tree_sha256": sha256_bytes(canonical_json(closure)),
    })


def verify_source(repo_root: Path) -> dict[str, object]:
    root = Path(os.path.abspath(repo_root))
    with SourceCustody(root) as custody:
        raw, mode = custody.read_with_mode(MANIFEST_RELATIVE, 16 * 1024 * 1024)
    if mode != "100644":
        refuse("storefront source manifest mode is not 100644")
    value = exact_keys(strict_json_bytes(raw, "storefront source manifest"), {
        "schema_version", "kind", "scope_path", "scope_sha256", "file_count",
        "directory_count", "files", "directories", "tree_sha256",
    }, "storefront source manifest")
    if (
        value["schema_version"] != 1
        or value["kind"] != "avian-storefront-source-freeze-v1"
        or value["scope_path"] != SCOPE_RELATIVE
        or value["scope_sha256"] != SCOPE_SHA256
    ):
        refuse("storefront source manifest identity or scope binding is invalid")
    if raw != render_manifest(root):
        refuse("storefront source manifest differs from the exact current closure")
    return {
        "directory_count": value["directory_count"],
        "file_count": value["file_count"],
        "manifest_sha256": sha256_bytes(raw),
        "release_ready": False,
        "scope_sha256": value["scope_sha256"],
        "tree_sha256": value["tree_sha256"],
    }


def capture_manifest(repo_root: Path) -> dict[str, object]:
    if not CAPTURE_ENABLED:
        refuse("capture is disabled pending final commerce-held bytes")
    root = Path(os.path.abspath(repo_root))
    raw = render_manifest(root)
    with SourceCustody(root) as custody:
        custody.create_once(MANIFEST_RELATIVE, raw)
    return verify_source(root)


def _git(
    root: Path, arguments: list[str], *, check: bool = True,
) -> subprocess.CompletedProcess[bytes]:
    environment = {
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "LANG": "C",
        "LC_ALL": "C",
        "PATH": "/usr/bin:/bin",
    }
    result = subprocess.run(
        ["/usr/bin/git", *arguments], cwd=root, env=environment,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        check=False,
    )
    if check and result.returncode != 0:
        refuse(
            f"Git command failed: git {' '.join(arguments)}: "
            f"{result.stderr.decode('utf-8', 'replace').strip()}"
        )
    return result


def _git_clean_state(root: Path, scope: dict[str, object]) -> str:
    top = _git(root, ["rev-parse", "--show-toplevel"]).stdout.decode().strip()
    if Path(top) != root:
        refuse("release verification requires the exact storefront Git root")
    head = _git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout.decode().strip()
    if len(head) not in {40, 64} or any(character not in HEX64 for character in head):
        refuse("release verification could not bind a canonical HEAD commit")
    status = _git(root, [
        "status", "--porcelain=v1", "-z", "--untracked-files=all",
        "--ignore-submodules=none",
    ]).stdout
    if status:
        refuse("release verification requires a completely clean tracked and untracked worktree")
    for path in scope["release_forbidden_local_paths"]:
        try:
            info = os.stat(root / path, follow_symlinks=False)
        except FileNotFoundError:
            continue
        except OSError as error:
            refuse(f"release-local path cannot be inspected: {path}: {error}")
        if info:
            refuse(f"release verification forbids local production path: {path}")
    ignored = _git(root, [
        "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--",
        *scope["release_ignored_scan_paths"],
    ]).stdout
    if ignored:
        excluded_directories = set(scope["excluded"]["directory_names"])
        excluded_files = set(scope["excluded"]["file_names"])
        names = []
        for item in ignored.split(b"\0"):
            if not item:
                continue
            name = item.decode("utf-8", "replace")
            parts = PurePosixPath(name).parts
            if PurePosixPath(name).name in excluded_files or any(
                part in excluded_directories for part in parts
            ):
                continue
            names.append(name)
    else:
        names = []
    if names:
        refuse(f"release source has ignored or locally excluded production paths: {names}")
    for arguments in (["diff", "--quiet"], ["diff", "--cached", "--quiet"]):
        if _git(root, arguments, check=False).returncode != 0:
            refuse("release verification found index or worktree divergence")
    return head


def _manifest_modes(root: Path) -> dict[str, str]:
    with SourceCustody(root) as custody:
        raw = custody.read(MANIFEST_RELATIVE, 16 * 1024 * 1024)
    value = strict_json_bytes(raw, "storefront source manifest")
    if not isinstance(value, dict) or not isinstance(value.get("files"), list):
        refuse("storefront source manifest file inventory is invalid")
    modes: dict[str, str] = {}
    for index, row in enumerate(value["files"]):
        item = exact_keys(
            row, {"path", "bytes", "mode", "sha256"}, f"manifest row {index}",
        )
        path = canonical_relative(item["path"], f"manifest row {index}")
        if item["mode"] not in {"100644", "100755"} or path in modes:
            refuse(f"manifest row mode or path is invalid: {path}")
        modes[path] = item["mode"]
    if list(modes) != sorted(modes):
        refuse("release inventory paths are not unique and sorted")
    modes[MANIFEST_RELATIVE] = "100644"
    return dict(sorted(modes.items()))


def _require_head_equal(
    root: Path, manifest_modes: dict[str, str], scope: dict[str, object],
) -> None:
    paths = sorted(manifest_modes)
    stage = _git(root, ["ls-files", "--stage", "-z", "--", *paths]).stdout
    index: dict[str, tuple[str, str]] = {}
    for row in stage.split(b"\0"):
        if not row:
            continue
        try:
            metadata, raw_path = row.split(b"\t", 1)
            mode, oid, stage_number = metadata.decode("ascii").split(" ")
            path = raw_path.decode("utf-8", "strict")
        except (ValueError, UnicodeDecodeError):
            refuse("Git index inventory is malformed")
        if stage_number != "0" or mode not in {"100644", "100755"} or path in index:
            refuse(f"release source index entry is not one regular stage-zero file: {path}")
        index[path] = (mode, oid)
    if set(index) != set(paths):
        refuse("release source inventory is not fully tracked in the Git index")
    flags = _git(root, ["ls-files", "-v", "-z", "--", *paths]).stdout
    flag_map: dict[str, str] = {}
    for row in flags.split(b"\0"):
        if not row:
            continue
        try:
            prefix = row[:1].decode("ascii")
            path = row[2:].decode("utf-8", "strict")
        except UnicodeDecodeError:
            refuse("Git file-flag inventory is malformed")
        flag_map[path] = prefix
    if set(flag_map) != set(paths) or any(value != "H" for value in flag_map.values()):
        refuse("release source uses assume-unchanged, skip-worktree, or noncanonical index state")
    tree = _git(root, ["ls-tree", "-r", "-z", "HEAD", "--", *paths]).stdout
    head: dict[str, tuple[str, str]] = {}
    for row in tree.split(b"\0"):
        if not row:
            continue
        try:
            metadata, raw_path = row.split(b"\t", 1)
            mode, kind, oid = metadata.decode("ascii").split(" ")
            path = raw_path.decode("utf-8", "strict")
        except (ValueError, UnicodeDecodeError):
            refuse("Git HEAD inventory is malformed")
        if kind != "blob" or mode not in {"100644", "100755"} or path in head:
            refuse(f"release source HEAD entry is not one regular file: {path}")
        head[path] = (mode, oid)
    if head != index:
        refuse("release source index does not exactly equal current HEAD")
    if any(index[path][0] != manifest_modes[path] for path in paths):
        refuse("release source executable modes differ from the manifest")
    owned_roots = [spec["path"] for spec in scope["root_closures"]]
    expected_production = {
        path for path in paths
        if any(path == root_path or path.startswith(root_path + "/")
               for root_path in owned_roots)
    }
    tracked = _git(root, [
        "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", *owned_roots,
    ]).stdout
    tracked_production = {
        item.decode("utf-8", "strict") for item in tracked.split(b"\0") if item
    }
    if tracked_production != expected_production:
        refuse("current HEAD has undeclared or missing production source paths")
    with SourceCustody(root) as custody:
        for path in paths:
            blob = _git(root, ["cat-file", "blob", head[path][1]]).stdout
            raw, mode = custody.read_with_mode(path)
            if raw != blob or mode != manifest_modes[path]:
                refuse(f"release source bytes or mode differ from current HEAD: {path}")


def verify_release(repo_root: Path) -> dict[str, object]:
    root = Path(os.path.abspath(repo_root))
    with SourceCustody(root) as custody:
        scope, _scope_raw = load_scope(custody)
    head_before = _git_clean_state(root, scope)
    first = verify_source(root)
    _require_head_equal(root, _manifest_modes(root), scope)
    second = verify_source(root)
    head_after = _git_clean_state(root, scope)
    if first != second or head_before != head_after:
        refuse("source or Git state changed during release verification")
    return {**first, "git_head": head_after, "release_ready": True}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Verify the fixed storefront source scope")
    parser.add_argument(
        "command", choices=("capture", "render", "verify", "verify-release"),
    )
    parser.add_argument("--repo-root", required=True, type=Path)
    arguments = parser.parse_args(argv)
    if arguments.command == "render":
        sys.stdout.buffer.write(render_manifest(arguments.repo_root))
        return
    if arguments.command == "capture":
        result = capture_manifest(arguments.repo_root)
    elif arguments.command == "verify-release":
        result = verify_release(arguments.repo_root)
    else:
        result = verify_source(arguments.repo_root)
    print(canonical_json(result).decode("ascii"), end="")


if __name__ == "__main__":
    main()

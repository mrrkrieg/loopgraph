"""Native Hermes Agent packaging for Loopgraph.

Registration is fast, offline, and side-effect free. The full Loopgraph
runtime is fetched at the exact Git revision recorded by Hermes only after an
explicit ``hermes loopgraph install --yes`` command. Every delegated command
is an argv list; no shell is involved.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Any, Sequence


PLUGIN_VERSION = "0.2.0"
PLUGIN_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_CONTRACT_PATH = PLUGIN_ROOT / "runtime-lock.json"
RUNTIME_ROOT = PLUGIN_ROOT / ".runtime"
RUNTIME_RECEIPT = RUNTIME_ROOT / ".loopgraph-plugin-runtime.json"
LOOPGRAPH_CLI = RUNTIME_ROOT / "packages" / "loopgraph" / "dist" / "cli.js"
DESIGN_SKILL = PLUGIN_ROOT / "skills" / "design" / "SKILL.md"
EVENT_ROUTER_SKILL = PLUGIN_ROOT / "skills" / "event-router" / "SKILL.md"
INSTALL_METADATA = PLUGIN_ROOT.parent / ".install-metadata.json"
REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")

_START_PHRASES = {
    "start loopgraph",
    "set up loopgraph",
    "setup loopgraph",
    "configure loopgraph",
}


class LoopgraphPluginError(RuntimeError):
    """A safe, user-actionable plugin command failure."""


def _normalized_start_request(message: object) -> bool:
    if not isinstance(message, str):
        return False
    normalized = " ".join(message.strip().lower().split()).rstrip(".!?")
    return normalized in _START_PHRASES


def _inject_start_context(user_message: str = "", **_: Any) -> dict[str, str] | None:
    """Enter onboarding only for an exact user request, never payload text."""

    if not _normalized_start_request(user_message):
        return None
    return {
        "context": (
            "The user explicitly requested Loopgraph onboarding. Load the read-only "
            "plugin skill `loopgraph:design` with skill_view before acting. Inspect the "
            "Loopgraph workspace through its admin MCP tools, present departments when "
            "the workspace is empty, ask only unresolved questions, and keep every new "
            "loop in shadow mode. If the Loopgraph MCP tools are unavailable, do not "
            "improvise an installation: tell the user to run `hermes loopgraph install "
            "--project <company-project> --yes` and then restart Hermes."
        )
    }


def _require_executable(name: str) -> str:
    executable = shutil.which(name)
    if executable:
        return executable
    raise LoopgraphPluginError(
        f"Required executable `{name}` was not found on PATH. Install it, restart the "
        "terminal, and retry. Loopgraph requires Git plus Node.js 22+ and npm."
    )


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LoopgraphPluginError(f"{label} is unreadable: {exc}") from exc
    if not isinstance(value, dict):
        raise LoopgraphPluginError(f"{label} must contain a JSON object.")
    return value


def _runtime_contract() -> dict[str, str]:
    value = _read_json(RUNTIME_CONTRACT_PATH, "The plugin runtime lock")
    required = {
        "schemaVersion": "loopgraph-hermes-plugin-runtime/v1alpha1",
        "pluginVersion": PLUGIN_VERSION,
        "packageVersion": PLUGIN_VERSION,
        "sourceRevisionPolicy": "hermes-install-revision",
    }
    for key, expected in required.items():
        if value.get(key) != expected:
            raise LoopgraphPluginError(
                f"The plugin runtime lock has an incompatible `{key}` value. "
                "Update or reinstall the Loopgraph plugin."
            )
    repository = value.get("repository")
    lock_digest = value.get("packageLockSha256")
    if repository != "https://github.com/mrrkrieg/loopgraph.git":
        raise LoopgraphPluginError("The plugin runtime repository is not the trusted Loopgraph origin.")
    if not isinstance(lock_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", lock_digest):
        raise LoopgraphPluginError("The plugin package-lock digest is invalid.")
    return {
        "repository": repository,
        "packageVersion": PLUGIN_VERSION,
        "packageLockSha256": lock_digest,
    }


def _valid_revision(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    revision = value.strip().lower()
    return revision if REVISION_PATTERN.fullmatch(revision) else None


def _installed_revision() -> str | None:
    """Read the exact revision Hermes recorded for this plugin installation."""

    if not INSTALL_METADATA.is_file():
        return None
    metadata = _read_json(INSTALL_METADATA, "Hermes plugin install metadata")
    entry = metadata.get("loopgraph")
    if not isinstance(entry, dict):
        return None
    source = entry.get("source")
    if not isinstance(source, str) or not source.endswith("#integrations/hermes-plugin"):
        raise LoopgraphPluginError(
            "Hermes install metadata does not bind Loopgraph to the expected plugin subdirectory."
        )
    return _valid_revision(entry.get("revision"))


def _source_checkout_revision() -> str | None:
    """Allow contributor validation from a normal repository checkout."""

    git = shutil.which("git")
    if not git:
        return None
    completed = subprocess.run(
        [git, "-C", str(PLUGIN_ROOT), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    return _valid_revision(completed.stdout) if completed.returncode == 0 else None


def _source_revision(requested: str | None) -> str:
    explicit = _valid_revision(requested)
    if requested and not explicit:
        raise LoopgraphPluginError("`--ref` must be one full 40-character Git commit SHA.")
    revision = explicit or _installed_revision() or _source_checkout_revision()
    if revision:
        return revision
    raise LoopgraphPluginError(
        "The exact source revision is unavailable. Reinstall with Hermes or pass "
        "`--ref <40-character-commit-sha>`. Mutable branches and tags are not accepted."
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run(
    argv: Sequence[str],
    *,
    cwd: Path = PLUGIN_ROOT,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run one exact argv vector without a shell."""

    return subprocess.run(
        list(argv),
        cwd=str(cwd),
        stdin=None,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def _run_required(argv: Sequence[str], *, cwd: Path, label: str) -> None:
    completed = _run(argv, cwd=cwd)
    if completed.returncode != 0:
        raise LoopgraphPluginError(f"{label} failed with exit code {completed.returncode}.")


def _current_runtime_receipt() -> dict[str, Any] | None:
    if not LOOPGRAPH_CLI.is_file() or not RUNTIME_RECEIPT.is_file():
        return None
    try:
        value = json.loads(RUNTIME_RECEIPT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _runtime_is_current(contract: dict[str, str], revision: str) -> bool:
    receipt = _current_runtime_receipt()
    return bool(
        receipt
        and receipt.get("schemaVersion") == "loopgraph-hermes-plugin-runtime-receipt/v1alpha1"
        and receipt.get("sourceRevision") == revision
        and receipt.get("packageLockSha256") == contract["packageLockSha256"]
        and receipt.get("packageVersion") == contract["packageVersion"]
    )


def _validate_fetched_runtime(candidate: Path, contract: dict[str, str], revision: str) -> None:
    package_json = candidate / "package.json"
    package_lock = candidate / "package-lock.json"
    if not package_json.is_file() or not package_lock.is_file():
        raise LoopgraphPluginError("The fetched revision does not contain the Loopgraph package runtime.")
    package = _read_json(package_json, "Fetched Loopgraph package metadata")
    if package.get("name") != "loopgraph" or package.get("version") != contract["packageVersion"]:
        raise LoopgraphPluginError("The fetched package version does not match the plugin runtime lock.")
    actual_lock = _sha256(package_lock)
    if actual_lock != contract["packageLockSha256"]:
        raise LoopgraphPluginError(
            "The fetched package-lock digest does not match the plugin runtime lock. "
            "No dependencies were installed."
        )
    git = _require_executable("git")
    completed = _run([git, "rev-parse", "HEAD"], cwd=candidate, capture=True)
    if completed.returncode != 0 or _valid_revision(completed.stdout) != revision:
        raise LoopgraphPluginError("The fetched runtime revision does not match the Hermes install revision.")


def _write_runtime_receipt(candidate: Path, contract: dict[str, str], revision: str) -> None:
    receipt = {
        "schemaVersion": "loopgraph-hermes-plugin-runtime-receipt/v1alpha1",
        "sourceRevision": revision,
        "packageVersion": contract["packageVersion"],
        "packageLockSha256": contract["packageLockSha256"],
    }
    target = candidate / ".loopgraph-plugin-runtime.json"
    temporary = candidate / ".loopgraph-plugin-runtime.json.tmp"
    temporary.write_text(f"{json.dumps(receipt, indent=2)}\n", encoding="utf-8")
    os.replace(temporary, target)


def _replace_runtime(candidate: Path) -> None:
    backup = PLUGIN_ROOT / ".runtime.previous"
    if backup.exists():
        shutil.rmtree(backup)
    replaced = RUNTIME_ROOT.exists()
    if replaced:
        os.replace(RUNTIME_ROOT, backup)
    try:
        os.replace(candidate, RUNTIME_ROOT)
    except Exception:
        if replaced and backup.exists() and not RUNTIME_ROOT.exists():
            os.replace(backup, RUNTIME_ROOT)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def _bootstrap_runtime(*, confirmed: bool, requested_revision: str | None) -> str:
    contract = _runtime_contract()
    revision = _source_revision(requested_revision)
    if _runtime_is_current(contract, revision):
        return revision
    if not confirmed:
        raise LoopgraphPluginError(
            "The locked Loopgraph runtime is not ready. Review the plugin, then rerun with "
            "`--yes`. The adapter will fetch only commit "
            f"{revision}, require package-lock sha256 {contract['packageLockSha256']}, run "
            "`npm ci --ignore-scripts`, build the Loopgraph package, and require a clean "
            "production dependency audit."
        )

    git = _require_executable("git")
    npm = _require_executable("npm")
    staging_parent = Path(tempfile.mkdtemp(prefix=".runtime-stage-", dir=PLUGIN_ROOT))
    candidate = staging_parent / "runtime"
    try:
        candidate.mkdir(mode=0o700)
        _run_required([git, "init"], cwd=candidate, label="Runtime repository initialization")
        _run_required(
            [git, "remote", "add", "origin", contract["repository"]],
            cwd=candidate,
            label="Trusted runtime origin registration",
        )
        _run_required(
            [git, "fetch", "--depth", "1", "origin", revision],
            cwd=candidate,
            label="Pinned runtime fetch",
        )
        _run_required(
            [git, "checkout", "--detach", "FETCH_HEAD"],
            cwd=candidate,
            label="Pinned runtime checkout",
        )
        _validate_fetched_runtime(candidate, contract, revision)
        print(
            "Bootstrapping Loopgraph from exact commit "
            f"{revision[:12]} and lock {contract['packageLockSha256'][:16]}…."
        )
        _run_required(
            [npm, "ci", "--ignore-scripts"],
            cwd=candidate,
            label="Locked dependency installation",
        )
        _run_required(
            [npm, "run", "build:package"],
            cwd=candidate,
            label="Loopgraph package build",
        )
        _run_required(
            [npm, "audit", "--omit=dev"],
            cwd=candidate,
            label="Production dependency audit",
        )
        if not (candidate / "packages" / "loopgraph" / "dist" / "cli.js").is_file():
            raise LoopgraphPluginError("The package build did not produce the Loopgraph CLI.")
        _write_runtime_receipt(candidate, contract, revision)
        _replace_runtime(candidate)
    finally:
        if staging_parent.exists():
            shutil.rmtree(staging_parent)
    return revision


def _project_path(value: str) -> Path:
    project = Path(value).expanduser().resolve()
    if not project.is_dir():
        raise LoopgraphPluginError(f"Project root does not exist or is not a directory: {project}")
    return project


def _install_plan(project: Path, requested_revision: str | None) -> dict[str, Any]:
    contract = _runtime_contract()
    revision = _source_revision(requested_revision)
    return {
        "schemaVersion": "loopgraph-hermes-plugin-install-plan/v1alpha1",
        "pluginVersion": PLUGIN_VERSION,
        "sourceRepository": contract["repository"],
        "sourceRevision": revision,
        "packageLockSha256": contract["packageLockSha256"],
        "runtimeCurrent": _runtime_is_current(contract, revision),
        "projectRoot": str(project),
        "commands": [
            "git fetch --depth 1 origin <exact-source-revision>",
            "git checkout --detach FETCH_HEAD",
            "npm ci --ignore-scripts",
            "npm run build:package",
            "npm audit --omit=dev",
            "loopgraph setup --project <project> --activate",
        ],
        "writes": [
            "plugin-owned .runtime directory",
            "project-owned .loopgraph directory",
            "Hermes MCP and skill configuration after activation",
        ],
        "credentialsAccepted": False,
    }


def _handle_plan(args: argparse.Namespace) -> None:
    project = _project_path(args.project)
    print(json.dumps(_install_plan(project, args.ref), indent=2))


def _delegate(arguments: Sequence[str]) -> None:
    node = _require_executable("node")
    if not LOOPGRAPH_CLI.is_file():
        raise LoopgraphPluginError(
            "The Loopgraph runtime is not ready. Run `hermes loopgraph install "
            "--project <company-project> --yes` first."
        )
    completed = _run([node, str(LOOPGRAPH_CLI), *arguments], cwd=RUNTIME_ROOT)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def _handle_install(args: argparse.Namespace) -> None:
    project = _project_path(args.project)
    if not args.yes:
        print(json.dumps(_install_plan(project, args.ref), indent=2))
        raise LoopgraphPluginError(
            "No changes were made. Review the plan, then rerun the install command with `--yes`."
        )
    _bootstrap_runtime(confirmed=bool(args.yes), requested_revision=args.ref)
    command = ["setup", "--project", str(project)]
    if not args.no_activate:
        command.append("--activate")
    if args.json:
        command.append("--json")
    _delegate(command)


def _handle_doctor(args: argparse.Namespace) -> None:
    project = _project_path(args.project)
    _delegate(["hermes", "doctor", "--project", str(project)])


def _handle_disconnect(args: argparse.Namespace) -> None:
    project = _project_path(args.project)
    if not args.yes:
        raise LoopgraphPluginError(
            "No changes were made. Rerun with `--yes` to remove only the three Loopgraph "
            "MCP registrations and preserve company data, credentials, skills, and other plugins."
        )
    _delegate(["hermes", "disconnect", "--project", str(project), "--yes"])


def _handle_start(args: argparse.Namespace) -> None:
    project = _project_path(args.project)
    command = ["start", "--project", str(project), "--host", args.host, "--port", str(args.port)]
    if args.once:
        command.append("--once")
    if args.no_studio:
        command.append("--no-studio")
    _delegate(command)


def _handle_webhooks(args: argparse.Namespace) -> None:
    project = _project_path(args.project)
    command = ["hermes", "webhooks", args.webhook_action, "--project", str(project)]
    if args.webhook_action == "sync" and args.dry_run:
        command.append("--dry-run")
    if args.webhook_action == "test":
        command.extend(["--fixture", str(Path(args.fixture).expanduser().resolve())])
        if args.require_synced_manifest:
            command.append("--require-synced-manifest")
    _delegate(command)


def _handle_version(_: argparse.Namespace) -> None:
    contract = _runtime_contract()
    receipt = _current_runtime_receipt()
    print(json.dumps({
        "pluginVersion": PLUGIN_VERSION,
        "runtimeBuilt": LOOPGRAPH_CLI.is_file(),
        "sourceRevision": receipt.get("sourceRevision") if receipt else _installed_revision(),
        "expectedPackageLockSha256": contract["packageLockSha256"],
    }, indent=2))


def _handle_command(args: argparse.Namespace) -> None:
    handler = getattr(args, "loopgraph_handler", None)
    if handler is None:
        raise LoopgraphPluginError(
            "Choose one of: plan, install, doctor, disconnect, start, webhooks, or version."
        )
    try:
        handler(args)
    except LoopgraphPluginError as exc:
        print(f"Loopgraph: {exc}")
        raise SystemExit(2) from exc


def _configure_command(parser: argparse.ArgumentParser) -> None:
    commands = parser.add_subparsers(dest="loopgraph_command")
    plan = commands.add_parser("plan", help="Preview the exact immutable runtime bootstrap")
    plan.add_argument("--project", default=os.getcwd(), help="Existing company project root")
    plan.add_argument("--ref", help="Exact 40-character runtime commit (advanced recovery)")
    plan.set_defaults(loopgraph_handler=_handle_plan)

    install = commands.add_parser(
        "install",
        help="Fetch the pinned runtime and activate Loopgraph for one company project",
    )
    install.add_argument("--project", default=os.getcwd(), help="Existing company project root")
    install.add_argument("--yes", action="store_true", help="Confirm the displayed pinned bootstrap")
    install.add_argument("--ref", help="Exact 40-character runtime commit (advanced recovery)")
    install.add_argument(
        "--no-activate",
        action="store_true",
        help="Generate project-local artifacts without changing Hermes MCP/skill configuration",
    )
    install.add_argument("--json", action="store_true", help="Print Loopgraph setup JSON")
    install.set_defaults(loopgraph_handler=_handle_install)

    doctor = commands.add_parser("doctor", help="Verify the project-local Hermes integration")
    doctor.add_argument("--project", default=os.getcwd(), help="Existing company project root")
    doctor.set_defaults(loopgraph_handler=_handle_doctor)

    disconnect = commands.add_parser(
        "disconnect",
        help="Remove Loopgraph MCP registrations without deleting company data or credentials",
    )
    disconnect.add_argument("--project", default=os.getcwd(), help="Existing company project root")
    disconnect.add_argument("--yes", action="store_true", help="Confirm the bounded disconnect")
    disconnect.set_defaults(loopgraph_handler=_handle_disconnect)

    start = commands.add_parser("start", help="Run the local Loopgraph supervisor and Studio")
    start.add_argument("--project", default=os.getcwd(), help="Existing company project root")
    start.add_argument("--host", default="localhost")
    start.add_argument("--port", type=int, default=3000)
    start.add_argument("--once", action="store_true", help="Run one supervisor cycle and exit")
    start.add_argument("--no-studio", action="store_true", help="Run without the Studio UI")
    start.set_defaults(loopgraph_handler=_handle_start)

    webhooks = commands.add_parser("webhooks", help="Plan, sync, verify, or rehearse Hermes routes")
    webhook_commands = webhooks.add_subparsers(dest="webhook_action", required=True)
    for action in ("plan", "doctor"):
        action_parser = webhook_commands.add_parser(action)
        action_parser.add_argument("--project", default=os.getcwd())
        action_parser.set_defaults(loopgraph_handler=_handle_webhooks)
    sync = webhook_commands.add_parser("sync")
    sync.add_argument("--project", default=os.getcwd())
    sync.add_argument("--dry-run", action="store_true")
    sync.set_defaults(loopgraph_handler=_handle_webhooks)
    test = webhook_commands.add_parser("test")
    test.add_argument("--project", default=os.getcwd())
    test.add_argument("--fixture", required=True)
    test.add_argument("--require-synced-manifest", action="store_true")
    test.set_defaults(loopgraph_handler=_handle_webhooks)

    version = commands.add_parser("version", help="Show adapter and runtime status")
    version.set_defaults(loopgraph_handler=_handle_version)
    parser.set_defaults(func=_handle_command)


def _slash_command(raw_args: str) -> str:
    action = " ".join((raw_args or "").strip().lower().split())
    if action in {"", "help"}:
        return (
            "Loopgraph is installed as a Hermes plugin. Say `start Loopgraph` to begin "
            "the guided company-loop flow. If the MCP tools are not ready, run "
            "`hermes loopgraph install --project <company-project> --yes`, restart Hermes, "
            "and say `start Loopgraph` again."
        )
    if action == "start":
        return "Say `start Loopgraph` as a normal message to enter the governed onboarding flow."
    if action == "doctor":
        return "Run `hermes loopgraph doctor --project <company-project>` in a terminal."
    return "Usage: /loopgraph [start|doctor|help]"


def register(ctx: Any) -> None:
    """Register stable Hermes surfaces without touching disk or network."""

    ctx.register_skill(
        name="design",
        path=DESIGN_SKILL,
        description="Discover, design, install, and operate governed company loops.",
    )
    ctx.register_skill(
        name="event-router",
        path=EVENT_ROUTER_SKILL,
        description="Route one verified normalized company event through bounded Loopgraph tools.",
    )
    ctx.register_hook("pre_llm_call", _inject_start_context)
    ctx.register_command(
        "loopgraph",
        handler=_slash_command,
        description="Start or inspect the Loopgraph integration",
        args_hint="[start|doctor|help]",
    )
    ctx.register_cli_command(
        name="loopgraph",
        help="Install and operate Loopgraph through Hermes",
        description="Bootstrap, verify, start, and rehearse the governed Loopgraph runtime",
        setup_fn=_configure_command,
        handler_fn=_handle_command,
    )

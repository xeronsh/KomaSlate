#!/usr/bin/env python3
"""Unified single-source contract generator and drift checker.

Sources under ``contracts/``:
  - ``contracts/workflow.json`` -> Python, Engine TS, Frontend TS workflow constants
  - ``contracts/events.json``   -> Python Pydantic models & TS discriminated unions
  - ``contracts/openapi.json``  -> Engine TS & Frontend TS REST ``api.d.ts``

Usage:
  python3 scripts/generate_all_contracts.py                  # regenerate mirrors from contracts/*.json
  python3 scripts/generate_all_contracts.py --export-openapi # refresh contracts/openapi.json + mirrors
  python3 scripts/generate_all_contracts.py --check          # offline zero-drift CI gate
  python3 scripts/generate_all_contracts.py --check --check-openapi
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS_DIR = ROOT / "contracts"
EVENTS_SOURCE = CONTRACTS_DIR / "events.json"
OPENAPI_SOURCE = CONTRACTS_DIR / "openapi.json"

EVENT_OUTPUTS = {
    "python": ROOT / "backend" / "app" / "generated" / "events_contract.py",
    "engine": ROOT / "engine" / "src" / "generated" / "events-contract.ts",
    "frontend": ROOT / "frontend" / "app" / "generated" / "eventsContract.ts",
}

OPENAPI_TS_OUTPUTS = {
    "engine": ROOT / "engine" / "src" / "generated" / "api.d.ts",
    "frontend": ROOT / "frontend" / "app" / "generated" / "api.d.ts",
}

ALLOWED_CATEGORIES = {
    "transport",
    "lifecycle",
    "workflow",
    "entity",
    "chat",
    "invalidation",
    "mcp",
    "cli",
    "export",
    "consistency",
}

ALLOWED_FIELD_TYPES = {
    "string",
    "integer",
    "number",
    "boolean",
    "unknown",
    "array",
    "record",
    "object",
    "union",
}


def _load_workflow_module() -> Any:
    path = Path(__file__).resolve().with_name("generate_workflow_contract.py")
    spec = importlib.util.spec_from_file_location("generate_workflow_contract", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pascal_case(name: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[^a-zA-Z0-9]+", name) if part)


def _validate_field_spec(event_type: str, field_name: str, spec: Any) -> None:
    if not isinstance(spec, dict):
        raise SystemExit(f"event {event_type}.{field_name} spec must be an object")
    ftype = spec.get("type")
    if ftype not in ALLOWED_FIELD_TYPES:
        raise SystemExit(f"event {event_type}.{field_name} has invalid type {ftype!r}")
    if ftype == "array":
        if "items" not in spec:
            raise SystemExit(f"event {event_type}.{field_name} array requires 'items'")
        _validate_field_spec(event_type, f"{field_name}[]", spec["items"])
    elif ftype == "record":
        if "values" in spec:
            _validate_field_spec(event_type, f"{field_name}{{}}", spec["values"])
    elif ftype == "object":
        props = spec.get("properties")
        if not isinstance(props, dict):
            raise SystemExit(f"event {event_type}.{field_name} object requires 'properties'")
        for prop_name, prop_spec in props.items():
            _validate_field_spec(event_type, f"{field_name}.{prop_name}", prop_spec)
    elif ftype == "union":
        variants = spec.get("anyOf")
        if not isinstance(variants, list) or not variants:
            raise SystemExit(f"event {event_type}.{field_name} union requires non-empty 'anyOf'")
        for idx, variant in enumerate(variants):
            _validate_field_spec(event_type, f"{field_name}|[{idx}]", variant)


def _load_events() -> dict[str, Any]:
    if not EVENTS_SOURCE.exists():
        raise SystemExit(f"missing events contract: {EVENTS_SOURCE}")
    data = json.loads(EVENTS_SOURCE.read_text(encoding="utf-8"))
    if not isinstance(data.get("events_version"), int):
        raise SystemExit("events.json requires integer events_version")
    events = data.get("events")
    if not isinstance(events, list) or not events:
        raise SystemExit("events.json must contain a non-empty events array")

    seen: set[str] = set()
    for ev in events:
        etype = ev.get("type")
        if not isinstance(etype, str) or not etype:
            raise SystemExit("every event requires a non-empty string type")
        if etype in seen:
            raise SystemExit(f"duplicate event type in events.json: {etype}")
        seen.add(etype)

        cat = ev.get("category")
        if cat not in ALLOWED_CATEGORIES:
            raise SystemExit(f"event {etype} has invalid category {cat!r}")
        if not isinstance(ev.get("durable"), bool):
            raise SystemExit(f"event {etype} requires boolean durable")
        payload = ev.get("payload")
        if not isinstance(payload, dict):
            raise SystemExit(f"event {etype} requires object payload")
        for field_name, spec in payload.items():
            if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", field_name):
                raise SystemExit(f"event {etype} has invalid field identifier {field_name!r}")
            _validate_field_spec(etype, field_name, spec)
    return data


def _py_type_for_spec(spec: dict[str, Any]) -> str:
    ftype = spec["type"]
    if "enum" in spec:
        literals = ", ".join(json.dumps(v, ensure_ascii=False) for v in spec["enum"])
        base = f"Literal[{literals}]"
    elif ftype == "string":
        base = "str"
    elif ftype == "integer":
        base = "int"
    elif ftype == "number":
        base = "float"
    elif ftype == "boolean":
        base = "bool"
    elif ftype == "unknown":
        base = "Any"
    elif ftype == "array":
        base = f"list[{_py_type_for_spec(spec['items'])}]"
    elif ftype == "record":
        val_spec = spec.get("values")
        val_type = _py_type_for_spec(val_spec) if val_spec else "Any"
        base = f"dict[str, {val_type}]"
    elif ftype == "object":
        base = "dict[str, Any]"
    elif ftype == "union":
        parts = [_py_type_for_spec(v) for v in spec["anyOf"]]
        base = " | ".join(parts)
    else:
        base = "Any"

    if spec.get("nullable") and base != "Any" and not base.endswith("| None"):
        return f"{base} | None"
    return base


def _py_field_line(name: str, spec: dict[str, Any]) -> str:
    type_expr = _py_type_for_spec(spec)
    required = spec.get("required", True)
    nullable = spec.get("nullable", False)
    has_default = "default" in spec
    ge = spec.get("ge")
    le = spec.get("le")

    field_args: list[str] = []
    if has_default:
        default_val = spec["default"]
        if isinstance(default_val, (list, dict)):
            factory = "list" if isinstance(default_val, list) else "dict"
            field_args.append(f"default_factory={factory}")
        else:
            field_args.append(f"default={repr(default_val)}")
    elif not required:
        default_val = None if nullable else None
        if not nullable and "None" not in type_expr and type_expr != "Any":
            type_expr = f"{type_expr} | None"
        field_args.append(f"default={repr(default_val)}")

    if ge is not None:
        field_args.append(f"ge={ge!r}")
    if le is not None:
        field_args.append(f"le={le!r}")

    if not field_args:
        return f"    {name}: {type_expr}"
    if len(field_args) == 1 and field_args[0].startswith("default="):
        return f"    {name}: {type_expr} = {field_args[0].split('=', 1)[1]}"
    return f"    {name}: {type_expr} = Field({', '.join(field_args)})"


def render_events_python(data: dict[str, Any]) -> str:
    events = data["events"]
    version = int(data["events_version"])
    type_literals = ",\n    ".join(json.dumps(ev["type"]) for ev in events)
    tuple_body = "\n".join(f'    "{ev["type"]}",' for ev in events)
    durable_body = "\n".join(f'    "{ev["type"]}",' for ev in events if ev["durable"])
    cat_lines = "\n".join(f'    "{ev["type"]}": "{ev["category"]}",' for ev in events)

    model_blocks: list[str] = []
    map_lines: list[str] = []
    for ev in events:
        etype = ev["type"]
        cls_name = f"{_pascal_case(etype)}EventPayload"
        desc = ev.get("description", "")
        payload = ev["payload"]
        lines = [
            f"class {cls_name}(BaseModel):",
            f'    """{desc}"""' if desc else "",
            "    model_config = ConfigDict(extra=\"allow\")",
        ]
        lines = [line for line in lines if line]
        for fname, fspec in payload.items():
            lines.append(_py_field_line(fname, fspec))
        model_blocks.append("\n".join(lines))
        map_lines.append(f'    "{etype}": {cls_name},')

    return (
        "# Generated by scripts/generate_all_contracts.py from contracts/events.json. DO NOT EDIT.\n"
        "from __future__ import annotations\n\n"
        "from typing import Any, Literal\n\n"
        "from pydantic import BaseModel, ConfigDict, Field\n\n"
        f"EVENTS_CONTRACT_VERSION = {version}\n\n"
        f"DomainEventType = Literal[\n    {type_literals}\n]\n\n"
        f"DOMAIN_EVENT_TYPES: tuple[DomainEventType, ...] = (\n{tuple_body}\n)\n\n"
        f"DURABLE_EVENT_TYPES: frozenset[str] = frozenset({{\n{durable_body}\n}})\n\n"
        f"EVENT_CATEGORIES: dict[str, str] = {{\n{cat_lines}\n}}\n\n\n"
        + "\n\n\n".join(model_blocks)
        + "\n\n\nEVENT_PAYLOAD_MODELS: dict[str, type[BaseModel]] = {\n"
        + "\n".join(map_lines)
        + "\n}\n\n\n"
        "class DomainEvent(BaseModel):\n"
        '    """Canonical envelope for domain and WebSocket events."""\n\n'
        '    model_config = ConfigDict(extra="allow")\n\n'
        "    type: DomainEventType\n"
        "    data: dict[str, Any] = Field(default_factory=dict)\n"
        "    event_id: int | None = None\n\n\n"
        "def validate_event_payload(event_type: str, data: dict[str, Any]) -> BaseModel:\n"
        '    """Validate an event payload against its generated contract model."""\n'
        "    model_cls = EVENT_PAYLOAD_MODELS.get(event_type)\n"
        "    if model_cls is None:\n"
        '        raise ValueError(f"Unknown domain event type: {event_type!r}")\n'
        "    return model_cls.model_validate(data)\n"
    )


def _ts_type_for_spec(spec: dict[str, Any]) -> str:
    ftype = spec["type"]
    if "enum" in spec:
        base = " | ".join(json.dumps(v, ensure_ascii=False) for v in spec["enum"])
    elif ftype == "string":
        base = "string"
    elif ftype in {"integer", "number"}:
        base = "number"
    elif ftype == "boolean":
        base = "boolean"
    elif ftype == "unknown":
        base = "unknown"
    elif ftype == "array":
        inner = _ts_type_for_spec(spec["items"])
        base = f"Array<{inner}>" if ("|" in inner or "&" in inner) else f"{inner}[]"
    elif ftype == "record":
        val_spec = spec.get("values")
        val_type = _ts_type_for_spec(val_spec) if val_spec else "unknown"
        base = f"Record<string, {val_type}>"
    elif ftype == "object":
        props = spec.get("properties", {})
        if not props:
            base = "Record<string, unknown>"
        else:
            inner_parts = []
            for k, v in props.items():
                opt = "?" if not v.get("required", True) else ""
                inner_parts.append(f"{k}{opt}: {_ts_type_for_spec(v)}")
            base = "{ " + "; ".join(inner_parts) + " }"
    elif ftype == "union":
        base = " | ".join(_ts_type_for_spec(v) for v in spec["anyOf"])
    else:
        base = "unknown"

    if spec.get("nullable") and base != "unknown" and "null" not in base.split(" | "):
        return f"{base} | null"
    return base


def render_events_ts(data: dict[str, Any]) -> str:
    events = data["events"]
    version = int(data["events_version"])
    categories = sorted({ev["category"] for ev in events})
    cat_union = " | ".join(json.dumps(c) for c in categories)
    types_array = "\n".join(f'  "{ev["type"]}",' for ev in events)
    durable_array = "\n".join(f'  "{ev["type"]}",' for ev in events if ev["durable"])
    cat_map_lines = "\n".join(f'  {ev["type"]}: "{ev["category"]}",' for ev in events)

    interfaces: list[str] = []
    payload_map_lines: list[str] = []
    union_lines: list[str] = []

    for ev in events:
        etype = ev["type"]
        iface_name = f"{_pascal_case(etype)}EventPayload"
        desc = ev.get("description", "")
        payload = ev["payload"]
        body_lines: list[str] = []
        for fname, fspec in payload.items():
            opt = "?" if not fspec.get("required", True) else ""
            ts_type = _ts_type_for_spec(fspec)
            body_lines.append(f"  {fname}{opt}: {ts_type};")

        doc = f"/** {desc} */\n" if desc else ""
        if body_lines:
            interfaces.append(f"{doc}export interface {iface_name} {{\n" + "\n".join(body_lines) + "\n}")
        else:
            interfaces.append(f"{doc}export type {iface_name} = Record<string, never>;")

        payload_map_lines.append(f"  {etype}: {iface_name};")
        union_lines.append(f'  | {{ type: "{etype}"; data: {iface_name}; event_id?: number }}')

    return (
        "// Generated by scripts/generate_all_contracts.py from contracts/events.json. DO NOT EDIT.\n"
        f"export const EVENTS_CONTRACT_VERSION = {version} as const;\n\n"
        f"export type EventCategory = {cat_union};\n\n"
        f"export const DOMAIN_EVENT_TYPES = [\n{types_array}\n] as const;\n"
        "export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];\n\n"
        f"export const DURABLE_EVENT_TYPES = [\n{durable_array}\n] as const;\n\n"
        f"export const EVENT_CATEGORY_MAP: Record<DomainEventType, EventCategory> = {{\n{cat_map_lines}\n}};\n\n"
        + "\n\n".join(interfaces)
        + "\n\nexport interface DomainEventPayloadMap {\n"
        + "\n".join(payload_map_lines)
        + "\n}\n\n"
        "export type DomainEventData<T extends DomainEventType> = DomainEventPayloadMap[T];\n\n"
        "export interface DomainEventEnvelope<T extends DomainEventType = DomainEventType> {\n"
        "  type: T;\n"
        "  data: DomainEventPayloadMap[T];\n"
        "  event_id?: number;\n"
        "}\n\n"
        "export type DomainEvent =\n"
        + "\n".join(union_lines)
        + ";\n"
    )


def _ts_prop_key(name: str) -> str:
    if re.match(r"^[a-zA-Z_$][a-zA-Z0-9_$]*$", name):
        return name
    return json.dumps(name)


def _openapi_schema_to_ts(schema: Any, indent: int = 0) -> str:
    if not isinstance(schema, dict) or not schema:
        return "unknown"

    if "$ref" in schema:
        ref = str(schema["$ref"])
        prefix = "#/components/schemas/"
        if ref.startswith(prefix):
            name = ref[len(prefix) :]
            return f'components["schemas"][{json.dumps(name)}]'
        return "unknown"

    if "const" in schema:
        return json.dumps(schema["const"], ensure_ascii=False)

    if "enum" in schema and isinstance(schema["enum"], list):
        return " | ".join(json.dumps(v, ensure_ascii=False) for v in schema["enum"]) or "never"

    if "allOf" in schema and isinstance(schema["allOf"], list):
        parts = [_openapi_schema_to_ts(sub, indent) for sub in schema["allOf"]]
        return "(" + " & ".join(parts) + ")" if len(parts) > 1 else (parts[0] if parts else "unknown")

    for combiner in ("anyOf", "oneOf"):
        if combiner in schema and isinstance(schema[combiner], list):
            parts = [_openapi_schema_to_ts(sub, indent) for sub in schema[combiner]]
            deduped: list[str] = []
            for p in parts:
                if p not in deduped:
                    deduped.append(p)
            return "(" + " | ".join(deduped) + ")" if len(deduped) > 1 else (deduped[0] if deduped else "unknown")

    raw_type = schema.get("type")
    if isinstance(raw_type, list):
        sub_types: list[str] = []
        for t in raw_type:
            sub = dict(schema)
            sub["type"] = t
            rendered = _openapi_schema_to_ts(sub, indent)
            if rendered not in sub_types:
                sub_types.append(rendered)
        return " | ".join(sub_types) or "unknown"

    if raw_type == "null":
        return "null"
    if raw_type == "string":
        return "string"
    if raw_type in {"integer", "number"}:
        return "number"
    if raw_type == "boolean":
        return "boolean"
    if raw_type == "array":
        items = schema.get("items")
        inner = _openapi_schema_to_ts(items, indent) if items else "unknown"
        return f"Array<{inner}>"
    if raw_type == "object" or "properties" in schema or "additionalProperties" in schema:
        props = schema.get("properties")
        additional = schema.get("additionalProperties")
        required = set(schema.get("required") or [])
        pad = " " * (indent + 2)
        end_pad = " " * indent
        lines: list[str] = []
        if isinstance(props, dict) and props:
            for key in sorted(props):
                prop_schema = props[key]
                opt = "" if key in required else "?"
                prop_ts = _openapi_schema_to_ts(prop_schema, indent + 2)
                lines.append(f"{pad}{_ts_prop_key(key)}{opt}: {prop_ts};")
        if additional is True:
            lines.append(f"{pad}[key: string]: unknown;")
        elif isinstance(additional, dict):
            add_ts = _openapi_schema_to_ts(additional, indent + 2)
            lines.append(f"{pad}[key: string]: {add_ts};")
        if not lines:
            return "Record<string, unknown>"
        return "{\n" + "\n".join(lines) + f"\n{end_pad}}}"

    return "unknown"


def _render_parameters_ts(params: list[dict[str, Any]], indent: int) -> str:
    by_in: dict[str, list[dict[str, Any]]] = {}
    for p in params:
        loc = str(p.get("in") or "query")
        by_in.setdefault(loc, []).append(p)
    pad = " " * (indent + 2)
    end_pad = " " * indent
    blocks: list[str] = []
    for loc in ("path", "query", "header", "cookie"):
        items = by_in.get(loc)
        if not items:
            continue
        all_opt = all(not item.get("required", False) for item in items)
        loc_opt = "?" if all_opt else ""
        inner_lines: list[str] = []
        for item in sorted(items, key=lambda x: str(x.get("name", ""))):
            name = str(item.get("name", ""))
            req = bool(item.get("required", False))
            schema_ts = _openapi_schema_to_ts(item.get("schema"), indent + 4)
            inner_lines.append(f"{pad}  {_ts_prop_key(name)}{'' if req else '?'}: {schema_ts};")
        blocks.append(f"{pad}{loc}{loc_opt}: {{\n" + "\n".join(inner_lines) + f"\n{pad}}};")
    if not blocks:
        return "never"
    return "{\n" + "\n".join(blocks) + f"\n{end_pad}}}"


def _render_content_map_ts(content: Any, indent: int) -> str:
    if not isinstance(content, dict) or not content:
        return "never"
    pad = " " * (indent + 2)
    end_pad = " " * indent
    lines: list[str] = []
    for media_type in sorted(content):
        entry = content[media_type]
        schema_ts = _openapi_schema_to_ts(entry.get("schema") if isinstance(entry, dict) else None, indent + 2)
        lines.append(f"{pad}{json.dumps(media_type)}: {schema_ts};")
    return "{\n" + "\n".join(lines) + f"\n{end_pad}}}"


def _render_operation_ts(op: dict[str, Any], indent: int) -> str:
    pad = " " * (indent + 2)
    end_pad = " " * indent
    lines: list[str] = []
    params = op.get("parameters") or []
    if params:
        lines.append(f"{pad}parameters: {_render_parameters_ts(params, indent + 2)};")
    req_body = op.get("requestBody")
    if isinstance(req_body, dict) and isinstance(req_body.get("content"), dict):
        opt = "" if req_body.get("required") else "?"
        lines.append(f"{pad}requestBody{opt}: {{\n{pad}  content: {_render_content_map_ts(req_body['content'], indent + 4)};\n{pad}}};")
    responses = op.get("responses") or {}
    resp_lines: list[str] = []
    for status in sorted(responses, key=str):
        resp_obj = responses[status]
        status_key = str(status) if str(status).isdigit() else json.dumps(str(status))
        content = resp_obj.get("content") if isinstance(resp_obj, dict) else None
        if isinstance(content, dict) and content:
            resp_lines.append(
                f"{pad}  {status_key}: {{\n{pad}    content: {_render_content_map_ts(content, indent + 6)};\n{pad}  }};"
            )
        else:
            resp_lines.append(f"{pad}  {status_key}: {{ content?: never }};")
    lines.append(f"{pad}responses: {{\n" + "\n".join(resp_lines) + f"\n{pad}}};")
    return "{\n" + "\n".join(lines) + f"\n{end_pad}}}"


def render_openapi_dts(openapi_doc: dict[str, Any]) -> str:
    info = openapi_doc.get("info") or {}
    title = info.get("title", "komaslate-backend")
    version = info.get("version", "0.1.0")

    paths_obj = openapi_doc.get("paths") or {}
    path_lines: list[str] = []
    operation_defs: list[str] = []
    http_methods = ("get", "put", "post", "delete", "options", "head", "patch", "trace")

    for path_key in sorted(paths_obj):
        path_item = paths_obj[path_key]
        if not isinstance(path_item, dict):
            continue
        method_lines: list[str] = []
        for method in http_methods:
            op = path_item.get(method)
            if not isinstance(op, dict):
                continue
            op_id = op.get("operationId") or f"{method}_{path_key}"
            method_lines.append(f'    {method}: operations[{json.dumps(str(op_id))}];')
            operation_defs.append(f"  {json.dumps(str(op_id))}: {_render_operation_ts(op, 2)};")
        if method_lines:
            path_lines.append(f"  {json.dumps(path_key)}: {{\n" + "\n".join(method_lines) + "\n  };")

    schemas_obj = (openapi_doc.get("components") or {}).get("schemas") or {}
    schema_lines: list[str] = []
    for schema_name in sorted(schemas_obj):
        schema_ts = _openapi_schema_to_ts(schemas_obj[schema_name], 4)
        schema_lines.append(f"    {_ts_prop_key(schema_name)}: {schema_ts};")

    return (
        "// Generated by scripts/generate_all_contracts.py from contracts/openapi.json. DO NOT EDIT.\n"
        f"// Source OpenAPI: {title} ({version})\n\n"
        "export interface paths {\n"
        + "\n".join(path_lines)
        + "\n}\n\n"
        "export interface components {\n"
        "  schemas: {\n"
        + "\n".join(schema_lines)
        + "\n  };\n"
        "}\n\n"
        "export interface operations {\n"
        + "\n".join(operation_defs)
        + "\n}\n\n"
        'export type ApiSchemas = components["schemas"];\n'
        'export type ApiSchema<Name extends keyof ApiSchemas> = ApiSchemas[Name];\n'
    )


def _fetch_live_openapi_json() -> dict[str, Any]:
    """Extract FastAPI OpenAPI schema without starting an HTTP server."""
    backend_dir = ROOT / "backend"
    try:
        if str(backend_dir) not in sys.path:
            sys.path.insert(0, str(backend_dir))
        from app.main import create_app  # type: ignore[import-not-found]

        return create_app().openapi()
    except ImportError:
        venv_python = backend_dir / ".venv" / "bin" / "python"
        if not venv_python.exists():
            raise SystemExit(
                "FastAPI is not importable in current python and backend/.venv/bin/python was not found."
            )
        env = dict(os.environ)
        env["PYTHONPATH"] = str(backend_dir)
        proc = subprocess.run(
            [
                str(venv_python),
                "-c",
                "import json; from app.main import create_app; print(json.dumps(create_app().openapi(), ensure_ascii=False))",
            ],
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise SystemExit(f"failed to export OpenAPI via {venv_python}:\n{proc.stderr.strip()}")
        return json.loads(proc.stdout)


def _sync_file(path: Path, expected: str, *, check: bool, dirty: list[Path]) -> None:
    if check:
        current = path.read_text(encoding="utf-8") if path.exists() else ""
        if current != expected:
            dirty.append(path.relative_to(ROOT))
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(expected, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate and verify all KomaSlate contracts.")
    parser.add_argument("--check", action="store_true", help="Verify generated mirrors have zero drift.")
    parser.add_argument(
        "--export-openapi",
        action="store_true",
        help="Refresh contracts/openapi.json from backend FastAPI app schema before generating api.d.ts.",
    )
    parser.add_argument(
        "--check-openapi",
        action="store_true",
        help="During --check, also verify contracts/openapi.json matches live FastAPI app.openapi().",
    )
    args = parser.parse_args(argv)

    dirty: list[Path] = []

    # 1. Workflow contract (delegates to generate_workflow_contract.py)
    wf_mod = _load_workflow_module()
    wf_data = wf_mod._load()
    wf_derived = wf_mod._derived(wf_data)
    wf_rendered = {
        "python": wf_mod.render_python(wf_data, wf_derived),
        "engine": wf_mod.render_engine(wf_data, wf_derived),
        "frontend": wf_mod.render_frontend(wf_data, wf_derived),
    }
    for key, out_path in wf_mod.OUTPUTS.items():
        _sync_file(out_path, wf_rendered[key], check=args.check, dirty=dirty)

    # 2. Events contract
    ev_data = _load_events()
    ev_rendered = {
        "python": render_events_python(ev_data),
        "engine": render_events_ts(ev_data),
        "frontend": render_events_ts(ev_data),
    }
    for key, out_path in EVENT_OUTPUTS.items():
        _sync_file(out_path, ev_rendered[key], check=args.check, dirty=dirty)

    # 3. OpenAPI spec + api.d.ts
    if args.export_openapi and not args.check:
        live_openapi = _fetch_live_openapi_json()
        openapi_text = json.dumps(live_openapi, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        _sync_file(OPENAPI_SOURCE, openapi_text, check=False, dirty=dirty)

    if args.check and args.check_openapi:
        live_openapi = _fetch_live_openapi_json()
        openapi_text = json.dumps(live_openapi, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        _sync_file(OPENAPI_SOURCE, openapi_text, check=True, dirty=dirty)

    if OPENAPI_SOURCE.exists():
        openapi_doc = json.loads(OPENAPI_SOURCE.read_text(encoding="utf-8"))
        dts_text = render_openapi_dts(openapi_doc)
        for out_path in OPENAPI_TS_OUTPUTS.values():
            _sync_file(out_path, dts_text, check=args.check, dirty=dirty)
    elif args.check:
        dirty.append(OPENAPI_SOURCE.relative_to(ROOT))

    if dirty:
        print("contract generated files are stale:")
        for rel in dirty:
            print(f"  - {rel}")
        print("run: python3 scripts/generate_all_contracts.py")
        return 1

    mode = "verified (zero drift)" if args.check else "generated"
    print(f"All contracts {mode}: workflow ({len(wf_data['stages'])} stages), events ({len(ev_data['events'])} types), openapi.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

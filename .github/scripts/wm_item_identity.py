"""Stable Warframe.market identity validation shared by Public-WM producers."""
import json
import os
import tempfile
from pathlib import Path


_RETIREMENT_REGISTRY = Path(__file__).resolve().parents[1] / 'wm-retired-items.json'


def _name(item):
    i18n = item.get('i18n') or {}
    return str(((i18n.get('en') or {}).get('name')) or item.get('en') or item.get('name') or '').strip()


def _name_key(value):
    return str(value or '').strip().casefold()


def validate_current_items(items, minimum=1500):
    if len(items) < minimum:
        raise ValueError('WM item manifest below minimum count: %d' % len(items))
    ids = [str(item.get('id') or '') for item in items]
    slugs = [str(item.get('slug') or '') for item in items]
    if any(not value for value in ids) or len(set(ids)) != len(ids):
        raise ValueError('WM item manifest has missing or duplicate stable ids')
    if any(not value for value in slugs) or len(set(slugs)) != len(slugs):
        raise ValueError('WM item manifest has missing or duplicate slugs')


def _retirement_records(retired_items=None):
    if retired_items is None:
        try:
            document = json.loads(_RETIREMENT_REGISTRY.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise ValueError('WM retired-item registry is missing or invalid') from error
        if not isinstance(document, dict) or document.get('schema_version') != 1:
            raise ValueError('WM retired-item registry has an unsupported schema')
        retired_items = document.get('items')

    if not isinstance(retired_items, list):
        raise ValueError('WM retired-item registry items must be a list')

    by_id = {}
    slugs = set()
    for record in retired_items:
        if not isinstance(record, dict):
            raise ValueError('WM retired-item registry contains an invalid record')
        item_id = record.get('id')
        slug = record.get('slug')
        evidence = record.get('evidence') or {}
        catalog = evidence.get('catalog') if isinstance(evidence, dict) else None
        orders = evidence.get('orders') if isinstance(evidence, dict) else None
        if not isinstance(item_id, str) or not item_id.strip() or not isinstance(slug, str) or not slug.strip():
            raise ValueError('WM retired-item registry has a missing stable ID or slug')
        item_id = item_id.strip()
        slug = slug.strip()
        if item_id in by_id:
            raise ValueError('WM retired-item registry has duplicate stable IDs')
        if slug in slugs:
            raise ValueError('WM retired-item registry has duplicate slugs')
        if (
            record.get('confirmed_not_tradable') is not True
            or not isinstance(record.get('checked_at'), str)
            or not record['checked_at'].strip()
            or not isinstance(catalog, dict)
            or catalog.get('http_status') != 200
            or catalog.get('id_present') is not False
            or catalog.get('slug_present') is not False
            or not isinstance(orders, dict)
            or orders.get('http_status') != 404
            or orders.get('error') != 'app.item.notFound'
        ):
            raise ValueError('WM retired-item record lacks confirmed catalog and order-route evidence')
        by_id[item_id] = slug
        slugs.add(slug)
    return by_id


def validate_identity_continuity(previous_items, current_items, minimum=1500, retired_items=None):
    validate_current_items(current_items, minimum=minimum)
    current_by_id = {str(item['id']): item for item in current_items}
    current_by_slug = {item['slug']: item for item in current_items}
    retired = _retirement_records(retired_items)
    reappeared = set(retired) & set(current_by_id)
    if reappeared:
        raise ValueError('retired stable IDs reappeared; review the retirement registry before publishing: %s' %
                         ', '.join(sorted(reappeared)[:8]))
    current_by_name = {}
    for item in current_items:
        key = _name_key(_name(item))
        if key:
            current_by_name.setdefault(key, []).append(item)

    renames = {}
    old_ids = set()
    matched_ids = set()
    unresolved = []
    for old in previous_items or []:
        old_slug = str(old.get('slug') or '')
        old_id = str(old.get('id') or '')
        if not old_slug:
            unresolved.append('<missing slug>')
            continue
        if old_id:
            if old_id in old_ids:
                raise ValueError('previous WM item manifest has duplicate stable ids')
            old_ids.add(old_id)
            if old_id in retired and retired[old_id] != old_slug:
                raise ValueError('retired-item registry slug does not match the previous slug: %s' % old_slug)
            current = current_by_id.get(old_id)
            if current is None and old_id in retired:
                continue
        else:
            old_name = _name_key(_name(old))
            direct = current_by_slug.get(old_slug)
            if direct and old_name and _name_key(_name(direct)) == old_name:
                current = direct
            else:
                matches = current_by_name.get(old_name, []) if old_name else []
                current = matches[0] if len(matches) == 1 else None
        if current is None:
            unresolved.append(old_slug)
            continue
        current_id = str(current['id'])
        if current_id in matched_ids:
            raise ValueError('multiple previously published items map to one current id')
        matched_ids.add(current_id)
        if old_slug != current['slug']:
            renames[old_slug] = current['slug']

    if len(set(renames.values())) != len(renames):
        raise ValueError('multiple previous slugs map to one current slug')
    if unresolved:
        raise ValueError('WM item manifest lost %d published identities: %s' %
                         (len(unresolved), ', '.join(unresolved[:8])))
    return renames


def validate_published_manifest_continuity(previous_doc, current_doc, minimum=1500, retired_items=None):
    """Validate that a KV release keeps every identity in the parent manifest."""
    if not isinstance(previous_doc, dict) or not isinstance(current_doc, dict):
        raise ValueError('WM item release manifests must be JSON objects')
    previous_items = previous_doc.get('data')
    current_items = current_doc.get('data')
    if not isinstance(previous_items, list) or not previous_items:
        raise ValueError('parent WM item manifest is missing or empty')
    if not isinstance(current_items, list) or not current_items:
        raise ValueError('current WM item manifest is missing or empty')
    return validate_identity_continuity(
        previous_items, current_items, minimum=minimum, retired_items=retired_items
    )


def build_identity_manifest(current_items, previous_items, previous_identity, renames):
    previous_by_id = {str(item.get('id')): item for item in (previous_items or []) if item.get('id')}
    old_slug_by_current = {new: old for old, new in renames.items()}
    previous_records = (previous_identity or {}).get('items') or {}
    if not isinstance(previous_records, dict):
        raise ValueError('previous item identity sidecar has an invalid items map')

    result = {}
    for item in current_items:
        item_id = str(item['id'])
        aliases = list((previous_records.get(item_id) or {}).get('aliases') or [])
        previous = previous_by_id.get(item_id)
        if previous and previous.get('slug') != item['slug']:
            aliases.append(previous['slug'])
        legacy_old_slug = old_slug_by_current.get(item['slug'])
        if legacy_old_slug:
            aliases.append(legacy_old_slug)
        unique_aliases = []
        for alias in aliases:
            if alias and alias != item['slug'] and alias not in unique_aliases:
                unique_aliases.append(alias)
        result[item_id] = {'slug': item['slug'], 'aliases': unique_aliases}
    return {'schema_version': 1, 'items': result}


def map_previous_results_by_id(current_items, previous_results, identity_manifest, renames):
    """Expose the most recent slug-keyed stale price under each current item slug."""
    previous_results = dict(previous_results or {})
    records = (identity_manifest or {}).get('items') or {}
    if not isinstance(records, dict):
        raise ValueError('previous item identity sidecar has an invalid items map')
    current_by_slug = {item['slug']: str(item['id']) for item in current_items}
    rename_targets = dict(renames or {})
    source_by_target = {}
    for old_slug, new_slug in rename_targets.items():
        if new_slug in source_by_target and source_by_target[new_slug] != old_slug:
            raise ValueError('multiple previous slugs map to one current slug')
        source_by_target[new_slug] = old_slug

    mapped = {}
    for item in current_items:
        slug = item['slug']
        item_id = str(item['id'])
        record = records.get(item_id) or {}
        if not isinstance(record, dict):
            raise ValueError('previous item identity record is invalid for id %s' % item_id)
        aliases = record.get('aliases') or []
        if not isinstance(aliases, list) or any(not isinstance(alias, str) for alias in aliases):
            raise ValueError('previous item identity aliases are invalid for id %s' % item_id)

        # A slug reused by another current identity must never inherit the former
        # owner's stale price. A current run's ID-based rename is stronger proof
        # and may still transfer that prior value to its original identity.
        if slug not in rename_targets and slug in previous_results:
            mapped[slug] = previous_results[slug]
            continue

        source = source_by_target.get(slug)
        if source in previous_results:
            mapped[slug] = previous_results[source]
            continue

        for alias in reversed(aliases):
            if alias not in previous_results:
                continue
            target = rename_targets.get(alias)
            owner = current_by_slug.get(alias)
            if target is not None and target != slug:
                continue
            if owner is not None and owner != item_id and target != slug:
                continue
            mapped[slug] = previous_results[alias]
            break
    return mapped


def load_json(path, required=False):
    path = Path(path)
    if not path.exists():
        return None
    try:
        with path.open('r', encoding='utf-8') as stream:
            return json.load(stream)
    except (OSError, ValueError) as error:
        if required:
            raise ValueError('unable to parse %s: %s' % (path, error))
        raise


def write_json_atomic(path, document):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(document, stream, ensure_ascii=False, separators=(',', ':'))
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise

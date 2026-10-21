import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.github' / 'scripts'))
from wm_item_identity import (
    build_identity_manifest,
    map_previous_results_by_id,
    validate_identity_continuity,
    validate_published_manifest_continuity,
)


class WmItemIdentityTests(unittest.TestCase):
    def test_published_ids_survive_slug_rename_and_alias_is_retained(self):
        previous = [{'id': 'id-1', 'slug': 'old_slug', 'en': 'Old Name'}]
        current = [{'id': 'id-1', 'slug': 'new_slug', 'en': 'New Name'}]
        renames = validate_identity_continuity(previous, current, minimum=1)
        manifest = build_identity_manifest(current, previous, {'items': {}}, renames)
        self.assertEqual(renames, {'old_slug': 'new_slug'})
        self.assertEqual(manifest['items']['id-1'], {'slug': 'new_slug', 'aliases': ['old_slug']})

    def test_alias_history_survives_multiple_slug_changes(self):
        previous = [{'id': 'id-1', 'slug': 'middle_slug', 'en': 'Item'}]
        current = [{'id': 'id-1', 'slug': 'latest_slug', 'en': 'Item'}]
        old_identity = {'items': {'id-1': {'slug': 'middle_slug', 'aliases': ['old_slug']}}}
        renames = validate_identity_continuity(previous, current, minimum=1)
        manifest = build_identity_manifest(current, previous, old_identity, renames)
        self.assertEqual(manifest['items']['id-1']['aliases'], ['old_slug', 'middle_slug'])

    def test_legacy_unique_name_bridge_is_supported(self):
        previous = [{'slug': 'old_slug', 'en': 'Same Name'}]
        current = [{'id': 'id-1', 'slug': 'new_slug', 'en': 'Same Name'}]
        self.assertEqual(validate_identity_continuity(previous, current, minimum=1),
                         {'old_slug': 'new_slug'})

    def test_unmatched_old_identity_fails_closed(self):
        previous = [{'id': 'old-id', 'slug': 'old_slug', 'en': 'Item'}]
        current = [{'id': 'new-id', 'slug': 'new_slug', 'en': 'Item'}]
        with self.assertRaisesRegex(ValueError, 'lost 1 published identities'):
            validate_identity_continuity(previous, current, minimum=1)

    def test_kv_release_preflight_allows_slug_rename_for_same_stable_id(self):
        previous = {'data': [{'id': 'id-1', 'slug': 'old_slug', 'en': 'Old Name'}]}
        current = {'data': [{'id': 'id-1', 'slug': 'new_slug', 'en': 'New Name'}]}
        self.assertEqual(
            validate_published_manifest_continuity(previous, current, minimum=1),
            {'old_slug': 'new_slug'},
        )

    def test_kv_release_preflight_rejects_lost_stable_id(self):
        previous = {'data': [{'id': 'old-id', 'slug': 'old_slug', 'en': 'Item'}]}
        current = {'data': [{'id': 'new-id', 'slug': 'new_slug', 'en': 'Item'}]}
        with self.assertRaisesRegex(ValueError, 'lost 1 published identities'):
            validate_published_manifest_continuity(previous, current, minimum=1)

    def test_kv_release_preflight_rejects_missing_parent_baseline(self):
        current = {'data': [{'id': 'id-1', 'slug': 'slug', 'en': 'Item'}]}
        with self.assertRaisesRegex(ValueError, 'parent WM item manifest is missing or empty'):
            validate_published_manifest_continuity({}, current, minimum=1)

    def test_previous_prices_follow_identity_to_current_slug(self):
        current = [{'id': 'id-1', 'slug': 'new_slug', 'en': 'Item'}]
        previous_results = {'old_slug': {'avg': 42}}
        identity = {'items': {'id-1': {'slug': 'new_slug', 'aliases': ['old_slug']}}}
        mapped = map_previous_results_by_id(current, previous_results, identity, {})
        self.assertEqual(mapped['new_slug'], {'avg': 42})

    def test_current_slug_price_wins_over_alias_fallback(self):
        current = [{'id': 'id-1', 'slug': 'new_slug', 'en': 'Item'}]
        previous_results = {'old_slug': {'avg': 42}, 'new_slug': {'avg': 50}}
        identity = {'items': {'id-1': {'slug': 'new_slug', 'aliases': ['old_slug']}}}
        mapped = map_previous_results_by_id(current, previous_results, identity, {})
        self.assertEqual(mapped['new_slug'], {'avg': 50})

    def test_reused_old_slug_does_not_leak_price_to_new_identity(self):
        current = [
            {'id': 'id-old', 'slug': 'renamed_old', 'en': 'Old Item'},
            {'id': 'id-new', 'slug': 'old_slug', 'en': 'New Item'},
        ]
        previous_results = {'old_slug': {'avg': 42}}
        identity = {'items': {
            'id-old': {'slug': 'renamed_old', 'aliases': ['old_slug']},
            'id-new': {'slug': 'old_slug', 'aliases': []},
        }}
        mapped = map_previous_results_by_id(
            current, previous_results, identity, {'old_slug': 'renamed_old'}
        )
        self.assertEqual(mapped['renamed_old'], {'avg': 42})
        self.assertNotIn('old_slug', mapped)

    def test_historical_alias_cannot_override_current_slug_owner(self):
        current = [
            {'id': 'id-old', 'slug': 'renamed_old', 'en': 'Old Item'},
            {'id': 'id-new', 'slug': 'old_slug', 'en': 'New Item'},
        ]
        previous_results = {'old_slug': {'avg': 84}}
        identity = {'items': {
            'id-old': {'slug': 'renamed_old', 'aliases': ['old_slug']},
            'id-new': {'slug': 'old_slug', 'aliases': []},
        }}
        mapped = map_previous_results_by_id(current, previous_results, identity, {})
        self.assertNotIn('renamed_old', mapped)
        self.assertEqual(mapped['old_slug'], {'avg': 84})

    def test_explicitly_confirmed_retirement_allows_only_the_matching_stable_id(self):
        previous = [
            {'id': 'keep-id', 'slug': 'keep_slug', 'en': 'Keep'},
            {'id': 'retired-id', 'slug': 'retired_slug', 'en': 'Retired'},
        ]
        current = [{'id': 'keep-id', 'slug': 'keep_slug', 'en': 'Keep'}]
        retirement = [{
            'id': 'retired-id',
            'slug': 'retired_slug',
            'confirmed_not_tradable': True,
            'checked_at': '2026-10-21T19:34:43Z',
            'evidence': {
                'catalog': {
                    'http_status': 200,
                    'id_present': False,
                    'slug_present': False,
                },
                'orders': {
                    'http_status': 404,
                    'error': 'app.item.notFound',
                },
            },
        }]

        self.assertEqual(
            validate_identity_continuity(previous, current, minimum=1, retired_items=retirement),
            {},
        )
        self.assertEqual(
            validate_published_manifest_continuity(
                {'data': previous}, {'data': current}, minimum=1, retired_items=retirement
            ),
            {},
        )
        mapped = map_previous_results_by_id(
            current,
            {'retired_slug': {'avg': 42}},
            {'items': {'keep-id': {'slug': 'keep_slug', 'aliases': []}}},
            {},
        )
        self.assertNotIn('retired_slug', mapped)

    def test_retirement_cannot_hide_a_slug_mismatch_or_unreviewed_loss(self):
        previous = [{'id': 'retired-id', 'slug': 'previous_slug', 'en': 'Retired'}]
        current = [{'id': 'other-id', 'slug': 'other_slug', 'en': 'Other'}]
        retirement = [{
            'id': 'retired-id',
            'slug': 'different_slug',
            'confirmed_not_tradable': True,
            'checked_at': '2026-10-21T19:34:43Z',
            'evidence': {
                'catalog': {'http_status': 200, 'id_present': False, 'slug_present': False},
                'orders': {'http_status': 404, 'error': 'app.item.notFound'},
            },
        }]

        with self.assertRaisesRegex(ValueError, 'does not match the previous slug'):
            validate_identity_continuity(previous, current, minimum=1, retired_items=retirement)
        with self.assertRaisesRegex(ValueError, 'lost 1 published identities'):
            validate_identity_continuity(previous, current, minimum=1, retired_items=[])

    def test_retired_identity_reappearing_requires_registry_review(self):
        previous = [{'id': 'retired-id', 'slug': 'retired_slug', 'en': 'Retired'}]
        current = [{'id': 'retired-id', 'slug': 'retired_slug', 'en': 'Retired'}]
        retirement = [{
            'id': 'retired-id',
            'slug': 'retired_slug',
            'confirmed_not_tradable': True,
            'checked_at': '2026-10-21T19:34:43Z',
            'evidence': {
                'catalog': {'http_status': 200, 'id_present': False, 'slug_present': False},
                'orders': {'http_status': 404, 'error': 'app.item.notFound'},
            },
        }]

        with self.assertRaisesRegex(ValueError, 'retired stable IDs reappeared'):
            validate_identity_continuity(previous, current, minimum=1, retired_items=retirement)

    def test_retirement_requires_both_catalog_and_order_route_evidence(self):
        previous = [{'id': 'retired-id', 'slug': 'retired_slug', 'en': 'Retired'}]
        current = [{'id': 'other-id', 'slug': 'other_slug', 'en': 'Other'}]
        retirement = [{
            'id': 'retired-id',
            'slug': 'retired_slug',
            'confirmed_not_tradable': True,
            'checked_at': '2026-10-21T19:34:43Z',
            'evidence': {
                'catalog': {'http_status': 200, 'id_present': True, 'slug_present': False},
                'orders': {'http_status': 404, 'error': 'app.item.notFound'},
            },
        }]

        with self.assertRaisesRegex(ValueError, 'lacks confirmed catalog and order-route evidence'):
            validate_identity_continuity(previous, current, minimum=1, retired_items=retirement)


if __name__ == '__main__':
    unittest.main()

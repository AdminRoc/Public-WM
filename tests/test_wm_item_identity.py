import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.github' / 'scripts'))
from wm_item_identity import (
    build_identity_manifest,
    map_previous_results_by_id,
    validate_identity_continuity,
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


if __name__ == '__main__':
    unittest.main()

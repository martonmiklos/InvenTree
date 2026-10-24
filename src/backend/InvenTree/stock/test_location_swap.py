"""Tests for swapping stock location contents."""

from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.urls import reverse

from part.models import Part
from stock.models import StockItem, StockLocation
from stock.status_codes import StockHistoryCode
from stock.test_api import StockAPITestCase


class StockLocationSwapTest(StockAPITestCase):
    """Exercise atomic content swaps and their validation and permissions."""

    url = reverse('api-location-swap')

    @classmethod
    def setUpTestData(cls):
        """Create two independent trees, including nested stock."""
        super().setUpTestData()
        cls.first = StockLocation.objects.create(name='Swap A')
        cls.second = StockLocation.objects.create(name='Swap B')
        cls.first_child = StockLocation.objects.create(name='Child A', parent=cls.first)
        cls.second_child = StockLocation.objects.create(
            name='Child B', parent=cls.second
        )
        cls.grandchild = StockLocation.objects.create(
            name='Nested', parent=cls.first_child
        )
        cls.part = Part.objects.create(name='Location swap part')
        cls.first_item = StockItem.objects.create(
            part=cls.part, location=cls.first, quantity=5
        )
        cls.second_item = StockItem.objects.create(
            part=cls.part, location=cls.second, quantity=10
        )
        cls.nested_item = StockItem.objects.create(
            part=cls.part, location=cls.grandchild, quantity=2
        )

    def swap(self, **kwargs):
        """Request a swap of the two test locations."""
        return self.patch(
            self.url,
            {'locations': [self.first.pk, self.second.pk], **kwargs},
            max_query_count=500,
        )

    def assert_tree_consistent(self):
        """Check both MPTT ancestry and stored paths against parent links."""
        for location in StockLocation.objects.filter(
            pk__in=[
                self.first.pk,
                self.second.pk,
                self.first_child.pk,
                self.second_child.pk,
                self.grandchild.pk,
            ]
        ):
            ancestors = []
            parent = location.parent
            while parent:
                ancestors.insert(0, parent)
                parent = parent.parent
            self.assertEqual(list(location.get_ancestors()), ancestors)
            self.assertEqual(
                location.pathstring,
                '/'.join(node.name for node in [*ancestors, location]),
            )

    def test_swap_contents(self):
        """Swap direct stock and complete subtrees without changing the containers."""
        self.swap()
        for item, location in [
            (self.first_item, self.second),
            (self.second_item, self.first),
            (self.nested_item, self.grandchild),
        ]:
            item.refresh_from_db()
            self.assertEqual(item.location_id, location.pk)
        self.first_child.refresh_from_db()
        self.second_child.refresh_from_db()
        self.grandchild.refresh_from_db()
        self.assertEqual(self.first_child.parent_id, self.second.pk)
        self.assertEqual(self.second_child.parent_id, self.first.pk)
        self.assertEqual(self.grandchild.parent_id, self.first_child.pk)
        for item in [self.first_item, self.second_item]:
            entry = item.tracking_info.get(
                tracking_type=StockHistoryCode.STOCK_MOVE.value
            )
            self.assertEqual(entry.user, self.user)
            self.assertEqual(entry.deltas['location'], item.location_id)
        self.assert_tree_consistent()

        # Swapping again restores the original contents.
        self.swap()
        self.first_item.refresh_from_db()
        self.first_child.refresh_from_db()
        self.assertEqual(self.first_item.location_id, self.first.pk)
        self.assertEqual(self.first_child.parent_id, self.first.pk)
        self.assert_tree_consistent()

    def test_form_options(self):
        """Expose the request fields to the frontend confirmation form."""
        actions = self.getActions(self.url)
        self.assertIn('locations', actions['PUT'])
        self.assertIn('skip_stock', actions['PUT'])

    def test_empty_location(self):
        """An empty side receives all direct stock and sublocations from the other."""
        empty = StockLocation.objects.create(name='Empty swap location')
        self.patch(
            self.url, {'locations': [self.first.pk, empty.pk]}, max_query_count=500
        )
        self.first_item.refresh_from_db()
        self.first_child.refresh_from_db()
        self.assertEqual(self.first_item.location_id, empty.pk)
        self.assertEqual(self.first_child.parent_id, empty.pk)
        self.assertFalse(self.first.get_children().exists())
        self.assertFalse(self.first.get_stock_items(cascade=False).exists())
        self.assert_tree_consistent()

    def test_depleted_stock(self):
        """Depleted items are also part of a location's contents."""
        self.first_item.quantity = 0
        self.first_item.save()
        self.swap()
        self.first_item.refresh_from_db()
        self.assertEqual(self.first_item.location_id, self.second.pk)
        self.assertEqual(self.first_item.quantity, 0)

    def test_sibling_locations(self):
        """Swaps also work between locations in the same tree."""
        parent = StockLocation.objects.create(name='Swap parent')
        self.first = StockLocation.objects.create(name='Sibling A', parent=parent)
        parent.refresh_from_db()
        self.second = StockLocation.objects.create(name='Sibling B', parent=parent)
        self.first.refresh_from_db()
        self.first_child = StockLocation.objects.create(
            name='Child A', parent=self.first
        )
        self.second.refresh_from_db()
        self.second_child = StockLocation.objects.create(
            name='Child B', parent=self.second
        )
        self.first_child.refresh_from_db()
        self.grandchild = StockLocation.objects.create(
            name='Nested', parent=self.first_child
        )
        self.assert_tree_consistent()
        self.swap()
        self.assert_tree_consistent()

    def test_structural_location(self):
        """Require explicit consent to leave direct stock in place."""
        self.first_item.delete()
        self.first.structural = True
        self.first.save()
        response = self.patch(
            self.url, {'locations': [self.first.pk, self.second.pk]}, expected_code=400
        )
        self.assertIn('skip_stock', response.data)
        self.first_child.refresh_from_db()
        self.assertEqual(self.first_child.parent_id, self.first.pk)

        self.swap(skip_stock=True)
        self.second_item.refresh_from_db()
        self.nested_item.refresh_from_db()
        self.first_child.refresh_from_db()
        self.second_child.refresh_from_db()
        self.assertEqual(self.second_item.location_id, self.second.pk)
        self.assertEqual(self.nested_item.location_id, self.grandchild.pk)
        self.assertEqual(self.first_child.parent_id, self.second.pk)
        self.assertEqual(self.second_child.parent_id, self.first.pk)
        self.assertFalse(
            self.second_item.tracking_info.filter(
                tracking_type=StockHistoryCode.STOCK_MOVE.value
            ).exists()
        )
        self.assert_tree_consistent()

        # Two structural locations can also exchange their sublocations.
        self.second_item.delete()
        self.second.refresh_from_db()
        self.second.structural = True
        self.second.save()
        self.swap(skip_stock=True)
        self.first_child.refresh_from_db()
        self.second_child.refresh_from_db()
        self.assertEqual(self.first_child.parent_id, self.first.pk)
        self.assertEqual(self.second_child.parent_id, self.second.pk)
        self.assert_tree_consistent()

    def test_invalid_selections(self):
        """Reject missing, duplicate, excessive, unknown, or overlapping selections."""
        for locations in [
            [],
            [self.first.pk],
            [self.first.pk, self.first.pk],
            [self.first.pk, self.second.pk, self.first_child.pk],
            [self.first.pk, 999999],
            [self.first.pk, self.grandchild.pk],
            [self.grandchild.pk, self.first.pk],
        ]:
            with self.subTest(locations=locations):
                self.patch(self.url, {'locations': locations}, expected_code=400)
        self.first_item.refresh_from_db()
        self.assertEqual(self.first_item.location_id, self.first.pk)

    def test_permissions(self):
        """Both location and stock change permissions are needed for a full swap."""
        self.clearRoles()
        self.patch(
            self.url, {'locations': [self.first.pk, self.second.pk]}, expected_code=403
        )
        self.assignRole('stock_location.change')
        self.patch(
            self.url, {'locations': [self.first.pk, self.second.pk]}, expected_code=403
        )
        self.swap(skip_stock=True)
        self.first_item.refresh_from_db()
        self.assertEqual(self.first_item.location_id, self.first.pk)

    def test_rollback(self):
        """A failing child move rolls back earlier stock and sublocation changes."""
        save = StockLocation.save

        def fail_second_child(location, *args, **kwargs):
            if location.pk == self.second_child.pk:
                raise ValidationError('Cannot move child')
            return save(location, *args, **kwargs)

        with patch.object(StockLocation, 'save', fail_second_child):
            self.patch(
                self.url,
                {'locations': [self.first.pk, self.second.pk]},
                expected_code=400,
                max_query_count=500,
            )
        for item, location in [
            (self.first_item, self.first),
            (self.second_item, self.second),
        ]:
            item.refresh_from_db()
            self.assertEqual(item.location_id, location.pk)
            self.assertFalse(
                item.tracking_info.filter(
                    tracking_type=StockHistoryCode.STOCK_MOVE.value
                ).exists()
            )
        self.first_child.refresh_from_db()
        self.assertEqual(self.first_child.parent_id, self.first.pk)
        self.assert_tree_consistent()

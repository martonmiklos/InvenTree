import { createApi } from './api';
import { expect, test } from './baseFixtures';
import { clearTableFilters } from './helpers';
import { doCachedLogin } from './login';

for (const structural of [false, true]) {
  test(`Stock - Swap selected locations${structural ? ' without moving parts' : ''}`, async ({
    browser
  }) => {
    const api = await createApi({});
    const prefix = `Swap ${Date.now()}`;
    const roots: number[] = [];
    let partId: number | undefined;

    const create = async (url: string, data: Record<string, unknown>) => {
      const response = await api.post(url, { data });
      expect(response.status()).toBe(201);
      return response.json();
    };

    try {
      const first = await create('stock/location/', {
        name: `${prefix} A`,
        structural
      });
      roots.push(first.pk);
      const second = await create('stock/location/', { name: `${prefix} B` });
      roots.push(second.pk);
      const third = await create('stock/location/', { name: `${prefix} C` });
      roots.push(third.pk);
      const firstChild = await create('stock/location/', {
        name: 'Child A',
        parent: first.pk
      });
      const secondChild = await create('stock/location/', {
        name: 'Child B',
        parent: second.pk
      });
      const nested = await create('stock/location/', {
        name: 'Nested',
        parent: firstChild.pk
      });
      const part = await create('part/', { name: `${prefix} Part` });
      partId = part.pk;
      const stock = await create('stock/', {
        part: partId,
        location: second.pk,
        quantity: 10
      });
      const nestedStock = await create('stock/', {
        part: partId,
        location: nested.pk,
        quantity: 2
      });

      const page = await doCachedLogin(browser, {
        url: 'stock/location/index/sublocations'
      });
      await clearTableFilters(page);
      await page.getByPlaceholder('Search').fill(prefix);

      const selectLocation = (name: string) =>
        page
          .getByRole('row')
          .filter({ has: page.getByRole('cell', { name, exact: true }) })
          .getByRole('checkbox');
      const actions = page.getByRole('button', {
        name: 'action-menu-location-actions',
        exact: true
      });
      const swap = page.getByRole('menuitem', {
        name: 'action-menu-location-actions-swap-selected-locations',
        exact: true
      });

      await selectLocation(first.name).check();
      await actions.click();
      await expect(swap).toBeHidden();
      await page.keyboard.press('Escape');

      await selectLocation(second.name).check();
      await actions.click();
      await expect(swap).toBeVisible();
      await page.keyboard.press('Escape');

      await selectLocation(third.name).check();
      await actions.click();
      await expect(swap).toBeHidden();
      await page.keyboard.press('Escape');
      await selectLocation(third.name).uncheck();

      await actions.click();
      await swap.click();
      const dialog = page.getByRole('dialog');
      if (structural) {
        await expect(dialog).toContainText(
          'Items cannot be moved to a structural location. Do you want to perform the swap without moving parts?'
        );
      }

      // Cancelling the confirmation must leave both sets of contents untouched.
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(
        (await (await api.get(`stock/${stock.pk}/`)).json()).location
      ).toBe(second.pk);
      expect(
        (await (await api.get(`stock/location/${firstChild.pk}/`)).json())
          .parent
      ).toBe(first.pk);

      await actions.click();
      await swap.click();
      const swapped = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/stock/location/swap/') &&
          response.request().method() === 'PATCH'
      );
      await dialog
        .getByRole('button', {
          name: structural ? 'Swap without moving parts' : 'Swap',
          exact: true
        })
        .click();
      expect((await swapped).status()).toBe(200);
      await expect(dialog).toBeHidden();

      expect(
        (await (await api.get(`stock/${stock.pk}/`)).json()).location
      ).toBe(structural ? second.pk : first.pk);
      expect(
        (await (await api.get(`stock/${nestedStock.pk}/`)).json()).location
      ).toBe(nested.pk);
      expect(
        (await (await api.get(`stock/location/${firstChild.pk}/`)).json())
          .parent
      ).toBe(second.pk);
      expect(
        (await (await api.get(`stock/location/${secondChild.pk}/`)).json())
          .parent
      ).toBe(first.pk);
      expect(
        (await (await api.get(`stock/location/${nested.pk}/`)).json())
          .pathstring
      ).toBe(`${second.name}/Child A/Nested`);
    } finally {
      for (const pk of roots) {
        const response = await api.delete(`stock/location/${pk}/`, {
          data: { delete_stock_items: true, delete_sub_locations: true }
        });
        expect(response.status()).toBe(204);
      }
      if (partId !== undefined) {
        await api.patch(`part/${partId}/`, { data: { active: false } });
        expect((await api.delete(`part/${partId}/`)).status()).toBe(204);
      }
      await api.dispose();
    }
  });
}

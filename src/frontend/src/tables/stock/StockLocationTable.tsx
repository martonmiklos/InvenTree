import { t } from '@lingui/core/macro';
import { Alert, Group } from '@mantine/core';
import { IconArrowsExchange } from '@tabler/icons-react';
import { useCallback, useMemo, useState } from 'react';

import { AddItemButton } from '@lib/components/AddItemButton';
import { type RowAction, RowEditAction } from '@lib/components/RowActions';
import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { ModelType } from '@lib/enums/ModelType';
import { UserRoles } from '@lib/enums/Roles';
import { apiUrl } from '@lib/functions/Api';
import useTable from '@lib/hooks/UseTable';
import type { TableFilter } from '@lib/types/Filters';
import type { TableColumn } from '@lib/types/Tables';
import { ActionDropdown } from '../../components/items/ActionDropdown';
import { ApiIcon } from '../../components/items/ApiIcon';
import {
  BooleanColumn,
  DescriptionColumn
} from '../../components/tables/ColumnRenderers';
import { InvenTreeTable } from '../../components/tables/InvenTreeTable';
import { useStockLocationFields } from '../../forms/StockForms';
import { InvenTreeIcon } from '../../functions/icons';
import {
  useApiFormModal,
  useBulkEditApiFormModal,
  useCreateApiFormModal,
  useEditApiFormModal
} from '../../hooks/UseForm';
import { useUserState } from '../../states/UserState';

/**
 * Stock location table
 */
export function StockLocationTable({ parentId }: Readonly<{ parentId?: any }>) {
  const table = useTable('stocklocation');
  const user = useUserState();

  const tableFilters: TableFilter[] = useMemo(() => {
    return [
      {
        name: 'cascade',
        label: t`Include Sublocations`,
        description: t`Include sublocations in results`
      },
      {
        name: 'structural',
        label: t`Structural`,
        description: t`Show structural locations`
      },
      {
        name: 'external',
        label: t`External`,
        description: t`Show external locations`
      },
      {
        name: 'has_location_type',
        label: t`Has location type`
      },
      {
        name: 'location_type',
        label: t`Location Type`,
        description: t`Filter by location type`,
        apiUrl: apiUrl(ApiEndpoints.stock_location_type_list),
        model: ModelType.stocklocationtype,
        modelRenderer: (instance: any) => instance.name
      }
    ];
  }, []);

  const tableColumns: TableColumn[] = useMemo(() => {
    return [
      {
        accessor: 'name',
        switchable: false,
        copyable: true,
        render: (record: any) => (
          <Group gap='xs'>
            {record.icon && <ApiIcon name={record.icon} />}
            {record.name}
          </Group>
        )
      },
      DescriptionColumn({}),
      {
        accessor: 'pathstring',
        copyable: true,
        sortable: true
      },
      {
        accessor: 'items',
        sortable: true
      },
      BooleanColumn({
        accessor: 'structural',
        defaultVisible: false
      }),
      BooleanColumn({
        accessor: 'external',
        defaultVisible: false
      }),
      {
        accessor: 'location_type',
        sortable: false,
        filter: ['has_location_type', 'location_type'],
        render: (record: any) => record.location_type_detail?.name
      }
    ];
  }, []);

  const newLocation = useCreateApiFormModal({
    url: ApiEndpoints.stock_location_list,
    title: t`Add Stock Location`,
    fields: useStockLocationFields(),
    focus: 'name',
    initialData: {
      parent: parentId
    },
    follow: true,
    modelType: ModelType.stocklocation,
    table: table,
    keepOpenOption: true
  });

  const [selectedLocation, setSelectedLocation] = useState<number>(-1);

  const editLocation = useEditApiFormModal({
    url: ApiEndpoints.stock_location_list,
    pk: selectedLocation,
    title: t`Edit Stock Location`,
    fields: useStockLocationFields(),
    onFormSuccess: (record: any) => table.updateRecord(record)
  });

  const setParent = useBulkEditApiFormModal({
    url: ApiEndpoints.stock_location_list,
    items: table.selectedIds,
    title: t`Set Parent Location`,
    fields: {
      parent: {}
    },
    onFormSuccess: table.refreshTable
  });

  const hasStructuralLocation = table.selectedRecords.some(
    (location) => location.structural
  );

  const swapLocations = useApiFormModal({
    url: ApiEndpoints.stock_location_swap,
    method: 'PATCH',
    title: t`Swap selected locations`,
    submitText: hasStructuralLocation ? t`Swap without moving parts` : t`Swap`,
    successMessage: t`Location contents swapped`,
    fields: {
      locations: { hidden: true, value: table.selectedIds },
      skip_stock: { hidden: true, value: hasStructuralLocation }
    },
    preFormContent: (
      <Alert color={hasStructuralLocation ? 'yellow' : 'blue'}>
        {hasStructuralLocation
          ? t`Items cannot be moved to a structural location. Do you want to perform the swap without moving parts?`
          : t`Swap the sublocations and stock items of the selected locations?`}
      </Alert>
    ),
    onFormSuccess: () => table.refreshTable(true)
  });

  const tableActions = useMemo(() => {
    const can_add = user.hasAddRole(UserRoles.stock_location);
    const can_edit = user.hasChangeRole(UserRoles.stock_location);

    return [
      <ActionDropdown
        tooltip={t`Location Actions`}
        icon={<InvenTreeIcon icon='location' />}
        disabled={!table.hasSelectedRecords}
        actions={[
          {
            name: t`Set Parent`,
            icon: <InvenTreeIcon icon='location' />,
            tooltip: t`Set parent location for the selected items`,
            hidden: !can_edit,
            disabled: !table.hasSelectedRecords,
            onClick: () => {
              setParent.open();
            }
          },
          {
            name: t`Swap selected locations`,
            icon: <IconArrowsExchange />,
            hidden:
              !can_edit ||
              table.selectedIds.length !== 2 ||
              (!hasStructuralLocation && !user.hasChangeRole(UserRoles.stock)),
            onClick: () => swapLocations.open()
          }
        ]}
      />,
      <AddItemButton
        key='add-stock-location'
        tooltip={t`Add Stock Location`}
        onClick={() => newLocation.open()}
        hidden={!can_add}
      />
    ];
  }, [user, table.selectedRecords, hasStructuralLocation, swapLocations.open]);

  const rowActions = useCallback(
    (record: any): RowAction[] => {
      const can_edit = user.hasChangeRole(UserRoles.stock_location);

      return [
        RowEditAction({
          hidden: !can_edit,
          onClick: () => {
            setSelectedLocation(record.pk);
            editLocation.open();
          }
        })
      ];
    },
    [user]
  );

  return (
    <>
      {newLocation.modal}
      {editLocation.modal}
      {setParent.modal}
      {swapLocations.modal}
      <InvenTreeTable
        url={apiUrl(ApiEndpoints.stock_location_list)}
        tableState={table}
        columns={tableColumns}
        props={{
          enableSelection: true,
          enableDownload: true,
          enableLabels: true,
          enableReports: true,
          params: {
            parent: parentId,
            top_level: parentId === undefined ? true : undefined
          },
          tableFilters: tableFilters,
          tableActions: tableActions,
          rowActions: rowActions,
          modelType: ModelType.stocklocation
        }}
      />
    </>
  );
}

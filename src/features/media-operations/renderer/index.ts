export {
  approvalLabels,
  approvalTypeLabels,
  financeStatusLabel,
  leadLabels,
  ledgerLabels,
  metricLabels,
  publicationLabels,
  publicationStatusLabel,
  taskLabels,
} from './view-models/mediaOperationsLabels';
import { lazy } from 'react';

export const ProductionPanel = lazy(() =>
  import('./ui/ProductionPanel').then((module) => ({ default: module.ProductionPanel }))
);

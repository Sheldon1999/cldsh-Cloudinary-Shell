// Flag definitions shared by several commands (see lib/parse.js for the schema format).
import { RESOURCE_TYPES } from './backend/index.js';

export const RT_FLAG = {
  rt: {
    type: 'string',
    alias: ['resource-type'],
    values: ['all', ...RESOURCE_TYPES],
    placeholder: 'image|video|raw|all',
    description: 'Resource type filter (default: all)',
  },
};

export const TYPE_FLAG = {
  type: {
    type: 'string',
    values: ['upload', 'private', 'authenticated'],
    placeholder: 'upload|private|authenticated',
    description: 'Delivery type',
  },
};

export const DRY_RUN_FLAG = {
  'dry-run': { type: 'boolean', alias: ['dryRun'], description: 'Show what would happen without changing anything' },
};

export const YES_FLAG = {
  yes: { type: 'boolean', short: 'y', description: 'Do not ask for confirmation' },
};

export const MAX_FLAG = {
  max: { type: 'number', placeholder: 'N', description: 'Maximum number of assets to list' },
};

/** Resource types selected by --rt (all when absent or "all"). */
export function resourceTypesFrom(flags) {
  return flags.rt && flags.rt !== 'all' ? [flags.rt] : RESOURCE_TYPES;
}

/** Single resource type for commands addressing one asset (undefined = search all). */
export function resourceTypeFrom(flags) {
  return flags.rt && flags.rt !== 'all' ? flags.rt : undefined;
}

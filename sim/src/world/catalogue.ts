import type { EnvId, EnvironmentInfo } from './environment';
import { TestField } from './testField';

/**
 * Every place the simulator knows about, in the order the pilot sees them. The ones
 * without `create` are planned and listed, but not built yet.
 */
export const ENVIRONMENTS: readonly EnvironmentInfo[] = [
  {
    id: 'test',
    name: 'Test Field',
    summary: 'Flat ground with a landing pad and obstacles to fly round, between and onto.',
    create: () => new TestField(),
  },
  // TODO(step-12)
  {
    id: 'mountains',
    name: 'Mountains',
    summary: 'Peaks, valleys and an alpine lake.',
    create: null,
  },
  // TODO(step-14)
  {
    id: 'ocean',
    name: 'Ocean',
    summary: 'Open sea with islands, a lighthouse and a ship.',
    create: null,
  },
  // TODO(step-15)
  {
    id: 'beach',
    name: 'Beach',
    summary: 'A shoreline with dunes, palms and a pier.',
    create: null,
  },
  // TODO(step-16)
  { id: 'city', name: 'City', summary: 'Streets, towers, a park and a river.', create: null },
];

export function environmentInfo(id: EnvId): EnvironmentInfo {
  const info = ENVIRONMENTS.find((entry) => entry.id === id);
  if (!info) {
    throw new Error(`Unknown environment "${id}"`);
  }
  return info;
}

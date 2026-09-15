export { DomainError, IllegalTransitionError } from './errors';
export {
  createStateMachine,
  type StateMachine,
  type StateMachineDefinition,
} from './state-machine';

export { CATEGORY_STATES, categoryMachine, type CategoryState } from './machines/category';
export { MATCH_STATES, matchMachine, type MatchState } from './machines/match';
export { TATAMI_STATES, tatamiMachine, type TatamiState } from './machines/tatami';
export { DEVICE_STATES, deviceMachine, type DeviceState } from './machines/device';

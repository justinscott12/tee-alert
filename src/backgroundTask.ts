import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { loadWatch, runCheck } from './watcher';

const TASK = 'mangrove-tee-check';

// Must run at module scope (imported from index.ts), not inside a component.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(TASK, async () => {
    try {
      const watch = await loadWatch();
      if (!watch.enabled) return BackgroundTask.BackgroundTaskResult.Success;
      const r = await runCheck();
      return r.error ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** iOS decides when this actually runs; 15 min is the floor, real gaps are often longer. */
export async function setBackgroundWatching(on: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  const registered = await TaskManager.isTaskRegisteredAsync(TASK);
  if (on && !registered) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  if (!on && registered) await BackgroundTask.unregisterTaskAsync(TASK);
}

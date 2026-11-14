import type { ExclusiveRunner } from '../../src/application/ports/out/exclusive-runner.js';
import type { PublishPendingDailyMessages } from '../../src/application/use-cases/check-view-reservation/ports/in/publish-pending-daily-messages.port.js';

/**
 * Para las pruebas que arman a mano `DailyListChangeRecorder` o `GenerateDailyList` y no prueban la
 * publicación (T029): no publica nada.
 */
export const NO_PUBLICATION: PublishPendingDailyMessages = {
  execute: () => Promise.resolve(0),
};

/** Un `ExclusiveRunner` sin competencia: siempre consigue el bloqueo y corre el trabajo. */
export const ALWAYS_EXCLUSIVE: ExclusiveRunner = {
  runExclusive: async (_name, work) => {
    await work();
    return true;
  },
};

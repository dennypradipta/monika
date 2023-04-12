import { differenceInSeconds } from 'date-fns'
import { parentPort, workerData } from 'worker_threads'
import { Notification } from '../../components/notification/channel'
import { doProbe } from '../../components/probe'
import { getContext } from '../../context'
import { Probe } from '../../interfaces/probe'
import { log } from '../../utils/pino'
import {
  getProbeContext,
  getProbeState,
  initializeProbeStates,
} from '../../utils/probe-state'
import { isConnectedToSTUNServer } from '../../utils/public-ip'

const DISABLE_STUN = -1 // -1 is disable stun checking

type StartProbingArgs = {
  probes: Probe[]
  notifications: Notification[]
  isPaused: boolean
}

const main = async ({
  probes,
  notifications,
  isPaused,
}: StartProbingArgs): Promise<void> => {
  try {
    const flags = getContext().flags
    const repeat = flags.repeat

    initializeProbeStates(probes)

    if (repeat) {
      const finishedProbe = probes.every((probe) => {
        const context = getProbeContext(probe.id)

        return context.cycle === repeat && getProbeState(probe.id) === 'idle'
      })

      if (finishedProbe) {
        return parentPort?.postMessage(
          JSON.stringify({
            success: true,
            state: 'finished',
            probes,
            notifications,
          })
        )
      }
    }

    if ((isConnectedToSTUNServer && !isPaused) || flags.stun === DISABLE_STUN) {
      for await (const probe of probes) {
        const probeState = getProbeState(probe.id)
        const context = getProbeContext(probe.id)
        const diff = differenceInSeconds(new Date(), context.lastFinish)

        if (probeState === 'idle' && diff >= probe.interval) {
          if (repeat && context.cycle === repeat) {
            continue
          }

          await doProbe({
            checkOrder: context.cycle,
            probe,
            notifications,
          })
            .then(() => {
              return parentPort?.postMessage(
                JSON.stringify({
                  success: true,
                  state: 'success',
                  probes,
                  notifications,
                })
              )
            })
            .catch(() => {
              log.error('Error pas ngeprobe')
              return parentPort?.postMessage(
                JSON.stringify({
                  success: false,
                  state: 'error',
                  probes,
                  notifications,
                })
              )
            })
        }
      }
    }
  } catch (error) {
    log.error(error as Error)
    return parentPort?.postMessage(
      JSON.stringify({
        success: false,
        state: 'error',
        probes,
        notifications,
      })
    )
  }
}

;(() => {
  const data = JSON.parse(workerData.data)
  main(data)
})()

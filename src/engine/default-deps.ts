import { FsWorkflowRepository } from '../infra/fs/fs-workflow-repo.js'
import { FsEventRepository } from '../infra/fs/fs-event-repo.js'
import { FsRunRepository } from '../infra/fs/fs-run-repo.js'
import { setDefaultWorkflowDeps } from '../workflow/workflow.js'
import { systemClock } from '../shared/utils/clock.js'

setDefaultWorkflowDeps({
  clock: systemClock,
  repo: new FsWorkflowRepository(),
  eventRepo: new FsEventRepository(),
  runRepo: new FsRunRepository(),
})

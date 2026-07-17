import crypto from 'crypto'

const createId = () => crypto.randomBytes(16).toString('hex')

const TaskState = {
  PENDING: 'PENDING',
  READY: 'READY',
  WAITING_FOR_PERMISSION: 'WAITING_FOR_PERMISSION',
  RUNNING: 'RUNNING',
  OBSERVING: 'OBSERVING',
  VERIFYING: 'VERIFYING',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
  ROLLED_BACK: 'ROLLED_BACK',
  UNCERTAIN: 'UNCERTAIN'
}

class TaskGraphScheduler {
  constructor(options = {}) {
    this.taskGraph = null
    this.taskStates = new Map() // taskId -> state
    this.taskResults = new Map() // taskId -> result
    this.observations = new Map() // taskId -> observation
    this.verifications = new Map() // taskId -> verification
    this.transitions = [] // array of { taskId, oldState, newState, timestamp }
    this.capabilityRegistry = options.capabilityRegistry || null
    this.recoveryEngine = options.recoveryEngine || null
    this.troubleshootingEngine = options.troubleshootingEngine || null
    this.observationEngine = options.observationEngine || null
    this.verificationEngine = options.verificationEngine || null
    this.adapter = options.adapter || null
  }

  // Initialize (or re-initialize during replanning) the scheduler with a task
  // graph. When replanning, pass options.preserveStates: a Map of taskId ->
  // { state, result, observation, verification } for tasks that were already
  // VERIFIED. Those tasks are restored as VERIFIED and are never re-executed,
  // guaranteeing completed (and non-idempotent) work is not repeated.
  initialize(taskGraph, options = {}) {
    this.taskGraph = taskGraph
    this.taskStates.clear()
    this.taskResults.clear()
    this.observations.clear()
    this.verifications.clear()
    this.transitions = []

    const preserveStates = options.preserveStates instanceof Map ? options.preserveStates : null

    for (const task of taskGraph.tasks) {
      const preserved = preserveStates?.get(task.taskId)
      if (preserved && preserved.state === TaskState.VERIFIED) {
        this._setTaskState(task.taskId, TaskState.VERIFIED)
        if (preserved.result !== undefined) this.taskResults.set(task.taskId, preserved.result)
        if (preserved.observation !== undefined) this.observations.set(task.taskId, preserved.observation)
        if (preserved.verification !== undefined) this.verifications.set(task.taskId, preserved.verification)
      } else {
        this._setTaskState(task.taskId, TaskState.PENDING)
      }
    }
  }

  // Snapshot the current per-task state so a replan can preserve completed work.
  captureCompletedStates() {
    const preserved = new Map()
    for (const [taskId, state] of this.taskStates.entries()) {
      if (state === TaskState.VERIFIED) {
        preserved.set(taskId, {
          state,
          result: this.taskResults.get(taskId),
          observation: this.observations.get(taskId),
          verification: this.verifications.get(taskId)
        })
      }
    }
    return preserved
  }

  _setTaskState(taskId, newState) {
    const oldState = this.taskStates.get(taskId)
    this.taskStates.set(taskId, newState)
    this.transitions.push({
      taskId,
      oldState,
      newState,
      timestamp: new Date().toISOString()
    })
  }

  getReadyTasks() {
    if (!this.taskGraph) return []

    const readyTasks = []

    for (const task of this.taskGraph.tasks) {
      const currentState = this.taskStates.get(task.taskId)
      if (currentState !== TaskState.PENDING && currentState !== TaskState.READY) continue

      const allDependenciesVerified = task.dependencies.every(depId => 
        this.taskStates.get(depId) === TaskState.VERIFIED
      )

      const anyDependencyFailed = task.dependencies.some(depId => 
        this.taskStates.get(depId) === TaskState.FAILED
      )

      if (anyDependencyFailed) {
        this._setTaskState(task.taskId, TaskState.SKIPPED)
      } else if (allDependenciesVerified) {
        this._setTaskState(task.taskId, TaskState.READY)
        readyTasks.push(task)
      }
    }

    return readyTasks
  }

  async executeTask(task) {
    const capability = this.capabilityRegistry?.get(task.capability)
    if (!capability) throw new Error(`Unknown capability ${task.capability}`)

    this._setTaskState(task.taskId, TaskState.RUNNING)

    // Recovery budget: the task's own retryBudget bounds attempts, combined
    // with the capability's retry policy (backoff). This is the single place
    // execution-level retry happens.
    const retryPolicy = {
      maxAttempts: Math.max(
        1,
        Number(task.retryBudget ?? capability.retryPolicy?.maxAttempts ?? 1) + 1
      ),
      backoffMs: Number(capability.retryPolicy?.backoffMs ?? 0)
    }

    let executionResult
    try {
      if (this.recoveryEngine) {
        const recoveryResult = await this.recoveryEngine.executeWithBudget(
          { action: { retryPolicy } },
          async () => await capability.execute(task.inputs)
        )
        if (!recoveryResult.success) {
          const err = recoveryResult.errors?.at(-1)?.message ?? 'Execution failed after retries'
          throw new Error(err)
        }
        executionResult = recoveryResult.output
        this.taskResults.set(task.taskId, executionResult)
      } else {
        executionResult = await capability.execute(task.inputs)
        this.taskResults.set(task.taskId, executionResult)
      }
    } catch (error) {
      this.taskResults.set(task.taskId, { error: error.message })
      this._setTaskState(task.taskId, TaskState.FAILED)
      // Surface a structured verification instead of throwing so the runtime's
      // diagnose -> recover -> replan loop can react to it uniformly.
      const verification = {
        status: 'FAILED',
        message: `Execution error: ${error.message}`,
        evidence: { error: error.message },
        confidence: 1
      }
      this.verifications.set(task.taskId, verification)
      const observation = this._enrichObservation({ error: error.message }, task, 'execution-error')
      this.observations.set(task.taskId, observation)
      return { verification, observation, executionResult: { error: error.message } }
    }

    this._setTaskState(task.taskId, TaskState.OBSERVING)

    let observation
    try {
      observation = await capability.observe(executionResult, task.inputs)
    } catch (error) {
      const obs = this._enrichObservation({ error: error.message }, task, 'observe-error')
      this.observations.set(task.taskId, obs)
      const verification = {
        status: 'FAILED',
        message: `Observation error: ${error.message}`,
        evidence: { error: error.message },
        confidence: 1
      }
      this.verifications.set(task.taskId, verification)
      this._setTaskState(task.taskId, TaskState.FAILED)
      return { verification, observation: obs, executionResult }
    }

    observation = this._enrichObservation(observation, task, 'capability')
    this.observations.set(task.taskId, observation)
    this._setTaskState(task.taskId, TaskState.VERIFYING)

    let verification
    try {
      verification = await capability.verify(observation, task.inputs)
    } catch (error) {
      this.verifications.set(task.taskId, { error: error.message })
      this._setTaskState(task.taskId, TaskState.UNCERTAIN)
      throw error
    }

    this.verifications.set(task.taskId, verification)

    if (verification.status === 'VERIFIED' || verification.status === 'PARTIALLY_VERIFIED') {
      this._setTaskState(task.taskId, TaskState.VERIFIED)
    } else if (verification.status === 'INCONCLUSIVE') {
      this._setTaskState(task.taskId, TaskState.UNCERTAIN)
    } else {
      this._setTaskState(task.taskId, TaskState.FAILED)
    }

    return { verification, observation, executionResult }
  }

  isComplete() {
    if (!this.taskGraph) return false

    for (const task of this.taskGraph.tasks) {
      const state = this.taskStates.get(task.taskId)
      if ([TaskState.PENDING, TaskState.READY, TaskState.RUNNING, TaskState.OBSERVING, TaskState.VERIFYING, TaskState.WAITING_FOR_PERMISSION].includes(state)) {
        return false
      }
    }
    return true
  }

  getTaskState(taskId) {
    return this.taskStates.get(taskId)
  }

  getFinalStatus() {
    if (!this.isComplete()) return null

    const allVerified = Array.from(this.taskStates.values()).every(
      state => state === TaskState.VERIFIED || state === TaskState.SKIPPED
    )

    const anyFailed = Array.from(this.taskStates.values()).some(state => state === TaskState.FAILED)
    const anyUncertain = Array.from(this.taskStates.values()).some(state => state === TaskState.UNCERTAIN)

    if (allVerified) {
      return { status: 'COMPLETED' }
    } else if (anyFailed) {
      return { status: 'FAILED' }
    } else if (anyUncertain) {
      return { status: 'UNCERTAIN' }
    } else {
      return { status: 'PARTIALLY_COMPLETED' }
    }
  }

  getTransitions() {
    return this.transitions
  }

  // Ensure every observation carries the canonical envelope regardless of what
  // the capability returned: timestamp, taskId, capability, source, confidence,
  // structuredState, detectedChanges, affectedEntities, rawEvidence, provenance.
  _enrichObservation(observation, task, provenance) {
    const base = (observation && typeof observation === 'object') ? observation : { structuredState: observation }
    return {
      // Preserve any capability-specific fields (e.g. `type`,
      // `environmentVariable`, `pathEntry`) that SemanticState.ingestObservations
      // keys on, then normalize the canonical fields on top.
      ...base,
      observationId: base.observationId ?? createId(),
      timestamp: base.timestamp ?? new Date().toISOString(),
      taskId: task.taskId,
      capability: task.capability,
      source: base.source ?? task.capability,
      confidence: base.confidence ?? 1,
      structuredState: base.structuredState ?? null,
      detectedChanges: base.detectedChanges ?? task.expectedStateChanges ?? [],
      affectedEntities: base.affectedEntities ?? task.affectedEntities ?? [],
      rawEvidence: base.rawEvidence ?? base.structuredState ?? null,
      trustLevel: base.trustLevel ?? 'SYSTEM_TRUSTED',
      provenance: base.provenance ?? provenance
    }
  }
}

export { TaskGraphScheduler, TaskState, createId }

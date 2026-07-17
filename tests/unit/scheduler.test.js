import assert from 'node:assert'
import { describe, it, before } from 'node:test'
import path from 'node:path'
import { TaskGraphScheduler, TaskState, createId } from '../../packages/task-graph-scheduler/src/index.js'
import { CapabilityRegistry, createDefaultCapabilityRegistry } from '../../packages/capability-registry/src/index.js'
import { WindowsAdapter } from '../../os-adapters/windows/src/windows-adapter.js'

describe('TaskGraphScheduler', () => {
  let capabilityRegistry
  let adapter

  before(async () => {
    adapter = new WindowsAdapter()
    capabilityRegistry = createDefaultCapabilityRegistry(adapter)
  })

  it('should initialize with a task graph', async () => {
    const scheduler = new TaskGraphScheduler({ capabilityRegistry, adapter })
    const taskGraph = {
      tasks: [
        { taskId: createId(), capability: 'system.inspect', dependencies: [], inputs: {} }
      ]
    }
    scheduler.initialize(taskGraph)
    assert(scheduler.getReadyTasks().length > 0, 'should have a ready task')
  })

  it('should respect task dependencies', async () => {
    const scheduler = new TaskGraphScheduler({ capabilityRegistry, adapter })
    const task1Id = createId()
    const task2Id = createId()
    const taskGraph = {
      tasks: [
        { taskId: task1Id, capability: 'system.inspect', dependencies: [], inputs: {} },
        { taskId: task2Id, capability: 'processes.list', dependencies: [task1Id], inputs: {} }
      ]
    }
    scheduler.initialize(taskGraph)
    const readyTasks = scheduler.getReadyTasks()
    assert.strictEqual(readyTasks.length, 1)
    assert.strictEqual(readyTasks[0].taskId, task1Id)
  })
})

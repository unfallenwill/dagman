import { describe, it, expect } from 'vitest'
import { validateWorkflowRecord } from '../../src/utils/json.js'

describe('validateWorkflowRecord', () => {
  it('should return valid for a correct workflow record', () => {
    const data = {
      step: 0,
      status: 'running',
      tasks: [],
      channelChanges: {},
    }
    const result = validateWorkflowRecord(data)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('should return valid for a complete workflow record with tasks and channels', () => {
    const data = {
      step: 1,
      status: 'completed',
      tasks: [
        {
          id: 'task-1',
          nodeId: 'build',
          step: 0,
          status: 'success',
          startedAt: '2025-01-01T00:00:00Z',
          completedAt: '2025-01-01T00:01:00Z',
        },
      ],
      channelChanges: {
        'edge:A→B': {
          name: 'edge:A→B',
          value: 'success',
          version: 1,
          updatedAt: '2025-01-01T00:01:00Z',
        },
      },
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: '2025-01-01T00:01:00Z',
    }
    const result = validateWorkflowRecord(data)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('should return invalid for missing required fields', () => {
    const result = validateWorkflowRecord({})
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should return invalid with error details for wrong status value', () => {
    const data = {
      step: 0,
      status: 'invalid-status',
      tasks: [],
      channelChanges: {},
    }
    const result = validateWorkflowRecord(data)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('status'))).toBe(true)
  })

  it('should return invalid for negative step number', () => {
    const data = {
      step: -1,
      status: 'running',
      tasks: [],
      channelChanges: {},
    }
    const result = validateWorkflowRecord(data)
    expect(result.valid).toBe(false)
  })

  it('should return invalid for wrong task status enum', () => {
    const data = {
      step: 0,
      status: 'running',
      tasks: [{ id: 't1', nodeId: 'n1', step: 0, status: 'unknown' }],
      channelChanges: {},
    }
    const result = validateWorkflowRecord(data)
    expect(result.valid).toBe(false)
  })

  it('should include field path in error messages', () => {
    const data = {
      step: 0,
      status: 'running',
      tasks: [{ id: 123, nodeId: 'n1', step: 0, status: 'ready' }],
      channelChanges: {},
    }
    const result = validateWorkflowRecord(data)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('tasks'))).toBe(true)
  })

  it('should return invalid for null input', () => {
    const result = validateWorkflowRecord(null)
    expect(result.valid).toBe(false)
  })

  it('should return invalid for string input', () => {
    const result = validateWorkflowRecord('not an object')
    expect(result.valid).toBe(false)
  })

  it('should accept optional fields as undefined', () => {
    const data = {
      step: 0,
      status: 'pending',
      tasks: [{ id: 't1', nodeId: 'n1', step: 0, status: 'ready' }],
      channelChanges: {},
    }
    const result = validateWorkflowRecord(data)
    expect(result.valid).toBe(true)
  })
})

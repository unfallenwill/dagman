import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs/promises'
import {
  appendEvent,
  readEvents,
  getLatestNodeTimestamp,
  getNodeTimestamps,
} from '../../src/runtime/event.js'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import type { Event } from '../../src/models/event.js'

describe('event', () => {
  beforeEach(async () => {
    initTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  describe('appendEvent', () => {
    it('appends a single event to the events file', async () => {
      const runId = 'test-run-1'
      await appendEvent('nodeA', 'start', 'running', runId)

      const filePath = path.join('.dagman/runs', runId, 'events.jsonl')
      const content = await fs.readFile(filePath, 'utf-8')
      const lines = content.trim().split('\n')

      expect(lines).toHaveLength(1)

      const event = JSON.parse(lines[0]!) as Event
      expect(event.node).toBe('nodeA')
      expect(event.from).toBe('start')
      expect(event.to).toBe('running')
      expect(event.timestamp).toBeDefined()
    })

    it('appends multiple events in sequence', async () => {
      const runId = 'test-run-2'
      await appendEvent('nodeA', 'pending', 'running', runId)
      await appendEvent('nodeA', 'running', 'success', runId)
      await appendEvent('nodeB', 'pending', 'running', runId)

      const filePath = path.join('.dagman/runs', runId, 'events.jsonl')
      const content = await fs.readFile(filePath, 'utf-8')
      const lines = content.trim().split('\n')

      expect(lines).toHaveLength(3)

      const events = lines.map((l) => JSON.parse(l) as Event)
      expect(events[0]?.node).toBe('nodeA')
      expect(events[1]?.node).toBe('nodeA')
      expect(events[2]?.node).toBe('nodeB')
    })

    it('creates run directory if it does not exist', async () => {
      const runId = 'test-run-new-dir'
      await appendEvent('nodeA', 'pending', 'running', runId)

      const runDir = path.join('.dagman/runs', runId)
      const exists = await fs
        .access(runDir)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })

    it('generates valid ISO timestamps', async () => {
      const runId = 'test-run-timestamp'
      const before = new Date()
      await appendEvent('nodeA', 'pending', 'running', runId)
      const after = new Date()

      const filePath = path.join('.dagman/runs', runId, 'events.jsonl')
      const content = await fs.readFile(filePath, 'utf-8')
      const event = JSON.parse(content.trim()) as Event

      const eventTime = new Date(event.timestamp)
      expect(eventTime.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(eventTime.getTime()).toBeLessThanOrEqual(after.getTime())
    })
  })

  describe('readEvents', () => {
    it('reads events from an existing events file', async () => {
      const runId = 'test-run-read-1'
      await appendEvent('nodeA', 'pending', 'running', runId)
      await appendEvent('nodeB', 'pending', 'running', runId)

      const events = await readEvents(runId)

      expect(events).toHaveLength(2)
      expect(events[0]?.node).toBe('nodeA')
      expect(events[1]?.node).toBe('nodeB')
    })

    it('returns empty array when events file does not exist', async () => {
      const events = await readEvents('non-existent-run')
      expect(events).toEqual([])
    })

    it('parses JSON lines correctly', async () => {
      const runId = 'test-run-parse'
      const runDir = path.join('.dagman/runs', runId)
      await fs.mkdir(runDir, { recursive: true })

      const eventsFile = path.join(runDir, 'events.jsonl')
      const testEvents = [
        { timestamp: '2026-05-30T10:00:00.000Z', node: 'nodeA', from: 'pending', to: 'running' },
        { timestamp: '2026-05-30T10:01:00.000Z', node: 'nodeB', from: 'pending', to: 'running' },
      ]
      await fs.writeFile(
        eventsFile,
        testEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      )

      const events = await readEvents(runId)
      expect(events).toHaveLength(2)
      expect(events[0]?.node).toBe('nodeA')
      expect(events[1]?.node).toBe('nodeB')
    })

    it('handles empty events file', async () => {
      const runId = 'test-run-empty'
      const runDir = path.join('.dagman/runs', runId)
      await fs.mkdir(runDir, { recursive: true })

      const eventsFile = path.join(runDir, 'events.jsonl')
      await fs.writeFile(eventsFile, '', 'utf-8')

      const events = await readEvents(runId)
      expect(events).toEqual([])
    })

    it('handles events file with only whitespace', async () => {
      const runId = 'test-run-whitespace'
      const runDir = path.join('.dagman/runs', runId)
      await fs.mkdir(runDir, { recursive: true })

      const eventsFile = path.join(runDir, 'events.jsonl')
      await fs.writeFile(eventsFile, '   \n  \n  ', 'utf-8')

      const events = await readEvents(runId)
      expect(events).toEqual([])
    })
  })

  describe('getLatestNodeTimestamp', () => {
    it('returns the most recent timestamp for a node', async () => {
      const runId = 'test-run-latest-1'
      await appendEvent('nodeA', 'pending', 'running', runId)
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10))
      await appendEvent('nodeA', 'running', 'success', runId)

      const timestamp = await getLatestNodeTimestamp('nodeA', runId)
      expect(timestamp).toBeDefined()
      expect(timestamp).toBeTruthy()
    })

    it('returns null for a node with no events', async () => {
      const runId = 'test-run-latest-2'
      await appendEvent('nodeA', 'pending', 'running', runId)

      const timestamp = await getLatestNodeTimestamp('nodeB', runId)
      expect(timestamp).toBeNull()
    })

    it('returns null for non-existent run', async () => {
      const timestamp = await getLatestNodeTimestamp('nodeA', 'non-existent-run')
      expect(timestamp).toBeNull()
    })

    it('finds correct node when multiple nodes have events', async () => {
      const runId = 'test-run-latest-3'
      await appendEvent('nodeA', 'pending', 'running', runId)
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10))
      await appendEvent('nodeB', 'pending', 'running', runId)
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10))
      await appendEvent('nodeA', 'running', 'success', runId)

      const timestampA = await getLatestNodeTimestamp('nodeA', runId)
      const timestampB = await getLatestNodeTimestamp('nodeB', runId)

      expect(timestampA).toBeDefined()
      expect(timestampB).toBeDefined()
      // nodeA has a more recent event
      expect(timestampA).not.toBe(timestampB)
    })

    it('returns timestamp from the last event chronologically', async () => {
      const runId = 'test-run-latest-4'
      const runDir = path.join('.dagman/runs', runId)
      await fs.mkdir(runDir, { recursive: true })

      const eventsFile = path.join(runDir, 'events.jsonl')
      const testEvents = [
        { timestamp: '2026-05-30T10:00:00.000Z', node: 'nodeA', from: 'pending', to: 'running' },
        { timestamp: '2026-05-30T09:00:00.000Z', node: 'nodeA', from: 'running', to: 'success' },
        { timestamp: '2026-05-30T11:00:00.000Z', node: 'nodeA', from: 'pending', to: 'running' },
      ]
      await fs.writeFile(
        eventsFile,
        testEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      )

      const timestamp = await getLatestNodeTimestamp('nodeA', runId)
      expect(timestamp).toBe('2026-05-30T11:00:00.000Z')
    })
  })

  describe('getNodeTimestamps', () => {
    it('returns timestamps for all nodes that have events', async () => {
      const runId = 'test-run-all-1'
      await appendEvent('nodeA', 'pending', 'running', runId)
      await appendEvent('nodeB', 'pending', 'running', runId)

      const timestamps = await getNodeTimestamps(runId)

      expect(Object.keys(timestamps)).toHaveLength(2)
      expect(timestamps['nodeA']).toBeDefined()
      expect(timestamps['nodeB']).toBeDefined()
    })

    it('returns empty object for non-existent run', async () => {
      const timestamps = await getNodeTimestamps('non-existent-run')
      expect(timestamps).toEqual({})
    })

    it('returns latest timestamp for each node', async () => {
      const runId = 'test-run-all-2'
      const runDir = path.join('.dagman/runs', runId)
      await fs.mkdir(runDir, { recursive: true })

      const eventsFile = path.join(runDir, 'events.jsonl')
      const testEvents = [
        { timestamp: '2026-05-30T10:00:00.000Z', node: 'nodeA', from: 'pending', to: 'running' },
        { timestamp: '2026-05-30T10:05:00.000Z', node: 'nodeB', from: 'pending', to: 'running' },
        { timestamp: '2026-05-30T10:10:00.000Z', node: 'nodeA', from: 'running', to: 'success' },
      ]
      await fs.writeFile(
        eventsFile,
        testEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      )

      const timestamps = await getNodeTimestamps(runId)

      expect(timestamps['nodeA']).toBe('2026-05-30T10:10:00.000Z')
      expect(timestamps['nodeB']).toBe('2026-05-30T10:05:00.000Z')
    })

    it('handles nodes with multiple events correctly', async () => {
      const runId = 'test-run-all-3'
      await appendEvent('nodeA', 'pending', 'running', runId)
      await new Promise((resolve) => setTimeout(resolve, 10))
      await appendEvent('nodeA', 'running', 'success', runId)
      await new Promise((resolve) => setTimeout(resolve, 10))
      await appendEvent('nodeA', 'success', 'done', runId)

      const timestamps = await getNodeTimestamps(runId)

      expect(Object.keys(timestamps)).toHaveLength(1)
      expect(timestamps['nodeA']).toBeDefined()
      // Should be the latest timestamp
      expect(timestamps['nodeA']?.length).toBeGreaterThan(0)
    })

    it('preserves ISO timestamp format', async () => {
      const runId = 'test-run-all-4'
      const runDir = path.join('.dagman/runs', runId)
      await fs.mkdir(runDir, { recursive: true })

      const eventsFile = path.join(runDir, 'events.jsonl')
      const testEvents = [
        { timestamp: '2026-05-30T10:00:00.000Z', node: 'nodeA', from: 'pending', to: 'running' },
      ]
      await fs.writeFile(
        eventsFile,
        testEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      )

      const timestamps = await getNodeTimestamps(runId)

      expect(timestamps['nodeA']).toBe('2026-05-30T10:00:00.000Z')
    })
  })
})

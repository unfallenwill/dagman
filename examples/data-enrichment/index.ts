import { node, workflow, START, END } from '../../src/index.js'

/**
 * data-enrichment — Multi-source data enrichment with parallel branches and barrier joins.
 *
 * Topology:
 *   ┌→ fetch-users  → enrich-profiles ─┐
 *   │                                    ├→ merge-results → END
 *   ├→ fetch-orders → enrich-orders  ──┤
 *   │                                    │
 *   └→ fetch-events → enrich-events  ──┘
 *
 * Demonstrates:
 *   - Multiple entry nodes (3 parallel starts)
 *   - Three independent parallel chains
 *   - 3-way barrier join at merge-results
 *   - State aggregation from multiple sources
 *
 * Layers:
 *   0: fetch-users, fetch-orders, fetch-events  (parallel entry nodes)
 *   1: enrich-profiles, enrich-orders, enrich-events  (parallel, each triggered by its fetch)
 *   2: merge-results  (barrier join — waits for all three enrich nodes)
 */
export default workflow('data-enrichment', {
  state: {
    users: [] as unknown[],
    orders: [] as unknown[],
    events: [] as unknown[],
    enrichedProfiles: [] as unknown[],
    enrichedOrders: [] as unknown[],
    enrichedEvents: [] as unknown[],
    mergedReport: '',
    totalRecords: 0,
  },
  version: '1.0.0',
  description:
    'Multi-source data enrichment with parallel fetch/enrich and barrier join aggregation',
})
  .add(
    'fetch-users',
    node((_state) => {
      return {
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Carol', email: 'carol@example.com' },
        ],
      }
    }),
  )
  .add(
    'fetch-orders',
    node((_state) => {
      return {
        orders: [
          { orderId: 'O1', userId: 1, amount: 99.99, status: 'completed' },
          { orderId: 'O2', userId: 2, amount: 49.5, status: 'pending' },
          { orderId: 'O3', userId: 1, amount: 150.0, status: 'completed' },
        ],
      }
    }),
  )
  .add(
    'fetch-events',
    node((_state) => {
      return {
        events: [
          { eventId: 'E1', userId: 1, type: 'login', timestamp: '2024-01-15' },
          { eventId: 'E2', userId: 2, type: 'purchase', timestamp: '2024-01-16' },
          { eventId: 'E3', userId: 3, type: 'logout', timestamp: '2024-01-17' },
        ],
      }
    }),
  )
  .add(
    'enrich-profiles',
    node((state) => {
      const users = state.users as Array<{ id: number; name: string; email: string }>
      const enriched = users.map((u) => ({
        ...u,
        displayName: `${u.name} <${u.email}>`,
      }))
      return { enrichedProfiles: enriched }
    }),
  )
  .add(
    'enrich-orders',
    node((state) => {
      const orders = state.orders as Array<{
        orderId: string
        userId: number
        amount: number
        status: string
      }>
      const enriched = orders.map((o) => ({
        ...o,
        label: `${o.orderId}: $${o.amount.toFixed(2)} (${o.status})`,
        isHighValue: o.amount >= 100,
      }))
      return { enrichedOrders: enriched }
    }),
  )
  .add(
    'enrich-events',
    node((state) => {
      const events = state.events as Array<{
        eventId: string
        userId: number
        type: string
        timestamp: string
      }>
      const enriched = events.map((e) => ({
        ...e,
        description: `${e.type} event for user ${e.userId} at ${e.timestamp}`,
      }))
      return { enrichedEvents: enriched }
    }),
  )
  .add(
    'merge-results',
    node((state) => {
      const profiles = state.enrichedProfiles as unknown[]
      const orders = state.enrichedOrders as unknown[]
      const events = state.enrichedEvents as unknown[]
      const total = profiles.length + orders.length + events.length
      return {
        mergedReport: `Enrichment complete: ${profiles.length} profiles, ${orders.length} orders, ${events.length} events`,
        totalRecords: total,
      }
    }),
  )
  .edge(START, 'fetch-users')
  .edge(START, 'fetch-orders')
  .edge(START, 'fetch-events')
  .edge('fetch-users', 'enrich-profiles')
  .edge('fetch-orders', 'enrich-orders')
  .edge('fetch-events', 'enrich-events')
  .edge('enrich-profiles', 'merge-results')
  .edge('enrich-orders', 'merge-results')
  .edge('enrich-events', 'merge-results')
  .edge('merge-results', END)
  .build()

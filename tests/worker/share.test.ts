import assert from 'node:assert/strict'
import test from 'node:test'
import { createShare, publicPlan, readShare } from '../../worker/share.ts'
import type { Config } from '../../worker/config.ts'
import type { Env } from '../../worker/types.ts'

class MemoryKV {
  readonly values = new Map<string, string>()

  async get<T = unknown>(key: string, type?: 'json'): Promise<T | string | null> {
    const value = this.values.get(key)
    if (value === undefined) return null
    return type === 'json' ? JSON.parse(value) as T : value
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }
}

const config: Config = {
  model: 'claude-sonnet-5',
  priceLuna: 1_000_000,
  plansPerPayment: 10,
  freePlans: 3,
  dailyBudget: 400,
  rpcUrl: '',
  payTo: null,
  appUrl: 'https://cairn.example',
  trustPaymentsInDev: false,
}

const address = 'NQ01AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const plan = {
  id: 'local',
  name: 'A useful plan',
  createdAt: 1,
  updatedAt: 1,
  input: { name: 'A useful plan', idea: 'A useful idea described in enough detail for Cairn.' },
  prd: { summary: 'A summary', problem: '', targetUser: '', userGoal: '', coreFeatures: [], userStories: [], successCriteria: [], assumptions: [], outOfScope: [] },
  flow: [],
  build: { mvpScope: [], milestones: [], risks: [], acceptanceTests: [], nextAction: '' },
  realityCheck: [],
}

test('stores a full read-only snapshot and returns a gift link', async () => {
  const kv = new MemoryKV()
  const result = await createShare({ CAIRN: kv as unknown as KVNamespace } as Env, config, address, plan, new URL('https://cairn.example/'))
  const shareId = new URL(result.url).searchParams.get('s')
  const gift = new URL(result.url).searchParams.get('g')
  assert.ok(shareId)
  assert.ok(gift)

  const record = await readShare({ CAIRN: kv as unknown as KVNamespace } as Env, shareId ?? '')
  assert.ok(record)
  assert.equal(record?.plan.prd.summary, 'A summary')
  assert.equal(publicPlan(record ?? { plan: plan as never, by: address, createdAt: 1, gift: '' }).shareId, shareId)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAcquisitionSource } from '../../src/lib/acquisition.ts'

test('keeps campaign labels compact and non-identifying', () => {
  assert.equal(normalizeAcquisitionSource(' X Launch / Sept! '), 'x-launch-sept')
  assert.equal(normalizeAcquisitionSource('a'.repeat(80)).length, 32)
  assert.equal(normalizeAcquisitionSource(''), undefined)
})

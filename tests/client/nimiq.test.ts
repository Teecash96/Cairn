import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import HubApi from '@nimiq/hub-api'
import { sendPaymentInBrowser } from '../../src/lib/nimiq.ts'
import { bindPayment } from '../../src/lib/payment-session.ts'

const originalCheckout = HubApi.prototype.checkout
const originalWindow = globalThis.window

afterEach(() => {
  HubApi.prototype.checkout = originalCheckout
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

describe('browser Nimiq checkout', () => {
  it('lets Hub refresh or reselect the payer and returns the signed sender', async () => {
    const popup = {
      closed: false,
      close() {
        this.closed = true
      },
      location: { href: 'about:blank' },
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: () => popup,
        localStorage: {
          getItem: () => null,
          setItem: () => undefined,
        },
        sessionStorage: {
          getItem: () => null,
          setItem: () => undefined,
        },
      },
    })

    let request: Record<string, unknown> | undefined
    HubApi.prototype.checkout = async (input) => {
      request = await input as unknown as Record<string, unknown>
      return {
        hash: 'receipt-hash',
        raw: { sender: 'NQ payer' },
      } as Awaited<ReturnType<HubApi['checkout']>>
    }

    const payment = await sendPaymentInBrowser(
      'NQ recipient',
      100_000,
      'Cairn AI credits',
      'NQ authenticated',
    )

    assert.equal(request?.sender, 'NQ authenticated')
    assert.equal(request?.forceSender, false)
    assert.deepEqual(payment, {
      receipt: 'receipt-hash',
      sender: 'NQ payer',
    })
    assert.equal(popup.closed, true)
  })

  it('binds a receipt to the actual payer when Hub selects another address', () => {
    assert.deepEqual(bindPayment('NQ authenticated', {
      receipt: 'receipt-hash',
      sender: 'NQ payer',
    }), {
      pending: {
        address: 'NQ payer',
        receipt: 'receipt-hash',
      },
      requiresPayerAuth: true,
    })
  })

  it('accepts formatting differences for the same payer', () => {
    assert.equal(bindPayment('nq12 3456', {
      receipt: 'receipt-hash',
      sender: 'NQ123456',
    }).requiresPayerAuth, false)
  })
})
